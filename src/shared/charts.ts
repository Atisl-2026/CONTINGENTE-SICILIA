// Grafici e tabelle numeriche: lettura dai file (Word, PowerPoint, Excel), validazione,
// testo per la ricerca e per l'AI. Funzioni pure, condivise da app (telefono) e script (computer).
import { strFromU8 } from 'fflate';
import type { Grafico, Serie, TipoGrafico } from './types.ts';

export const TIPI_GRAFICO: TipoGrafico[] = ['barre', 'linee', 'area', 'torta', 'ciambella', 'kpi', 'tabella'];

/** Limiti: oltre, la tabella resta solo come testo (l'AI la legge comunque). */
export const MAX_CATEGORIE = 80;
export const MAX_SERIE = 12;

// ============================================================ numeri

const NUM_EMPTY = /^(?:|-|–|—|n\.?\s?d\.?|n\.?\s?a\.?|\/|\.\.\.|…)$/i;

/**
 * "1.234,5" → 1234.5 · "12%" → 12 · "€ 1.200" → 1200 · "(35)" → -35 · "-" → null.
 * decimalePunto: i numeri vengono da Excel (punto decimale, senza separatore delle migliaia).
 */
export function parseNumero(raw: unknown, decimalePunto = false): number | null | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  let s = String(raw ?? '').replace(/[\s  ]/g, '');
  if (NUM_EMPTY.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^[€$£]|[€$£%‰]$|^(?:eur|euro)|(?:eur|euro)$/gi, '');
  if (/^[+-]/.test(s)) { neg = neg !== (s[0] === '-'); s = s.slice(1); }
  // notazione scientifica di Excel nei grafici: 8.7167976056864951E-2
  if (decimalePunto && /^\d+(\.\d+)?e[+-]?\d+$/i.test(s)) return neg ? -Number(s) : Number(s);
  if (!/^\d[\d.,']*$/.test(s)) return undefined;
  s = s.replace(/'/g, '');
  if (decimalePunto) {
    if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return undefined;
  } else if (s.includes(',') && s.includes('.')) {
    // il separatore che compare per ultimo è quello dei decimali
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 1.234 = milleduecentotrentaquattro (uso italiano)
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return neg ? -n : n;
}

const isPercent = (s: string) => /%\s*$/.test(s.trim());

/** Numero in formato italiano, senza decimali inutili. */
export function formatNumero(n: number | null | undefined, unita = ''): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  const dec = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const s = n.toLocaleString('it-IT', { maximumFractionDigits: Number.isInteger(n) ? 0 : dec });
  return unita === '%' ? `${s}%` : unita ? `${s} ${unita}` : s;
}

// ============================================================ forma del grafico

const MESI = /^(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic|jan|may|jun|jul|aug|sep|oct|dec)[a-z]*\.?(\s*['’]?\d{2,4})?$/i;
const TEMPO = [
  /^(19|20)\d{2}$/, // anno
  /^(19|20)\d{2}\s*[-/]\s*(\d{2}|(19|20)\d{2})$/, // 2023-24, 2023/2024
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/, // data
  /^(19|20)\d{2}-\d{2}(-\d{2})?$/, // 2024-03
  /^(q|t|trim\.?|trimestre)\s*[1-4](\s*(19|20)?\d{2})?$/i,
  /^([1-4]|i{1,3}|iv)\s*[°ºo]?\s*(trim|trimestre|sem|semestre)/i,
  /^(1|2|i|ii)\s*[°ºo]?\s*sem/i,
  /^sett(imana)?\.?\s*\d+/i
];

/** Le etichette indicano un andamento nel tempo (anni, mesi, trimestri, date)? */
export function etichetteTemporali(labels: string[]): boolean {
  const l = labels.filter((x) => x.trim());
  if (l.length < 2) return false;
  const ok = l.filter((x) => MESI.test(x.trim()) || TEMPO.some((re) => re.test(x.trim()))).length;
  return ok / l.length >= 0.7;
}

/** Tipo di grafico più adatto ai dati. */
export function tipoAdatto(g: Pick<Grafico, 'categorie' | 'serie' | 'unita'>): TipoGrafico {
  if (etichetteTemporali(g.categorie) && g.categorie.length >= 3) return 'linee';
  if (g.serie.length === 1 && g.categorie.length >= 2 && g.categorie.length <= 7) {
    const v = g.serie[0].valori.filter((x): x is number => x != null);
    const sum = v.reduce((a, b) => a + b, 0);
    if (v.every((x) => x >= 0) && (g.unita === '%' ? Math.abs(sum - 100) <= 2 : false)) return 'torta';
  }
  return 'barre';
}

// ============================================================ validazione

const str = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Accetta un grafico da qualsiasi origine (file, JSON, risposta AI): null se inutilizzabile. */
export function normalizeGrafico(raw: unknown): Grafico | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const categorie = Array.isArray(o.categorie) ? o.categorie.slice(0, MAX_CATEGORIE).map((c) => str(c, 120)) : [];
  const serieRaw = Array.isArray(o.serie) ? o.serie : [];
  const serie: Serie[] = [];
  for (const s of serieRaw.slice(0, MAX_SERIE)) {
    if (!s || typeof s !== 'object') continue;
    const so = s as Record<string, unknown>;
    const vals = Array.isArray(so.valori) ? so.valori : [];
    const valori = categorie.map((_, i) => {
      const n = parseNumero(vals[i] as unknown, typeof vals[i] === 'string' ? false : true);
      return n == null ? null : n;
    });
    if (valori.some((v) => v != null)) serie.push({ nome: str(so.nome, 120) || `Serie ${serie.length + 1}`, valori });
  }
  if (!categorie.length || !serie.length) return null;
  const tipo = TIPI_GRAFICO.includes(o.tipo as TipoGrafico) ? (o.tipo as TipoGrafico) : undefined;
  const g: Grafico = {
    titolo: str(o.titolo) || serie.map((s) => s.nome).join(', ').slice(0, 120),
    tipo: tipo ?? 'barre',
    categorie,
    serie
  };
  const unita = str(o.unita, 20);
  if (unita) g.unita = unita;
  const posizione = str(o.posizione, 80);
  if (posizione) g.posizione = posizione;
  const nota = str(o.nota, 400);
  if (nota) g.nota = nota;
  if (!tipo) g.tipo = tipoAdatto(g);
  return g;
}

export function normalizeGrafici(raw: unknown): Grafico[] {
  return Array.isArray(raw) ? raw.map(normalizeGrafico).filter((g): g is Grafico => !!g) : [];
}

// ============================================================ tabelle → grafici

const TOTALE = /^\s*(tot(ale)?|totali|total|complessivo|somma)\b/i;

/**
 * Tabella di testo → grafico, se contiene numeri: prima riga = intestazioni, prima colonna = etichette.
 * Le righe «Totale» restano nel testo ma non nel grafico (schiaccerebbero le altre barre).
 */
export function tabellaToGrafico(
  rowsIn: string[][],
  opts: { titolo?: string; posizione?: string; decimalePunto?: boolean } = {}
): Grafico | null {
  // righe senza celle vuote finali; colonne interamente vuote tolte
  const width = Math.max(0, ...rowsIn.map((r) => r.length));
  const rows = rowsIn.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim())).filter((r) => r.some(Boolean));
  const usedCols = [...Array(width).keys()].filter((c) => rows.some((r) => r[c]));
  const t = rows.map((r) => usedCols.map((c) => r[c]));
  if (t.length < 2 || usedCols.length < 2) return null;

  // titolo su una riga sola sopra la tabella (una sola cella piena)
  let titolo = opts.titolo ?? '';
  while (t.length > 2 && t[0].filter(Boolean).length === 1 && t[1].filter(Boolean).length > 1) {
    if (!titolo) titolo = t[0].find(Boolean)!;
    t.shift();
  }
  const [head, ...body] = t;
  const num = (s: string) => parseNumero(s, opts.decimalePunto);
  const numCols = head.map((_, c) => {
    if (c === 0) return false;
    const cells = body.map((r) => r[c]).filter((x) => x !== '');
    const nums = cells.filter((x) => typeof num(x) === 'number');
    return nums.length >= 1 && nums.length / Math.max(1, cells.length) >= 0.7;
  });
  const cols = numCols.flatMap((ok, c) => (ok ? [c] : []));
  if (!cols.length) return null;

  const righe = body.filter((r) => r[0] && !TOTALE.test(r[0]) && cols.some((c) => typeof num(r[c]) === 'number'));
  if (!righe.length) return null;
  const distinte = new Set(righe.map((r) => r[0].trim().toLowerCase())).size;
  if (righe.length >= 6 && distinte < righe.length * 0.9) return null;
  const pct = cols.every((c) => body.filter((r) => r[c]).every((r) => isPercent(r[c])));
  // colonne in percentuale o in euro dentro una tabella mista: lo dice il nome della serie
  const tutte = (c: number, re: RegExp) => body.filter((r) => r[c]).every((r) => re.test(r[c].trim()));
  const suffisso = (c: number) => {
    const h = head[c] ?? '';
    if (!pct && tutte(c, /%$/) && !/%/.test(h)) return ' (%)';
    if (tutte(c, /^€/) && !/€|euro|import/i.test(h)) return ' (€)';
    return '';
  };
  const hdr = (c: number) => `${head[c] || `Colonna ${c + 1}`}${suffisso(c)}`;

  let g: Grafico;
  // una sola riga di dati e intestazioni nel tempo (anni, mesi): il tempo va sull'asse orizzontale
  if (righe.length <= 2 && cols.length >= 3) {
    g = {
      titolo: '',
      tipo: 'barre',
      categorie: cols.map(hdr),
      serie: righe.map((r) => ({ nome: r[0], valori: cols.map((c) => num(r[c]) ?? null) }))
    };
  } else {
    if (righe.length > MAX_CATEGORIE) return null;
    g = {
      titolo: '',
      tipo: 'barre',
      categorie: righe.map((r) => r[0]),
      serie: cols.slice(0, MAX_SERIE).map((c) => ({ nome: hdr(c), valori: righe.map((r) => num(r[c]) ?? null) }))
    };
  }
  if (pct) g.unita = '%';
  g.titolo = titolo || (g.serie.length === 1 ? g.serie[0].nome : head[0] || 'Tabella');
  if (opts.posizione) g.posizione = opts.posizione;
  g.tipo = tipoAdatto(g);
  return g;
}

/** «Provincia» → «provincia», ma le sigle restano: «ATECO», «CF». */
export const minuscolo = (s: string) =>
  s.split(/(\s+)/).map((w) => (/^[A-ZÀ-Ý0-9.&/]{2,}$/.test(w) ? w : w.toLowerCase())).join('');

// ============================================================ grafici di Office (DrawingML)

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

/** Punti di una cache (<c:strCache>, <c:numCache>, letterali): indice → valore. */
function cachePoints(xml: string): { count: number; pts: Map<number, string>; format: string } {
  const pts = new Map<number, string>();
  for (const m of xml.matchAll(/<c:pt\b[^>]*idx="(\d+)"[^>]*>\s*<c:v>([\s\S]*?)<\/c:v>/g)) {
    // categorie su più livelli: si tiene il primo valore trovato per indice (livello più interno)
    if (!pts.has(+m[1])) pts.set(+m[1], decode(m[2]).trim());
  }
  const count = Number(xml.match(/<c:ptCount val="(\d+)"/)?.[1] ?? (pts.size ? Math.max(...pts.keys()) + 1 : 0));
  return { count, pts, format: decode(xml.match(/<c:formatCode>([\s\S]*?)<\/c:formatCode>/)?.[1] ?? '') };
}

function richText(xml: string): string {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join('').replace(/\s+/g, ' ').trim();
}

const TIPO_OFFICE: [RegExp, TipoGrafico][] = [
  [/^(bar|bar3D)Chart$/, 'barre'],
  [/^(line|line3D|stock|radar)Chart$/, 'linee'],
  [/^(area|area3D)Chart$/, 'area'],
  [/^(pie|pie3D|ofPie)Chart$/, 'torta'],
  [/^doughnutChart$/, 'ciambella'],
  [/^(scatter|bubble)Chart$/, 'linee']
];

/** Riferimento di un grafico a celle di Excel ('Foglio'!$B$3:$B$11) → valori e intestazione (cella sopra). */
export type RisolviRiferimento = (ref: string) => { valori: string[]; intestazione: string } | null;

const formula = (xml: string) => decode(xml.match(/<c:f>([\s\S]*?)<\/c:f>/)?.[1] ?? '').trim();

/**
 * Grafico di Word/PowerPoint/Excel (file chartN.xml) → dati, dai valori salvati nel file.
 * Con `risolvi` (Excel): nomi delle serie e titolo mancanti ricavati dalle intestazioni delle celle,
 * e valori letti dalle celle se il file non li ha salvati nel grafico.
 */
export function leggiGraficoOffice(xmlIn: string, posizione?: string, risolvi?: RisolviRiferimento): Grafico | null {
  // alcuni programmi (es. librerie Python) scrivono i grafici senza il prefisso «c:» sui tag
  const xml = /<c:chartSpace\b/.test(xmlIn) ? xmlIn : xmlIn.replace(/<(\/?)([A-Za-z]\w*)(?=[\s>/])/g, '<$1c:$2');
  const plot = xml.match(/<c:plotArea>([\s\S]*?)<\/c:plotArea>/)?.[1];
  if (!plot) return null;
  const tipoTag = plot.match(/<c:(\w+Chart)>/)?.[1] ?? '';
  const tipo = TIPO_OFFICE.find(([re]) => re.test(tipoTag))?.[1] ?? 'barre';

  let categorie: string[] = [];
  let intestCategorie = '';
  const serie: Serie[] = [];
  let percentuale = false;
  for (const s of plot.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)) {
    const ser = s[1];
    const txXml = ser.match(/<c:tx>([\s\S]*?)<\/c:tx>/)?.[1] ?? '';
    const catXml = ser.match(/<c:(?:cat|xVal)>([\s\S]*?)<\/c:(?:cat|xVal)>/)?.[1] ?? '';
    const valXml = ser.match(/<c:(?:val|yVal)>([\s\S]*?)<\/c:(?:val|yVal)>/)?.[1] ?? '';
    const valRef = risolvi && formula(valXml) ? risolvi(formula(valXml)) : null;
    let nome = cachePoints(txXml).pts.get(0) ?? richText(txXml);
    if (!nome && txXml && risolvi && formula(txXml)) nome = risolvi(formula(txXml))?.valori[0] ?? '';
    if (!nome && valRef?.intestazione) nome = valRef.intestazione;

    const val = cachePoints(valXml);
    let punti: (string | undefined)[];
    if (val.count) {
      if (/%/.test(val.format)) percentuale = true;
      punti = Array.from({ length: val.count }, (_, i) => val.pts.get(i));
    } else if (valRef?.valori.length) {
      punti = valRef.valori; // valori dalle celle: già nel formato visibile (es. "61.3%")
    } else continue;

    if (!categorie.length) {
      const cat = cachePoints(catXml);
      const catRef = risolvi && formula(catXml) ? risolvi(formula(catXml)) : null;
      intestCategorie = catRef?.intestazione ?? '';
      const n = Math.max(cat.count, punti.length);
      categorie = Array.from({ length: n }, (_, i) => cat.pts.get(i) ?? catRef?.valori[i] ?? String(i + 1));
      if (/[dmy]/i.test(cat.format) && !/general/i.test(cat.format)) {
        // categorie data salvate come numero seriale di Excel
        categorie = categorie.map((c) => (/^\d{5}(\.\d+)?$/.test(c) ? serialeData(Number(c), cat.format) : c));
      }
    }
    const daCache = !!val.count;
    const valori = categorie.map((_, i) => {
      const v = punti[i];
      if (v == null || v === '') return null;
      const n = parseNumero(v, daCache || !/,/.test(v));
      return n == null ? null : n;
    });
    if (!daCache && punti.some((v) => v && /%\s*$/.test(v))) percentuale = true;
    serie.push({ nome: nome || `Serie ${serie.length + 1}`, valori, ...(daCache ? { _cache: true } : {}) } as Serie);
  }
  if (!serie.length || !categorie.length) return null;
  if (percentuale) {
    for (const s of serie as (Serie & { _cache?: boolean })[]) {
      if (s._cache) s.valori = s.valori.map((v) => (v == null ? v : parseFloat((v * 100).toPrecision(12))));
    }
  }
  for (const s of serie as (Serie & { _cache?: boolean })[]) delete s._cache;

  const titleXml = xml.match(/<c:chart>\s*(?:<[^>]+\/>\s*)*<c:title>([\s\S]*?)<\/c:title>/)?.[1]
    ?? xml.match(/<c:title>([\s\S]*?)<\/c:title>/)?.[1] ?? '';
  let titolo = richText(titleXml) || cachePoints(titleXml).pts.get(0) || '';
  if (!titolo) {
    const nomi = serie.map((x) => x.nome).filter((x) => !/^Serie \d+$/.test(x));
    // senza titolo: «Pratiche per provincia», dalle intestazioni delle colonne usate
    titolo = nomi.length && intestCategorie
      ? `${nomi.join(', ')} per ${minuscolo(intestCategorie)}`
      : nomi.join(', ') || 'Grafico';
  }
  return normalizeGrafico({
    titolo,
    tipo: tipoTag === 'barChart' && /<c:barDir val="bar"/.test(plot) ? 'barre' : tipo,
    categorie,
    serie: serie.slice(0, MAX_SERIE),
    ...(percentuale ? { unita: '%' } : {}),
    ...(posizione ? { posizione } : {})
  });
}

