// Sceglie quale AI usare, nell'ordine e con le regole decise dal programmatore (servizi attivi, limiti di
// domande per socio). Se un servizio non risponde (limite raggiunto, sovraccarico, lentezza, modello
// non disponibile) si passa da soli al successivo; chi ha esaurito la quota viene saltato per un po'.
import {
  callGemini, cleanModelName, GeminiError, streamGemini, type GeminiAnswer, type GeminiRequest, type ThinkingLevel
} from '../shared/gemini.ts';
import {
  callChat, hasImages, hasPdf, listChatModels, pickModel, PROVIDERS, type ChatModel, type ProviderId
} from '../shared/providers.ts';
import { CLAUDE_DEFAULT_MODEL } from '../shared/claude.ts';
import {
  conta, descriviLimite, ordineDi, regolaDi, residue, type Conteggi, type Fornitore
} from '../shared/politica.ts';
import { withModelFallback } from './model';
import type { Settings } from './settings';
import { getAccess } from './access';

export type { Fornitore } from '../shared/politica.ts';

export const nomeFornitore = (f: Fornitore) => (f === 'gemini' ? 'Gemini' : PROVIDERS[f].nome);

export interface AiTask {
  request: GeminiRequest;
  /** chiamata normale: tempo massimo; in tempo reale: tempo massimo di silenzio */
  timeoutMs: number;
  signal: AbortSignal;
  thinking?: ThinkingLevel;
  /** se presente la risposta arriva in tempo reale */
  onText?: (text: string) => void;
  /** avvisi da mostrare (es. "Gemini ha raggiunto il limite: provo con Groq…") */
  onNotice?: (msg: string) => void;
  /** servizio da provare per primo (es. quello che ha risposto al passo precedente) */
  prefer?: Fornitore;
  /** servizi già falliti in questa operazione: si provano solo se non resta altro */
  skip?: Set<Fornitore>;
  /** compito semplice: con Gemini prima un modello leggero (risparmia la quota del modello principale) */
  leggero?: boolean;
  /** false = non conta come domanda nei limiti dei soci (es. primo passo dell'analisi di una foto) */
  conta?: boolean;
}

export interface AiAnswer extends GeminiAnswer {
  fornitore: Fornitore;
}

/** Ha la chiave? */
export function configurato(s: Settings, f: Fornitore): boolean {
  return f === 'gemini' ? !!s.apiKey.trim() : !!s.riserve[f]?.apiKey?.trim();
}

// ------------------------------------------------------------ domande dei soci (contate sul telefono)

const CONTEGGI_STORE = 'contingente-ai-domande';

// se la memoria del browser non è disponibile (navigazione privata) si conta finché l'app resta aperta
let conteggiInMemoria: Conteggi = {};

export function leggiConteggi(): Conteggi {
  try {
    const raw = localStorage.getItem(CONTEGGI_STORE);
    return raw ? JSON.parse(raw) as Conteggi : conteggiInMemoria;
  } catch {
    return conteggiInMemoria;
  }
}

function registraDomanda(f: Fornitore) {
  conteggiInMemoria = conta(leggiConteggi(), f);
  try { localStorage.setItem(CONTEGGI_STORE, JSON.stringify(conteggiInMemoria)); } catch { /* resta in memoria */ }
}

/**
 * Servizi utilizzabili, nell'ordine scelto dal programmatore: con la chiave, attivi e, per un socio,
 * con domande ancora disponibili.
 */
export function availableAi(s: Settings, opts: { socio?: boolean; conteggi?: Conteggi } = {}): Fornitore[] {
  const c = opts.socio ? opts.conteggi ?? leggiConteggi() : {};
  return ordineDi(s.politica).filter((f) =>
    configurato(s, f) && regolaDi(s.politica, f).attivo && (!opts.socio || residue(s.politica, c, f) > 0));
}

export function hasAi(s: Settings): boolean {
  return availableAi(s).length > 0;
}

/** Servizi che hanno esaurito la quota (fino a quando): ricordati anche chiudendo l'app. */
const COOLDOWN_STORE = 'contingente-ai-in-pausa';
const cooldown = new Map<Fornitore, number>(loadCooldown());
function loadCooldown(): [Fornitore, number][] {
  try {
    const now = Date.now();
    return Object.entries(JSON.parse(localStorage.getItem(COOLDOWN_STORE) ?? '{}') as Record<string, number>)
      .filter(([, t]) => t > now) as [Fornitore, number][];
  } catch {
    return [];
  }
}
function saveCooldown() {
  try { localStorage.setItem(COOLDOWN_STORE, JSON.stringify(Object.fromEntries(cooldown))); } catch { /* niente */ }
}
const modelLists = new Map<string, Promise<ChatModel[]>>();

function chatModels(p: ProviderId, apiKey: string): Promise<ChatModel[]> {
  const k = `${p}:${apiKey}`;
  let list = modelLists.get(k);
  if (!list) {
    list = listChatModels(p, apiKey);
    list.catch(() => modelLists.delete(k));
    modelLists.set(k, list);
  }
  return list;
}

function cooldownUntil(f: Fornitore, e: GeminiError): number {
  const q = e.quota;
  // Gemini: i limiti sono per modello, li gestisce withModelFallback; qui solo una pausa breve
  if (f === 'gemini') return Date.now() + (q?.periodo === 'giorno' ? 15 * 60_000 : Math.max(30, q?.attesaS ?? 60) * 1000);
  if (e.status === 402 || q?.limite === 0 || q?.periodo === 'giorno') return Date.now() + 3 * 3600_000;
  return Date.now() + Math.max(30, q?.attesaS ?? 60) * 1000;
}

const asGeminiError = (e: unknown) =>
  e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');

