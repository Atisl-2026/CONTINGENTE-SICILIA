// Caricamento di documenti dal telefono (programmatore): estrazione del testo nel browser,
// con le stesse regole di scripts/build-db.mjs (modulo condiviso src/shared/extract.ts).
import {
  DATE_PREFIX, fileToRecords, goodTitle, htmlNodeToText, idFromPath, prettify, readPdfWith, SUPPORTED_EXT, type Doc
} from '../shared/extract.ts';
import { normalizeText, parseDate } from '../shared/normalize.ts';
import type { DbRecord } from '../shared/types.ts';
import { buildChartExtractRequest, MAX_BYTES_AI, MIME_AI, parseChartExtract, toBase64, type LetturaAi } from '../shared/charts-ai.ts';
import { graficoToText } from '../shared/charts.ts';
import { titoliUnici } from '../shared/extract.ts';
import { callGemini } from '../shared/gemini.ts';
import { withModelFallback } from './model';
import type { Settings } from './settings';

export const ACCEPT = SUPPORTED_EXT.join(',');
/** Con l'AI si caricano anche foto o schermate di grafici. */
export const ACCEPT_AI = [...SUPPORTED_EXT, '.png', '.jpg', '.jpeg', '.webp'].join(',');

/** Legge grafici e tabelle di un PDF o di un'immagine con Gemini. */
export async function leggiGraficiConAi(bytes: Uint8Array, ext: string, nome: string, s: Settings): Promise<LetturaAi> {
  const mime = MIME_AI[ext];
  if (!mime) throw new Error('formato non leggibile dall\'AI');
  if (bytes.length > MAX_BYTES_AI) throw new Error(`file troppo grande per l'AI (massimo ${MAX_BYTES_AI / 1024 / 1024} MB)`);
  if (!s.apiKey.trim()) throw new Error('serve la chiave Gemini (Impostazioni)');
  const req = buildChartExtractRequest(toBase64(bytes), mime, nome);
  const answer = await withModelFallback(s, (model) =>
    callGemini(req, { apiKey: s.apiKey, model, timeoutMs: 180000, thinking: 'low' })
  );
  return parseChartExtract(answer.text, mime.startsWith('image/'));
}

export interface UploadResult {
  file: string;
  records: DbRecord[];
  warnings: string[];
  error?: string;
}

function readHtml(html: string): Doc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = goodTitle(doc.querySelector('title')?.textContent) || goodTitle(doc.querySelector('h1')?.textContent);
  const start = doc.querySelector('main') ?? doc.querySelector('article') ?? doc.body ?? doc.documentElement;
  const text = htmlNodeToText<Node>(start, {
    isText: (n) => n.nodeType === Node.TEXT_NODE,
    isElement: (n) => n.nodeType === Node.ELEMENT_NODE,
    tag: (n) => n.nodeName.toLowerCase(),
    text: (n) => n.nodeValue ?? '',
    children: (n) => Array.from(n.childNodes)
  });
  return { title, text };
}