function serialeData(n: number, format: string): string {
  const d = new Date(Math.round((n - 25569) * 86400000));
  const p = (x: number) => String(x).padStart(2, '0');
  if (!/d/i.test(format)) return `${['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Relazioni di una parte (file .rels): id → percorso completo nello zip. */
export function relazioni(files: Record<string, Uint8Array>, part: string): Map<string, string> {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const relsPath = `${dir}_rels/${part.slice(dir.length)}.rels`;
  const out = new Map<string, string>();
  const xml = files[relsPath] ? strFromU8(files[relsPath]) : '';
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (!id || !target || /TargetMode="External"/.test(m[1])) continue;
    out.set(id, risolvi(dir, target));
  }
  return out;
}

function risolvi(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

/** Grafici richiamati da una parte (documento, diapositiva, disegno), nell'ordine in cui compaiono. */
export function graficiDellaParte(
  files: Record<string, Uint8Array>,
  part: string,
  posizione?: string,
  risolvi?: RisolviRiferimento
): Grafico[] {
  const xml = files[part] ? strFromU8(files[part]) : '';
  if (!xml) return [];
  const rels = relazioni(files, part);
  const out: Grafico[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<c:chart\b[^>]*r:id="([^"]+)"/g)) {
    const path = rels.get(m[1]);
    if (!path || seen.has(path) || !files[path]) continue;
    seen.add(path);
    const g = leggiGraficoOffice(strFromU8(files[path]), posizione, risolvi);
    if (g) out.push(g);
  }
  return out;
}

/** Tabelle di DrawingML (PowerPoint): righe di testo. */
export function tabelleDrawing(xml: string): string[][][] {
  return [...xml.matchAll(/<a:tbl>([\s\S]*?)<\/a:tbl>/g)].map((t) =>
    [...t[1].matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((r) =>
      [...r[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>|<a:tc\b[^>]*\/>/g)].map((c) =>
        [...(c[1] ?? '').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => decode(x[1])).join(' ').replace(/\s+/g, ' ').trim()
      )
    )
  );
}

// ============================================================ testo per ricerca e AI

/** Grafico → testo leggibile (finisce nel testo della scheda: la ricerca e l'AI lo trovano). */
export function graficoToText(g: Grafico, maxRighe = MAX_CATEGORIE): string {
  const head = `Grafico «${g.titolo}»${g.posizione ? ` (${g.posizione})` : ''}${g.unita ? ` – valori in ${g.unita}` : ''}`;
  const rows = [
    ['Voce', ...g.serie.map((s) => s.nome)].join(' | '),
    ...g.categorie.slice(0, maxRighe).map((c, i) =>
      [c, ...g.serie.map((s) => formatNumero(s.valori[i], g.unita === '%' ? '%' : ''))].join(' | ')
    )
  ];
  return `${head}\n${rows.join('\n')}${g.nota ? `\nNota: ${g.nota}` : ''}`;
}

/** Grafico → JSON compatto per l'AI (stesso formato che l'AI deve restituire). */
export function graficoPerAi(g: Grafico): string {
  return JSON.stringify({
    titolo: g.titolo,
    tipo: g.tipo,
    ...(g.unita ? { unita: g.unita } : {}),
    ...(g.posizione ? { posizione: g.posizione } : {}),
    categorie: g.categorie,
    serie: g.serie
  });
}

/** Grafici di una scheda presenti in un brano di testo (intestazione «Grafico «titolo»» o «Tabella «titolo»»). */
export function graficiNelBrano(grafici: Grafico[] | undefined, brano: string): Grafico[] {
  if (!grafici?.length) return [];
  return grafici.filter((g) => brano.includes(`Grafico «${g.titolo}»`) || brano.includes(`Tabella «${g.titolo}»`));
}
