// Fogli Excel «a cruscotto»: in uno stesso foglio possono esserci un titolo, riquadri di numeri chiave
// (etichetta accanto o sopra al valore), più tabelle affiancate o una sotto l'altra, tabelle di appoggio
// per i grafici e note. Qui il foglio viene scomposto in blocchi di celle contigue e ogni blocco
// diventa ciò che è: titolo, nota, numeri chiave, tabella (con grafico) o semplice testo.
import { minuscolo, parseNumero, tabellaToGrafico } from './charts.ts';
import type { Grafico } from './types.ts';

interface Blocco {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** celle del rettangolo del blocco ('' = vuota) */
  grid: string[][];
  celle: number;
}

const isNum = (v: string) => v !== '' && typeof parseNumero(v, true) === 'number';
const isText = (v: string) => v !== '' && !isNum(v);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Intestazioni che introducono un gruppo di colonne «etichetta + valori» (tabelle affiancate nella stessa riga). */
const ETICHETTE = new Set(['indicatore', 'indicatori', 'voce', 'voci', 'profilo', 'descrizione', 'parametro', 'misura', 'tipologia', 'categoria']);
/** Intestazioni generiche: non servono a dare un titolo («Valore per indicatore» non dice nulla). */
const GENERICHE = new Set(['indicatore', 'indicatori', 'voce', 'voci', 'profilo', 'descrizione', 'parametro', 'misura', '']);

