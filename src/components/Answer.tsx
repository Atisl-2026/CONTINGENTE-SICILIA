import { useState } from 'preact/hooks';
import type { AiState } from '../lib/ai';
import type { LocalResult } from '../lib/search';
import { citedIds } from '../shared/gemini.ts';
import { Markdown } from './Markdown';
import { ResultCard } from './ResultCard';
import { CitedDocs } from './CitedDocs';
import { resolveArticle } from '../lib/articles';
import { ChartCard } from './Chart';
import { numeriChiave } from '../lib/ai';
import { intentoDomanda } from '../shared/intento.ts';
import { pertinenza } from '../shared/charts.ts';
import { recordHref } from '../lib/route';

/** Perché la risposta AI non è disponibile (o null se lo è). */
export type AiUnavailable = 'offline' | 'nokey' | 'nonabilitato' | 'spenta' | null;

interface DbProps {
  /** domanda fatta: per i riepiloghi e i totali si mostrano i numeri chiave */
  domanda?: string;
  results: LocalResult[];
  ai: AiState;
  unavailable: AiUnavailable;
  recordCount?: number;
  onRetry: () => void;
}

/** Sezione "Dal database": risposta AI basata sui blocchi + blocchi trovati. Mai mescolata con il web. */
export function DbSection({ domanda = '', results, ai, unavailable, recordCount, onRetry }: DbProps) {
  const int = intentoDomanda(domanda);
  // riepilogo o totali senza risposta AI: i numeri chiave dei documenti statistici, subito visibili
  // i più vicini alla domanda per primi («ispezioni totali» → il riquadro con le pratiche distinte)
  const sintesi = int.generale || int.totali
    ? [...new Map(results.map((r) => [r.record.id, r.record])).values()]
      .flatMap((rec) => numeriChiave(rec.grafici).map((g, i) => ({ g, rec, p: pertinenza(g, domanda), i })))
      .sort((a, b) => b.p - a.p || a.i - b.i)
    : [];
  const sintesiCard = ({ g, rec }: (typeof sintesi)[number]) => (
    <ChartCard key={`${rec.id}-${g.titolo}`} g={g} fonte={<a href={recordHref(rec.id)}>{rec.titolo}</a>} />
  );
  const [showBlocks, setShowBlocks] = useState(false);
  const ids = new Set(results.map((r) => r.record.id));
  const titles = new Map(results.map((r) => [r.record.id, r.record.titolo]));
  // parole cercate in giallo e articoli in verde (collegati al punto del documento)
  const terms = [...new Set(results.flatMap((r) => r.terms))];
  const articleLink = (label: string, near: string[]) => resolveArticle(results, label, near, terms);
  const answered = ai.status === 'done';
  const cited = answered ? citedIds(ai.answer.text, ids) : [];
  // senza risposta AI i blocchi sono il contenuto principale e restano sempre visibili
  const blocksOpen = !answered || showBlocks;

  return (
    <section class="answer-section" aria-labelledby="sec-db">
      <h3 class="section-title" id="sec-db">Dal database</h3>

      {results.length === 0 && (
        <div class="card">
          {recordCount === 0 ? (
            <p>Il database è vuoto. <a href="#database">Importa dei contenuti</a> o controlla gli aggiornamenti.</p>
          ) : (
            <p class="muted">Nel database non ho trovato contenuti pertinenti. Prova con parole diverse o più generiche.</p>
          )}
        </div>
      )}

      {results.length > 0 && unavailable === 'offline' && (
        <p class="ai-hint" role="note">Risposta AI disponibile quando sei online.</p>
      )}
      {results.length > 0 && unavailable === 'spenta' && (
        <p class="ai-hint" role="note">Risposta AI spenta: qui sotto i risultati dell'archivio.</p>
      )}
      {results.length > 0 && unavailable === 'nokey' && (
        <p class="ai-hint" role="note">
          Per una risposta AI inserisci la chiave Gemini nelle <a href="#impostazioni">Impostazioni</a>.
        </p>
      )}

      {ai.status === 'loading' && ai.avviso && <p class="ai-switch small" role="status">{ai.avviso}</p>}

      {ai.status === 'loading' && !ai.partial && (
        <div class="card ai-card ai-loading" role="status">
          <span class="spinner" aria-hidden="true" /> L'AI sta leggendo i {results.length} blocchi trovati…
        </div>
      )}

      {ai.status === 'loading' && ai.partial && (
        <article class="card ai-card" aria-label="Risposta AI in arrivo" aria-busy="true">
          <Markdown
            terms={terms}
            articleLink={articleLink}
            text={ai.partial}
            ids={ids}
            label={(id) => String(citedIds(ai.partial!, ids).indexOf(id) + 1)}
            titleOf={(id) => titles.get(id) ?? id}
          />
          <p class="muted small streaming"><span class="spinner" aria-hidden="true" /> L'AI sta scrivendo…</p>
        </article>
      )}

      {ai.status === 'error' && (
        <div class="notice notice-error ai-error" role="alert">
          <span>{ai.error.message} {ai.error.kind !== 'chiave' && 'Qui sotto i risultati trovati sul dispositivo.'}</span>
          {['timeout', 'rete', 'sovraccarico', 'sconosciuto', 'vuota'].includes(ai.error.kind) && (
            <button type="button" class="btn" onClick={onRetry}>Riprova</button>
          )}
          {ai.error.kind === 'chiave' || ai.error.kind === 'modello' ? <a class="btn" href="#impostazioni">Impostazioni</a> : null}
        </div>
      )}

      {answered && (
        <article class="card ai-card" aria-label="Risposta AI basata sul database">
          <Markdown
            terms={terms}
            articleLink={articleLink}
            text={ai.answer.text}
            ids={ids}
            label={(id) => String(cited.indexOf(id) + 1)}
            titleOf={(id) => titles.get(id) ?? id}
          />
          {ai.answer.truncated && <p class="muted small">(risposta troncata per lunghezza)</p>}
          <CitedDocs cited={cited} results={results} title="Documenti citati" />
          {cited.length === 0 && <p class="muted small">La risposta non cita record specifici: verifica nei blocchi qui sotto.</p>}
          <p class="ai-disclaimer">
            Risposta generata da {ai.answer.servizio ?? 'Gemini'}{ai.answer.servizio && ai.answer.servizio !== 'Gemini' && ai.answer.modello ? ` (${ai.answer.modello})` : ''} sui contenuti del database: verifica sempre le fonti.
          </p>
        </article>
      )}

      {!answered && ai.status !== 'loading' && sintesi.length > 0 && (
        <div class="sintesi">
          <h4 class="sintesi-title">Numeri chiave</h4>
          {sintesi.slice(0, 2).map(sintesiCard)}
          {sintesi.length > 2 && (
            <details class="sintesi-altri">
              <summary>Altri numeri chiave ({sintesi.length - 2})</summary>
              {sintesi.slice(2).map(sintesiCard)}
            </details>
          )}
        </div>
      )}

      {results.length > 0 && answered && (
        <button type="button" class="link-btn" aria-expanded={showBlocks} onClick={() => setShowBlocks(!showBlocks)}>
          {showBlocks ? 'Nascondi i blocchi consultati' : `Mostra i ${results.length} blocchi consultati`}
        </button>
      )}
      {results.length > 0 && blocksOpen && results.map((r, i) => <ResultCard key={r.chunkId} r={r} index={i} />)}
    </section>
  );
}