async function readPdf(bytes: Uint8Array, warn: (m: string) => void): Promise<Doc> {
  let unpdf;
  try {
    unpdf = await import('unpdf'); // caricato solo quando serve (~1,7 MB)
  } catch {
    if (!navigator.onLine) throw new Error('il lettore PDF non è disponibile: serve la connessione la prima volta');
    // online: quasi sempre è una versione vecchia dell'app ancora aperta mentre il sito è stato aggiornato
    try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* niente */ }
    throw new Error('il lettore PDF di questa versione dell\'app non è più sul sito perché nel frattempo è uscita una versione nuova. Tocca «Aggiorna» nel riquadro in alto (oppure chiudi del tutto l\'app e riaprila) e carica di nuovo il file.');
  }
  try {
    return await readPdfWith(unpdf as never, bytes, warn);
  } catch (e) {
    throw new Error(`impossibile leggere il PDF (${(e as Error).message}). Se il problema persiste caricalo dal computer.`);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Estrae le schede da un file scelto dall'utente. Non salva nulla. */
export async function extractUpload(
  file: File,
  opts: { categoria: string; demo: boolean; /** impostazioni AI: se presenti, grafici di PDF e immagini letti con l'AI */ ai?: Settings }
): Promise<UploadResult> {
  const warnings: string[] = [];
  const name = file.name;
  const ext = (name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  const baseName = name.replace(/\.[^.]+$/, '');
  const datePrefix = baseName.match(DATE_PREFIX);
  const cleanName = baseName.replace(DATE_PREFIX, '');
  const categoria = opts.categoria.trim() || 'Generale';

  const immagine = /^\.(png|jpe?g|webp)$/.test(ext);
  if (immagine && !opts.ai) {
    return { file: name, records: [], warnings, error: 'Le immagini si leggono solo con l\'AI attiva (chiave Gemini e connessione).' };
  }
  if (!SUPPORTED_EXT.includes(ext) && !immagine) {
    const hint = /^\.(doc|xls|ppt|rtf|odt|ods|odp)$/.test(ext) ? ' Salvalo in formato moderno (.docx, .xlsx, .pptx) e riprova.' : '';
    return { file: name, records: [], warnings, error: `Formato non supportato.${hint}` };
  }

  const ctx = {
    fileId: idFromPath([categoria, cleanName]),
    label: name,
    defaults: {
      categoria,
      tag: [],
      fonte: name,
      data_aggiornamento: (datePrefix && parseDate(datePrefix[1])) || parseDate(new Date(file.lastModified)) || today(),
      demo: opts.demo
    },
    fallbackTitle: prettify(cleanName),
    warn: (m: string) => warnings.push(m)
  };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let records = immagine ? [] : await fileToRecords(bytes, ext, ctx, { pdf: (b) => readPdf(b, ctx.warn), html: readHtml });
    if ((ext === '.pdf' || immagine) && opts.ai) {
      try {
        const letti = await leggiGraficiConAi(bytes, ext, name, opts.ai);
        records = conGraficiAi(records, letti, ctx);
        warnings.push(letti.grafici.length
          ? `l'AI ha letto ${letti.grafici.length} ${letti.grafici.length === 1 ? 'grafico o tabella' : 'grafici e tabelle'}: controlla i numeri`
          : "l'AI non ha trovato grafici o tabelle numeriche");
      } catch (e) {
        warnings.push(`grafici non letti con l'AI: ${(e as Error).message}`);
      }
    }
    if (!records.length && !warnings.length) warnings.push('nessun testo trovato');
    return { file: name, records, warnings };
  } catch (e) {
    return { file: name, records: [], warnings, error: `Errore: ${(e as Error).message}` };
  }
}

/** Aggiunge alla scheda del file (o crea, per immagini e scansioni) i grafici letti dall'AI. */
function conGraficiAi(
  records: DbRecord[],
  letti: LetturaAi,
  ctx: { fileId: string; fallbackTitle: string; defaults: Omit<DbRecord, 'id' | 'titolo' | 'testo'> & { demo: boolean } }
): DbRecord[] {
  if (!letti.grafici.length && records.length) return records;
  const base: DbRecord = records[0] ?? {
    id: ctx.fileId,
    titolo: ctx.fallbackTitle,
    testo: '',
    categoria: ctx.defaults.categoria,
    tag: ctx.defaults.tag,
    fonte: ctx.defaults.fonte,
    data_aggiornamento: ctx.defaults.data_aggiornamento,
    ...(ctx.defaults.demo ? { demo: true } : {})
  };
  const unico = titoliUnici();
  const grafici = [...(base.grafici ?? []).map(unico), ...letti.grafici.map(unico)];
  const testoGrafici = letti.grafici.map((g) => graficoToText(g)).join('\n\n');
  const testo = normalizeText([
    base.testo || letti.descrizione,
    testoGrafici && `Grafici e tabelle letti con l'AI:\n\n${testoGrafici}`
  ].filter(Boolean).join('\n\n'));
  const out: DbRecord = { ...base, testo, ...(grafici.length ? { grafici } : {}) };
  return [out, ...records.slice(1)];
}