/** Celle contigue (sopra, sotto, destra, sinistra) → blocchi. */
export function blocchi(rows: string[][], righe: number[]): Blocco[] {
  const cell = new Map<string, string>();
  rows.forEach((r, i) => r.forEach((v, c) => { if (v.trim()) cell.set(`${righe[i]}:${c}`, v.trim()); }));
  const seen = new Set<string>();
  const out: Blocco[] = [];
  for (const key of cell.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    seen.add(key);
    const pos: [number, number][] = [];
    while (stack.length) {
      const k = stack.pop()!;
      const [r, c] = k.split(':').map(Number);
      pos.push([r, c]);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${r + dr}:${c + dc}`;
        if (cell.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    const top = Math.min(...pos.map((p) => p[0])), bottom = Math.max(...pos.map((p) => p[0]));
    const left = Math.min(...pos.map((p) => p[1])), right = Math.max(...pos.map((p) => p[1]));
    const grid = Array.from({ length: bottom - top + 1 }, (_, i) =>
      Array.from({ length: right - left + 1 }, (_, j) => cell.get(`${top + i}:${left + j}`) ?? ''));
    out.push({ top, left, bottom, right, grid, celle: pos.length });
  }
  return out.sort((a, b) => a.top - b.top || a.left - b.left);
}

interface Kpi { etichetta: string; valore: string }

/** Riquadri «etichetta → valore»: in colonna (etichetta sopra) o in riga (etichetta a sinistra). */
function comeKpi(b: Blocco): Kpi[] | null {
  const g = b.grid;
  // in colonna: testo, numero, testo, numero…
  if (g[0].length === 1) {
    const v = g.map((r) => r[0]).filter(Boolean);
    if (v.length >= 2 && v.length % 2 === 0 && v.every((x, i) => (i % 2 ? isNum(x) : isText(x)))) {
      return v.flatMap((x, i) => (i % 2 ? [] : [{ etichetta: x, valore: v[i + 1] }]));
    }
    return null;
  }
  // in riga: ogni etichetta seguita subito dal suo valore (numero o data)
  const items: Kpi[] = [];
  for (const r of g) {
    const cells = r.map((v, c) => ({ v, c })).filter((x) => x.v);
    if (cells.length % 2) return null;
    for (let i = 0; i < cells.length; i += 2) {
      const [l, v] = [cells[i], cells[i + 1]];
      if (!isText(l.v) || v.c !== l.c + 1 || isText(v.v) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v.v)) return null;
      items.push({ etichetta: l.v, valore: v.v });
    }
  }
  // almeno un valore numerico e nessuna riga di sole intestazioni
  return items.length >= 2 && items.some((x) => isNum(x.valore)) ? items : null;
}

/** Tabella: la prima riga sono le intestazioni e sotto ci sono numeri. */
function comeTabella(b: Blocco): boolean {
  const g = b.grid;
  if (g.length < 2 || g[0].length < 2) return false;
  const head = g[0].filter(Boolean);
  // intestazioni: testi, oppure anni (2023 | 2024 | 2025) accanto a un'etichetta
  const anno = (v: string) => /^(19|20)\d{2}$/.test(v);
  if (head.length < 2 || !head.some(isText) || head.filter((v) => isText(v) || anno(v)).length < head.length / 2 + 0.5) return false;
  return g.slice(1).some((r) => r.slice(1).some(isNum));
}

/** Gruppi di colonne di una tabella (tabelle affiancate senza colonna vuota in mezzo). */
function gruppiColonne(g: string[][]): number[][] {
  const head = g[0].map(norm);
  const body = g.slice(1);
  const testuale = (c: number) => body.every((r) => !isNum(r[c]));
  const starts = [0];
  head.forEach((h, c) => {
    if (c === 0 || !h || !testuale(c)) return;
    if (head.slice(starts[starts.length - 1], c).includes(h) || ETICHETTE.has(h)) starts.push(c);
  });
  return starts.map((s, i) => Array.from({ length: (starts[i + 1] ?? head.length) - s }, (_, k) => s + k));
}

/** Righe lunghe da leggere una per una: ogni valore con il nome della sua colonna. */
function righeConIntestazione(t: string[][]): string {
  const [head, ...body] = t;
  return body
    .map((r) => r.map((v, i) => (v ? (head[i] ? `${head[i]}: ${v}` : v) : '')).filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n');
}

export interface FoglioLetto {
  grafici: Grafico[];
  testo: string;
}

const MAX_KPI = 8;

/** Foglio Excel → grafici (tabelle e numeri chiave) e testo per ricerca e AI. */
export function leggiFoglio(
  nome: string,
  rows: string[][],
  righe: number[],
  graficiExcel: Grafico[] = [],
  /** rende unici i titoli nel file (va applicato prima di scrivere il testo) */
  registra: (g: Grafico) => Grafico = (g) => g
): FoglioLetto {
  const bs = blocchi(rows, righe);
  const pos = `Foglio «${nome}»`;
  const titoli = bs.filter((b) => b.celle === 1 && isText(b.grid[0].find(Boolean)!) && b.grid[0].find(Boolean)!.length <= 110);
  // titolo del foglio: la prima cella in alto a sinistra, se è un testo breve
  const primo = bs[0]?.grid[0].find(Boolean) ?? '';
  const titoloFoglio = bs[0] && bs[0].top <= 2 && isText(primo) && primo.length <= 110 ? primo : nome;
  const usati = new Set<Blocco>();
  const grafici: Grafico[] = [];
  const kpi: Kpi[] = [];
  const parti: string[] = [];

  /** titolo scritto subito sopra il blocco (fino a 3 righe sopra, nelle stesse colonne) */
  const titoloSopra = (b: Blocco) => {
    const t = titoli
      .filter((x) => !usati.has(x) && x.bottom < b.top && x.bottom >= b.top - 3 && x.left >= b.left && x.left <= b.right)
      .sort((x, y) => y.bottom - x.bottom)[0];
    if (t) usati.add(t);
    return t?.grid[0].find(Boolean);
  };

  for (const b of bs) {
    const g = b.grid;
    const valori = g.flat().filter(Boolean);
    if (b.celle === 1) {
      parti.push(valori[0]);
      continue;
    }
    const k = comeKpi(b);
    if (k) {
      kpi.push(...k);
      parti.push(k.map((x) => `${x.etichetta}: ${x.valore}`).join('\n'));
      continue;
    }
    if (comeTabella(b)) {
      const sopra = titoloSopra(b);
      const gruppi = gruppiColonne(g);
      // gruppi con le stesse intestazioni (tabelle ripetute affiancate) → una tabella sola
      const perIntestazione = new Map<string, string[][]>();
      for (const cols of gruppi) {
        const sub = g.map((r) => cols.map((c) => r[c]));
        const key = sub[0].map(norm).join('|');
        const prev = perIntestazione.get(key);
        if (prev) prev.push(...sub.slice(1).filter((r) => r.some(Boolean)));
        else perIntestazione.set(key, sub.filter((r) => r.some(Boolean)));
      }
      const tabelle = [...perIntestazione.values()];
      for (const t of tabelle) {
        const h0 = t[0][0];
        const prima = t[0].slice(1).find((h, i) => h && t.slice(1).some((r) => isNum(r[i + 1])));
        const titolo = (tabelle.length === 1 && sopra)
          || (prima && !GENERICHE.has(norm(h0)) ? `${prima} per ${minuscolo(h0)}` : '')
          || (sopra ? `${sopra} – ${h0 || 'tabella'}` : `${nome} – ${h0 || 'tabella'}`);
        const gr = tabellaToGrafico(t, { titolo, posizione: pos, decimalePunto: true });
        if (gr && gr.categorie.length > 30) gr.tipo = 'tabella';
        if (gr) grafici.push(registra(gr));
        parti.push(gr && t.length <= 31
          ? `Tabella «${gr.titolo}»\n${t.map((r) => r.join(' | ').replace(/( \| )+$/, '')).join('\n')}`
          : `${gr ? `Tabella «${gr.titolo}»\n` : ''}${righeConIntestazione(t)}`);
      }
      continue;
    }
    // elenco con intestazioni (anche senza numeri): ogni riga «Colonna: valore · …»
    if (g.length >= 2 && g[0].length >= 2 && g[0].filter(isText).length >= 2) parti.push(righeConIntestazione(g));
    else parti.push(g.map((r) => r.filter(Boolean).join(' | ')).filter(Boolean).join('\n'));
  }

  // numeri chiave del foglio: un grafico «Numeri» (riquadri) ogni 8 valori
  const numerici = kpi.filter((x) => isNum(x.valore));
  for (let i = 0; i < numerici.length; i += MAX_KPI) {
    const parte = numerici.slice(i, i + MAX_KPI);
    const n = Math.ceil(numerici.length / MAX_KPI);
    grafici.unshift(registra({
      titolo: `${titoloFoglio} – numeri chiave${n > 1 ? ` (${i / MAX_KPI + 1})` : ''}`,
      tipo: 'kpi',
      categorie: parte.map((x) => `${x.etichetta}${/%\s*$/.test(x.valore) ? ' (%)' : /^€/.test(x.valore) ? ' (€)' : ''}`),
      serie: [{ nome: 'Valore', valori: parte.map((x) => parseNumero(x.valore, true) as number) }],
      posizione: pos
    }));
  }

  // le tabelle di appoggio dei grafici Excel non si ripetono: resta il grafico
  const firma = (cat: string[], v: (number | null)[]) => `${cat.map(norm).join('|')}=${v.map((x) => (x == null ? '' : Math.round(x * 1000))).join(',')}`;
  const giaNeiGrafici = new Set(graficiExcel.flatMap((x) => x.serie.map((s) => firma(x.categorie, s.valori))));
  const tabelle = grafici.filter((x) => x.tipo === 'kpi' || !x.serie.every((s) => giaNeiGrafici.has(firma(x.categorie, s.valori))));

  // grafico Excel che ripete una tabella piccola (al massimo 2 serie) dello stesso foglio: basta la tabella
  const ripete = (c: Grafico) => tabelle.some((t) => t.tipo !== 'kpi' && t.serie.length <= 2 &&
    c.serie.every((s) => t.serie.some((ts) => firma(t.categorie, ts.valori) === firma(c.categorie, s.valori))));
  const titoliTabelle = new Set(tabelle.map((t) => norm(t.titolo)));
  const excel = graficiExcel.filter((c) => !ripete(c)).map((c) => {
    // stesso titolo di una tabella del foglio: si capisce che è il grafico del file
    if (titoliTabelle.has(norm(c.titolo))) c.titolo = `${c.titolo} – grafico del file`;
    return registra(c);
  });
  return { grafici: [...tabelle, ...excel], testo: parti.filter(Boolean).join('\n\n') };
}