/** Sezione "Dal web": risposta con Ricerca Google e link alle fonti (groundingMetadata). */
export function WebSection({ ai }: { ai: AiState }) {
  if (ai.status === 'idle') return null;
  return (
    <section class="answer-section web-section" aria-labelledby="sec-web">
      <h3 class="section-title" id="sec-web">Dal web</h3>

      {ai.status === 'loading' && (
        <div class="card ai-card web-card ai-loading" role="status">
          <span class="spinner" aria-hidden="true" /> Ricerca sul web in corso…
        </div>
      )}

      {ai.status === 'error' && (
        <p class="notice notice-error" role="alert">
          {ai.error.message}
          {ai.disabledWeb && ' «Verifica anche sul web» è stata disattivata.'}
        </p>
      )}

      {ai.status === 'done' && (
        <article class="card ai-card web-card" aria-label="Risposta dal web">
          <Markdown text={ai.answer.text} />
          {ai.answer.truncated && <p class="muted small">(risposta troncata per lunghezza)</p>}
          {ai.answer.sources.length > 0 ? (
            <div class="cited">
              <h4>Fonti web</h4>
              <ol>
                {ai.answer.sources.map((s) => (
                  <li key={s.uri}>
                    <a href={s.uri} target="_blank" rel="noopener noreferrer">{s.title}</a>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p class="muted small">Gemini non ha restituito link alle fonti per questa risposta.</p>
          )}
          {ai.answer.searchEntryPoint && (
            // Suggerimenti di Ricerca Google: vanno mostrati quando si usa il grounding.
            // iframe isolato (niente script, niente accesso alla pagina); i link si aprono in una nuova scheda.
            <iframe
              class="search-suggestions"
              title="Suggerimenti di Ricerca Google"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcdoc={`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><base target="_blank"><style>body{margin:0;background:transparent}</style>${ai.answer.searchEntryPoint}`}
            />
          )}
          <p class="ai-disclaimer">Risposta generata da Gemini con la Ricerca Google: non proviene dal database.</p>
        </article>
      )}
    </section>
  );
}