async function viaGemini(s: Settings, t: AiTask): Promise<AiAnswer> {
  let used = cleanModelName(s.model);
  const answer = await withModelFallback(s, (model) => {
    used = model;
    const opts = { apiKey: s.apiKey, model, timeoutMs: t.timeoutMs, signal: t.signal, thinking: t.thinking };
    return t.onText ? streamGemini(t.request, { ...opts, onText: t.onText }) : callGemini(t.request, opts);
  }, { leggero: t.leggero });
  return { ...answer, fornitore: 'gemini', servizio: 'Gemini', modello: used };
}

async function viaReserve(p: ProviderId, s: Settings, t: AiTask): Promise<AiAnswer> {
  const key = s.riserve[p]!;
  const vision = hasImages(t.request);
  const auto = async () => {
    let lista: ChatModel[];
    try {
      lista = await chatModels(p, key.apiKey);
    } catch (e) {
      if (p === 'claude') return CLAUDE_DEFAULT_MODEL; // elenco non disponibile: il modello economico
      throw e;
    }
    const m = pickModel(p, lista, vision);
    if (!m) {
      throw new GeminiError('non-supportato', `${PROVIDERS[p].nome}: nessun modello${PROVIDERS[p].pagamento ? '' : ' gratuito'}${vision ? ' che legga le foto' : ''} disponibile.`);
    }
    return m;
  };
  let model = key.model?.trim() || (await auto());
  const run = (m: string) => callChat(p, t.request, { apiKey: key.apiKey, model: m, timeoutMs: t.timeoutMs, signal: t.signal, onText: t.onText });
  let answer: GeminiAnswer;
  try {
    answer = await run(model);
  } catch (e) {
    // modello scelto a mano non più disponibile: si torna alla scelta automatica
    if (!(e instanceof GeminiError) || e.kind !== 'modello' || !key.model?.trim()) throw e;
    model = await auto();
    answer = await run(model);
  }
  return { ...answer, fornitore: p, servizio: PROVIDERS[p].nome, modello: model };
}

/** Esegue la richiesta con il primo servizio che risponde. */
export async function runAi(s: Settings, t: AiTask): Promise<AiAnswer> {
  const socio = (await getAccess())?.ruolo === 'socio';
  let order = availableAi(s, { socio });
  // i PDF li leggono solo Gemini, Claude e ChatGPT
  if (hasPdf(t.request)) order = order.filter((f) => f === 'gemini' || PROVIDERS[f].pdf);
  if (!order.length) {
    const esauriti = socio ? availableAi(s).filter((f) => !hasPdf(t.request) || f === 'gemini' || PROVIDERS[f].pdf) : [];
    if (esauriti.length) {
      const dettagli = esauriti.map((f) => `${nomeFornitore(f)}: ${descriviLimite(regolaDi(s.politica, f))}`).join('; ');
      throw new GeminiError('quota', `Hai usato tutte le domande AI a tua disposizione (${dettagli}). I limiti li stabilisce il programmatore; la ricerca nell'archivio resta disponibile.`);
    }
    throw new GeminiError('chiave', hasPdf(t.request)
      ? 'Per leggere i PDF serve Gemini, Claude o ChatGPT: inserisci una di queste chiavi nelle Impostazioni.'
      : 'Nessuna AI configurata: inserisci la chiave Gemini o un altro servizio AI nelle Impostazioni.');
  }
  if (t.prefer && order.includes(t.prefer)) order = [t.prefer, ...order.filter((f) => f !== t.prefer)];
  const now = Date.now();
  const fresh = order.filter((f) => !t.skip?.has(f) && (cooldown.get(f) ?? 0) <= now);
  // chi ha esaurito la quota da poco si prova per ultimo (il limite potrebbe essersi già azzerato)
  const tired = order.filter((f) => !t.skip?.has(f) && !fresh.includes(f));
  const queue = fresh.length || tired.length ? [...fresh, ...tired] : order;

  const errors: { f: Fornitore; err: GeminiError }[] = [];
  // il messaggio dice sempre quale servizio ha avuto il problema
  const label = (x: { f: Fornitore; err: GeminiError }) =>
    x.err.message.startsWith(nomeFornitore(x.f))
      ? x.err.message
      : `${nomeFornitore(x.f)}: ${x.err.message.replace(/^./, (c) => c.toLowerCase())}`;
  for (const f of queue) {
    if (errors.length) t.onNotice?.(`${label(errors[errors.length - 1])} Provo con ${nomeFornitore(f)}…`);
    try {
      const answer = f === 'gemini' ? await viaGemini(s, t) : await viaReserve(f, s, t);
      if (cooldown.delete(f)) saveCooldown();
      if (socio && t.conta !== false) registraDomanda(f);
      return answer;
    } catch (e) {
      const err = asGeminiError(e);
      if (err.kind === 'annullata' || t.signal.aborted) throw new GeminiError('annullata', 'Richiesta annullata.');
      t.skip?.add(f);
      if (err.kind === 'quota') {
        cooldown.set(f, cooldownUntil(f, err));
        saveCooldown();
      }
      errors.push({ f, err });
    }
  }
  if (errors.length === 1) throw errors[0].err;
  const kinds = errors.map((x) => x.err.kind);
  const first = errors[0].err;
  throw new GeminiError(
    kinds.includes('timeout') ? 'timeout' : kinds.includes('sovraccarico') ? 'sovraccarico' : first.kind,
    `Nessuna AI ha risposto:\n${errors.map((x) => `• ${label(x)}`).join('\n')}`,
    first.status,
    first.quota
  );
}

/** Solo per i test. */
export function resetRouter() {
  cooldown.clear();
  saveCooldown();
  conteggiInMemoria = {};
  try { localStorage.removeItem(CONTEGGI_STORE); } catch { /* niente */ }
  modelLists.clear();
}
