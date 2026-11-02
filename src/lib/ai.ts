import {
  buildDbRequest, buildWebRequest, callGemini, GeminiError, type ContextBlock, type GeminiAnswer
} from '../shared/gemini.ts';
import { runAi } from './router';
import type { LocalResult } from './search';
import { articlesOf, passagePage } from './articles';
import type { Settings } from './settings';
import { withModelFallback } from './model';
import { graficiNelBrano, graficoPerAi, pertinenza } from '../shared/charts.ts';

export type AiState =
  | { status: 'idle' }
  | { status: 'loading'; /** testo che sta arrivando */ partial?: string; /** es. cambio di servizio AI */ avviso?: string }
  | { status: 'done'; answer: GeminiAnswer }
  | { status: 'error'; error: GeminiError; disabledWeb?: boolean };

export { articlesOf } from './articles';

/**
 * Limite ai dati strutturati inviati all'AI (caratteri JSON, in totale): restano dentro ai limiti
 * gratuiti dei servizi di riserva e Gemini risponde in fretta. Passano prima le tabelle più pertinenti.
 */
export const MAX_DATI_AI = 12000;

export function toBlocks(results: LocalResult[], domanda = ''): ContextBlock[] {
  const conDati = new Set<string>();
  let budget = MAX_DATI_AI;
  return results.map((r) => {
    // tabelle e grafici del documento: una volta sola, nel primo brano del documento.
    // Solo quelli che c'entrano con la domanda o che compaiono nel brano trovato, i più pertinenti per primi.
    let grafici: string[] | undefined;
    if (r.record.grafici?.length && !conDati.has(r.record.id)) {
      conDati.add(r.record.id);
      const nel = new Set(results.filter((x) => x.record.id === r.record.id).flatMap((x) => graficiNelBrano(r.record.grafici, x.chunk.testo)));
      const ordinati = r.record.grafici
        .map((g) => ({ g, p: pertinenza(g, domanda) + (nel.has(g) ? 1 : 0) }))
        .filter((x) => x.p > 0)
        .sort((a, b) => b.p - a.p);
      // solo le più vicine alla domanda (almeno metà del punteggio migliore), al massimo 10
      const soglia = (ordinati[0]?.p ?? 0) / 2;
      ordinati.splice(0, ordinati.length, ...ordinati.filter((x) => x.p >= soglia).slice(0, 10));
      grafici = [];
      for (const { g } of ordinati) {
        const j = graficoPerAi(g);
        if (j.length > budget) continue;
        budget -= j.length;
        grafici.push(j);
      }
    }
    const a = articlesOf(r);
    const page = passagePage(r);
    return {
      recordId: r.record.id,
      titolo: r.record.titolo,
      categoria: r.record.categoria,
      fonte: r.record.fonte,
      data_aggiornamento: r.record.data_aggiornamento,
      testo: r.chunk.testo,
      ...(a.inizio ? { articolo: a.inizio } : {}),
      ...(a.nelBrano.length ? { articoliNelBrano: a.nelBrano } : {}),
      ...(page ? { pagina: page } : {}),
      ...(grafici?.length ? { grafici } : {})
    };
  });
}

const asGeminiError = (e: unknown) =>
  e instanceof GeminiError ? e : new GeminiError('sconosciuto', (e as Error)?.message || 'Errore imprevisto.');

/** Risposta "Dal database": solo sulla base dei blocchi trovati localmente. */
export async function askDatabase(
  question: string,
  results: LocalResult[],
  s: Settings,
  signal: AbortSignal,
  onPartial: (text: string) => void = () => {},
  onNotice: (msg: string) => void = () => {}
): Promise<AiState> {
  try {
    // in tempo reale: il testo compare mentre l'AI lo scrive; il tempo massimo vale per il silenzio.
    // Se Gemini non risponde si passa da soli alle AI di riserva configurate.
    const answer = await runAi(s, {
      request: buildDbRequest(question, toBlocks(results, question)),
      timeoutMs: 60000,
      signal,
      thinking: 'low',
      onText: onPartial,
      onNotice
    });
    return { status: 'done', answer };
  } catch (e) {
    return { status: 'error', error: asGeminiError(e) };
  }
}

/** Errori per cui la verifica sul web va disattivata (quota, modello o strumento non supportato). */
export function shouldDisableWeb(e: GeminiError): boolean {
  return e.kind === 'quota' || e.kind === 'non-supportato' || e.kind === 'modello' || (e.kind === 'sconosciuto' && e.status === 400);
}

/** Risposta "Dal web": grounding con Ricerca Google. */
export async function askWeb(question: string, s: Settings, signal: AbortSignal): Promise<AiState> {
  try {
    const answer = await withModelFallback(s, (model) =>
      callGemini(buildWebRequest(question), { apiKey: s.apiKey, model, timeoutMs: 60000, signal, thinking: 'low' })
    );
    return { status: 'done', answer };
  } catch (e) {
    const error = asGeminiError(e);
    return { status: 'error', error, disabledWeb: shouldDisableWeb(error) };
  }
}
