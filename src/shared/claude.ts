// Claude (Anthropic, API Messages) chiamato direttamente dal telefono: la richiesta in formato Gemini
// (GeminiRequest) diventa un messaggio Claude, con testo, foto e PDF; la risposta torna come GeminiAnswer.
// Le chiamate dal browser richiedono l'intestazione «anthropic-dangerous-direct-browser-access»:
// la chiave è dell'amministratore e arriva ai soci cifrata con la password AI, come quella di Gemini.
import { GeminiError, parseQuota, schemaInstruction, type GeminiAnswer, type GeminiRequest } from './gemini.ts';

export const CLAUDE_BASE = 'https://api.anthropic.com/v1';
export const CLAUDE_VERSION = '2023-06-01';
/** Modello predefinito: il più economico, ottimo per domande sui documenti. */
export const CLAUDE_DEFAULT_MODEL = 'claude-haiku-5-5';

export function claudeHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey.trim(),
    'anthropic-version': CLAUDE_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true'
  };
}

type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export interface ClaudeBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: ClaudeBlock[] }[];
  temperature?: number;
  stream?: boolean;
}

/** GeminiRequest → corpo dell'API Messages (lo schema JSON, se c'è, diventa un'istruzione). */
export function toClaudeBody(req: GeminiRequest, model: string, stream: boolean): ClaudeBody {
  const gc = (req.generationConfig ?? {}) as { temperature?: number; maxOutputTokens?: number; responseSchema?: unknown; responseMimeType?: string };
  const system = [
    ...(req.systemInstruction?.parts ?? []).map((p) => p.text),
    gc.responseMimeType === 'application/json' ? schemaInstruction(gc.responseSchema) : ''
  ].filter(Boolean).join('\n\n');
  const messages: ClaudeBody['messages'] = req.contents.map((c) => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: c.parts.map((p): ClaudeBlock => {
      if (!('inlineData' in p)) return { type: 'text', text: p.text };
      const { mimeType, data } = p.inlineData;
      return mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
    })
  }));
  return {
    model,
    max_tokens: gc.maxOutputTokens ?? 8192,
    ...(system ? { system } : {}),
    messages,
    ...(gc.temperature != null ? { temperature: Math.min(1, gc.temperature) } : {}),
    ...(stream ? { stream: true } : {})
  };
}

interface ClaudeError { type?: string; error?: { type?: string; message?: string } }

/** Errore di Claude → GeminiError (stessi tipi degli altri servizi). */
export function classifyClaudeError(status: number, body: unknown): GeminiError {
  const e = (body as ClaudeError)?.error ?? {};
  const msg = e.message ?? '';
  const tipo = e.type ?? '';
  if (status === 401 || tipo === 'authentication_error') return new GeminiError('chiave', 'Claude: chiave non valida o revocata. Controllala nelle Impostazioni.', status);
  if (/credit balance|billing|purchase credits/i.test(msg)) {
    return new GeminiError('quota', 'Claude: credito esaurito. Ricarica il credito sul sito di Anthropic.', status, { periodo: 'giorno' });
  }
  if (status === 429 || tipo === 'rate_limit_error') {
    const q = parseQuota({ error: { message: msg } });
    return new GeminiError('quota', 'Claude: troppe richieste in poco tempo. Riprova tra un minuto.', status, q);
  }
  if (status === 404 || tipo === 'not_found_error' || /model/i.test(msg) && status === 400 && /not.*(found|exist|support)/i.test(msg)) {
    return new GeminiError('modello', 'Claude: modello non disponibile.', status);
  }
  if (status === 413 || tipo === 'request_too_large') return new GeminiError('sconosciuto', 'Claude: richiesta troppo grande (file troppo pesante).', status);
  if (status === 403 || tipo === 'permission_error') return new GeminiError('chiave', `Claude: accesso negato${msg ? ` (${msg})` : ''}.`, status);
  if (status === 529 || tipo === 'overloaded_error' || status >= 500) return new GeminiError('sovraccarico', 'Claude: servizio momentaneamente sovraccarico.', status);
  return new GeminiError('sconosciuto', `Claude: errore ${status}${msg ? `: ${msg}` : ''}`, status);
}

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onText?: (text: string) => void;
}

/** Chiamata all'API Messages, normale o in tempo reale, con tempo massimo e annullamento. */
export async function callClaude(req: GeminiRequest, opts: ClaudeOptions): Promise<GeminiAnswer> {
  if (!opts.apiKey.trim()) throw new GeminiError('chiave', 'Claude: manca la chiave.');
  const stream = !!opts.onText && typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const limit = opts.timeoutMs ?? 60000;
  let timedOut = false;
  let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
  };
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const fail = (): never => {
    if (timedOut) throw new GeminiError('timeout', 'Claude non ha risposto in tempo.');
    if (opts.signal?.aborted) throw new GeminiError('annullata', 'Richiesta annullata.');
    throw new GeminiError('rete', 'Claude: connessione non riuscita (rete assente o servizio non raggiungibile).');
  };

  try {
    let res: Response;
    try {
      res = await doFetch(`${CLAUDE_BASE}/messages`, {
        method: 'POST',
        headers: claudeHeaders(opts.apiKey),
        body: JSON.stringify(toClaudeBody(req, opts.model, stream)),
        signal: ctrl.signal
      });
    } catch {
      return fail();
    }
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non JSON */ }
      throw classifyClaudeError(res.status, body);
    }
    if (!stream || !res.body) {
      let json: { content?: { type: string; text?: string }[]; stop_reason?: string } & ClaudeError;
      try { json = await res.json(); } catch { return fail(); }
      if (json.type === 'error') throw classifyClaudeError(500, json);
      const text = (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
      if (!text) throw new GeminiError('vuota', 'Claude ha restituito una risposta vuota.');
      return { text, truncated: json.stop_reason === 'max_tokens', finishReason: json.stop_reason, sources: [], searchQueries: [] };
    }

    // tempo reale: eventi content_block_delta (testo), message_delta (motivo di fine), error
    let text = '';
    let stop: string | undefined;
    const handle = (data: string) => {
      let ev: { type?: string; delta?: { type?: string; text?: string; stop_reason?: string } } & ClaudeError;
      try { ev = JSON.parse(data); } catch { return; }
      if (ev.type === 'error') throw classifyClaudeError(ev.error?.type === 'overloaded_error' ? 529 : 500, ev);
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text;
        opts.onText?.(text);
      }
      if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
    };
    const consume = (buf: string): string => {
      const events = buf.split(/\r?\n\r?\n/);
      const rest = events.pop() ?? '';
      for (const evt of events) {
        const data = evt.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (data) handle(data);
      }
      return rest;
    };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        poke();
        buf = consume(buf + dec.decode(value, { stream: true }));
      }
      consume(buf + dec.decode() + '\n\n');
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (!text.trim()) fail();
      stop = 'max_tokens'; // interrotta a metà: si tiene il testo arrivato
    }
    if (!text.trim()) throw new GeminiError('vuota', 'Claude ha restituito una risposta vuota.');
    return { text: text.trim(), truncated: stop === 'max_tokens', finishReason: stop, sources: [], searchQueries: [] };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
