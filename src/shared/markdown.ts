// Mini-parser Markdown per le risposte di Gemini → struttura dati (nessun HTML grezzo: niente rischio XSS).
// Supporta: paragrafi, titoli, elenchi puntati/numerati, **grassetto**, *corsivo*, `codice`, [link](https://…),
// URL nudi e le citazioni [id-record] riconosciute tra gli id noti.
// In più: tabelle Markdown (| a | b |) e blocchi ```grafico {json}``` che l'AI usa per i grafici.
import { splitCitations } from './gemini.ts';
import { normalizeGrafico } from './charts.ts';
import type { Grafico } from './types.ts';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'cite'; ids: string[] }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; lines: Inline[][] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  /** grafico dall'AI: g = null se il JSON non è valido; aperto = la risposta lo sta ancora scrivendo */
  | { t: 'chart'; g: Grafico | null; aperto: boolean; fonti: string[] };

const INLINE = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*(?![\s*])([^*\n]+?)\*(?![\w*])|(https?:\/\/[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"»])/g;

function withCitations(text: string, ids: Set<string>): Inline[] {
  if (!text) return [];
  return splitCitations(text, ids).map((p) => (p.type === 'cite' ? { t: 'cite', ids: p.ids } : { t: 'text', v: p.text }));
}

export function parseInline(text: string, ids: Set<string> = new Set()): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index!;
    // *corsivo* solo se l'asterisco non è attaccato a una parola (niente lookbehind: Safari < 16.4)
    if (m[6] != null && i > 0 && /[\w*]/.test(text[i - 1])) continue;
    if (i > last) out.push(...withCitations(text.slice(last, i), ids));
    if (m[1] ?? m[2]) out.push({ t: 'strong', c: parseInline(m[1] ?? m[2], ids) });
    else if (m[3] != null) out.push({ t: 'code', v: m[3] });
    else if (m[4] != null) out.push({ t: 'link', href: m[5], c: parseInline(m[4], ids) });
    else if (m[6] != null) out.push({ t: 'em', c: parseInline(m[6], ids) });
    else if (m[7] != null) out.push({ t: 'link', href: m[7], c: [{ t: 'text', v: m[7] }] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push(...withCitations(text.slice(last), ids));
  return out;
}

export function parseMarkdown(md: string, ids: Set<string> = new Set()): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; start: number; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', lines: para.map((l) => parseInline(l, ids)) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it) => parseInline(it, ids));
    blocks.push(list.t === 'ul' ? { t: 'ul', items } : { t: 'ol', start: list.start, items });
    list = null;
  };

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    // ```grafico … ``` (anche ```json con dentro un grafico)
    const fence = line.match(/^\s*```\s*(\w*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const body: string[] = [];
      let j = li + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++]);
      const aperto = j >= lines.length;
      li = j;
      const text = body.join('\n').trim();
      if (/^(grafico|chart|json)?$/i.test(fence[1])) {
        let g: Grafico | null = null;
        let fonti: string[] = [];
        if (!aperto) {
          try {
            const o = JSON.parse(text) as Record<string, unknown>;
            g = normalizeGrafico(o);
            const f = o.fonti ?? o.fonte;
            fonti = (Array.isArray(f) ? f : f ? [f] : []).map(String).filter((x) => ids.has(x));
          } catch { g = null; }
        }
        if (g || aperto || /^grafico$/i.test(fence[1])) { blocks.push({ t: 'chart', g, aperto, fonti }); continue; }
      }
      // altro codice: come paragrafo di testo semplice
      if (text) blocks.push({ t: 'p', lines: text.split('\n').map((l) => [{ t: 'code', v: l }]) });
      continue;
    }

    // tabella Markdown: riga di intestazione + riga di separazione |---|---|
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[li + 1] ?? '')) {
      flushPara(); flushList();
      const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim(), ids));
      const head = cells(line);
      const rows: Inline[][][] = [];
      li += 2;
      while (li < lines.length && /^\s*\|.*\|\s*$/.test(lines[li])) rows.push(cells(lines[li++]));
      li--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    const h = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);
    if (h) { flushPara(); flushList(); blocks.push({ t: 'h', level: h[1].length, c: parseInline(h[2], ids) }); continue; }

    const ul = line.match(/^\s*[-*•+]\s+(.*)$/);
    const ol = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.t !== type) {
        flushList();
        list = { t: type, start: ol ? Number(ol[1]) : 1, items: [] };
      }
      list.items.push(ul ? ul[1] : ol![2]);
      continue;
    }
    // riga di continuazione di un elemento di elenco (rientrata)
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
