import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDbRequest, type GeminiRequest } from '../src/shared/gemini.ts';
import { buildChartExtractRequest } from '../src/shared/charts-ai.ts';
import { callClaude, classifyClaudeError, toClaudeBody } from '../src/shared/claude.ts';
import { toChatBody } from '../src/shared/providers.ts';
import { conta, normalizePolitica, ordineDi, residue, type PoliticaAi } from '../src/shared/politica.ts';
import type { Settings } from '../src/lib/settings';

const dbReq = buildDbRequest('Quante ispezioni a Catania?', [{ recordId: 'rep', titolo: 'Report', categoria: '', fonte: '', data_aggiornamento: '', testo: 'Catania 512' }]);
const pdfReq = buildChartExtractRequest('JVBERi0=', 'application/pdf', 'report.pdf');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (events: unknown[]) => new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

describe('Claude', () => {
  it('richiesta: istruzioni in «system», PDF come documento, schema JSON come istruzione', () => {
    const b = toClaudeBody(pdfReq, 'claude-haiku-5-5', false);
    expect(b.system).toMatch(/analista di dati[\s\S]*Rispondi SOLO con un oggetto JSON/);
    expect(b.messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } });
    expect(b.max_tokens).toBeGreaterThan(1000);
  });
  it('chiamata diretta dal telefono con le intestazioni di Anthropic, risposta in tempo reale', async () => {
    const fetchImpl = vi.fn(async () => sse([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Catania: ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '512 [rep]' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
    ]));
    const seen: string[] = [];
    const a = await callClaude(dbReq, { apiKey: ' sk-ant-x ', model: 'claude-haiku-5-5', fetchImpl, onText: (t) => seen.push(t) });
    expect(a.text).toBe('Catania: 512 [rep]');
    expect(seen).toEqual(['Catania: ', 'Catania: 512 [rep]']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-x', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'claude-haiku-5-5', stream: true });
  });
  it('errori: credito esaurito, chiave, sovraccarico', () => {
    expect(classifyClaudeError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }))
      .toMatchObject({ kind: 'quota', message: expect.stringMatching(/credito esaurito/) });
    expect(classifyClaudeError(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }).kind).toBe('chiave');
    expect(classifyClaudeError(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }).kind).toBe('sovraccarico');
  });
});

describe('ChatGPT (OpenAI)', () => {
  it('parametri dei modelli recenti e PDF come file', () => {
    const b = toChatBody(pdfReq, 'gpt-6-luna', false, 'openai');
    expect(b).not.toHaveProperty('temperature');
    expect(b).not.toHaveProperty('max_tokens');
    expect(b.max_completion_tokens).toBeGreaterThanOrEqual(8192);
    const parts = b.messages[1].content as { type: string }[];
    expect(parts[0]).toMatchObject({ type: 'file', file: { filename: 'documento.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } });
  });
});

describe('regole del programmatore', () => {
  const pol: PoliticaAi = { ordine: ['claude', 'gemini'], regole: { claude: { attivo: true, limite: 2, periodo: 'giorno' }, groq: { attivo: false, limite: 0, periodo: 'giorno' } } };
  it('ordine scelto, poi gli altri; limite per giorno che si azzera il giorno dopo', () => {
    expect(ordineDi(pol)).toEqual(['claude', 'gemini', 'openai', 'groq', 'mistral', 'openrouter']);
    const oggi = new Date(2026, 10, 2, 10);
    let c = conta(conta({}, 'claude', oggi), 'claude', oggi);
    expect(residue(pol, c, 'claude', oggi)).toBe(0);
    expect(residue(pol, c, 'claude', new Date(2026, 10, 3, 9))).toBe(2);
    expect(residue(pol, c, 'gemini', oggi)).toBe(Infinity);
    c = conta(c, 'claude', new Date(2026, 10, 3, 9));
    expect(Object.keys(c.claude!)).toEqual(['2026-11-03', '2026-11']); // i giorni passati non si accumulano
  });
  it('regole ricevute ripulite', () => {
    expect(normalizePolitica({ ordine: ['claude', 'pippo'], regole: { claude: { attivo: 'x', limite: '-3', periodo: 'anno' } } }))
      .toEqual({ ordine: ['claude'], regole: { claude: { attivo: true, limite: 0, periodo: 'giorno' } } });
  });
});

describe('servizi in ordine, con regole e limiti (fetch simulato)', () => {
  const base = (over: Partial<Settings> = {}): Settings => ({
    autoCheck: true, webCheck: false, categorie: [], documento: '', apiKey: 'AIza', model: 'gemini-2.5-flash',
    riserve: { claude: { apiKey: 'sk-ant', model: 'claude-haiku-5-5' }, openai: { apiKey: 'sk-oa', model: 'gpt-6-luna' }, groq: { apiKey: 'gsk' } }, ...over
  });
  let calls: string[];
  beforeEach(async () => {
    calls = [];
    (await import('../src/lib/router')).resetRouter();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(new URL(url).host);
      const body = init?.body ? JSON.parse(String(init.body)) as GeminiRequest & { model?: string } : {};
      if (url.includes('anthropic')) return json(200, { content: [{ type: 'text', text: 'da Claude' }], stop_reason: 'end_turn' });
      if (url.includes('openai')) return json(200, { choices: [{ message: { content: `da ChatGPT ${(body as { model?: string }).model}` } }] });
      if (url.includes('groq')) return json(200, { choices: [{ message: { content: 'da Groq' } }] });
      return json(200, { candidates: [{ content: { parts: [{ text: 'da Gemini' }] }, finishReason: 'STOP' }] });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
  const ask = async (s: Settings, req = dbReq) => (await import('../src/lib/router')).runAi(s, { request: req, timeoutMs: 5000, signal: new AbortController().signal });

  it('ordine scelto dal programmatore e servizi disattivati', async () => {
    const pol: PoliticaAi = { ordine: ['openai', 'claude', 'gemini'], regole: { openai: { attivo: false, limite: 0, periodo: 'giorno' } } };
    const a = await ask(base({ politica: pol }));
    expect(a).toMatchObject({ fornitore: 'claude', text: 'da Claude' });
    expect(calls).toEqual(['api.anthropic.com']);
  });

  it('PDF: si saltano i servizi che non leggono i PDF', async () => {
    const pol: PoliticaAi = { ordine: ['groq', 'openai'], regole: {} };
    const a = await ask(base({ politica: pol }), pdfReq);
    expect(a.fornitore).toBe('openai');
    expect(calls).toEqual(['api.openai.com']);
  });

  it('socio: dopo il limite si passa al servizio successivo, poi un messaggio chiaro', async () => {
    const { setAccess } = await import('../src/lib/access');
    await setAccess({ ruolo: 'socio' });
    const pol: PoliticaAi = { ordine: ['claude', 'gemini'], regole: {
      claude: { attivo: true, limite: 1, periodo: 'giorno' }, gemini: { attivo: true, limite: 1, periodo: 'mese' },
      openai: { attivo: false, limite: 0, periodo: 'giorno' }, groq: { attivo: false, limite: 0, periodo: 'giorno' }
    } };
    const s = base({ politica: pol });
    expect((await ask(s)).fornitore).toBe('claude');
    expect((await ask(s)).fornitore).toBe('gemini');
    await expect(ask(s)).rejects.toMatchObject({ kind: 'quota', message: expect.stringMatching(/Hai usato tutte le domande AI.*Claude: 1 domanda al giorno; Gemini: 1 domanda al mese/) });
    await setAccess({ ruolo: 'admin' });
    expect((await ask(s)).fornitore).toBe('claude'); // il programmatore non ha limiti
  });
});
