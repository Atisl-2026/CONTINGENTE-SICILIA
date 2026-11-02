import { useState } from 'preact/hooks';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { GeminiError } from '../shared/gemini.ts';
import {
  listChatModels, pickModel, PROVIDER_ORDER, PROVIDERS, type ChatModel, type ProviderId, type ProviderKey
} from '../shared/providers.ts';

const PAGAMENTO = PROVIDER_ORDER.filter((id) => PROVIDERS[id].pagamento);
const GRATUITI = PROVIDER_ORDER.filter((id) => !PROVIDERS[id].pagamento);

/**
 * Servizi AI a pagamento (Claude, ChatGPT): predisposti, si attivano inserendo la chiave.
 * Quali usare, in che ordine e con quanti limiti per i soci si decide in «Regole dei servizi AI».
 */
export function PaidAiSettings({ online }: { online: boolean }) {
  const s = useSettings();
  const attive = PAGAMENTO.filter((id) => s.riserve[id]?.apiKey?.trim());
  return (
    <div class="card">
      <h3>Claude e ChatGPT (a pagamento)</h3>
      <p class="muted small">
        Più affidabili dei piani gratuiti: niente limiti giornalieri né blocchi nelle ore di punta, e leggono anche foto e PDF.
        Si pagano a consumo con credito prepagato, separato dagli abbonamenti Claude Pro o ChatGPT Plus. Con i modelli
        economici (scelti in automatico) una domanda costa circa un millesimo di dollaro.
      </p>
      <p class="small">
        {attive.length
          ? <>Configurati: <strong>{attive.map((id) => PROVIDERS[id].nome).join(', ')}</strong>.</>
          : 'Nessuno configurato: si attivano inserendo la chiave.'}
      </p>
      {PAGAMENTO.map((id) => <ProviderBox key={id} id={id} value={s.riserve[id]} online={online} />)}
      <p class="muted small">
        <strong>Consiglio:</strong> sul sito del servizio imposta un limite di spesa mensile. La chiave arriva ai soci con la
        password AI (cifrata), quindi chi la conosce potrebbe usarla anche fuori dall'app.
      </p>
    </div>
  );
}

/**
 * AI gratuite di riserva: se il servizio precedente non risponde (limite raggiunto, sovraccarico, lentezza)
 * l'app passa da sola alla prossima.
 */
export function ReserveSettings({ online }: { online: boolean }) {
  const s = useSettings();
  const attive = GRATUITI.filter((id) => s.riserve[id]?.apiKey?.trim());
  return (
    <div class="card">
      <h3>AI gratuite di riserva</h3>
      <p class="muted small">
        Se un servizio non risponde (limite gratuito raggiunto, sovraccarico, troppa lentezza) l'app passa da sola al
        successivo, nell'ordine scelto in <strong>Regole dei servizi AI</strong>. Sotto ogni risposta è indicata l'AI che
        l'ha scritta. Hanno un piano gratuito: servono solo una registrazione e una chiave.
      </p>
      <p class="small">
        {attive.length
          ? <>Riserve attive: <strong>{attive.map((id) => PROVIDERS[id].nome).join(', ')}</strong>.</>
          : 'Nessuna riserva attiva.'}
      </p>
      {GRATUITI.map((id) => <ProviderBox key={id} id={id} value={s.riserve[id]} online={online} />)}
      <p class="muted small">
        Le chiavi restano solo su questo dispositivo (non nel codice, non su GitHub, non nei backup). Se condividi
        l'AI con i soci, vengono condivise anche queste, cifrate con la password AI.
      </p>
    </div>
  );
}

function ProviderBox({ id, value, online }: { id: ProviderId; value?: ProviderKey; online: boolean }) {
  const p = PROVIDERS[id];
  const [key, setKey] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [models, setModels] = useState<ChatModel[] | null>(null);
  const keyValue = key ?? value?.apiKey ?? '';

  const store = async (patch: Partial<ProviderKey> | null) => {
    const riserve = { ...(await getSettings()).riserve };
    if (patch === null) delete riserve[id];
    else riserve[id] = { apiKey: '', ...riserve[id], ...patch };
    if (riserve[id] && !riserve[id]!.apiKey.trim()) delete riserve[id];
    await updateSettings({ riserve });
  };

  const save = async () => {
    if (key == null) return;
    await store({ apiKey: key.trim() });
    setKey(null);
  };

  const verify = async () => {
    await save();
    setBusy(true);
    setTest(null);
    try {
      const list = await listChatModels(id, keyValue);
      setModels(list);
      const text = pickModel(id, list, false);
      const foto = pickModel(id, list, true);
      if (!text) {
        setTest({ ok: false, msg: `La chiave funziona, ma ${p.nome} non offre ora modelli${p.pagamento ? '' : ' gratuiti'} utilizzabili.` });
      } else if (p.pagamento) {
        setTest({ ok: true, msg: `Funziona. Modello scelto in automatico: ${text} (legge foto e PDF). Se la risposta dice «credito esaurito», ricarica sul sito del servizio.` });
      } else {
        setTest({
          ok: true,
          msg: `Funziona. Domande: ${text}. Foto: ${foto ?? 'nessun modello gratuito che legga le immagini (per le foto si userà un\'altra AI)'}.`
        });
      }
    } catch (e) {
      const msg = e instanceof GeminiError ? e.message : (e as Error).message;
      setTest({ ok: false, msg });
    } finally {
      setBusy(false);
    }
  };

  const configured = !!value?.apiKey?.trim();
  const chatModels = (models ?? []).filter((m) => m.free);

  return (
    <details class="reserve" open={configured}>
      <summary>
        <strong>{p.nome}</strong>
        {configured ? <span class="chip chip-demo">{p.pagamento ? 'configurato' : 'attiva'}</span> : <span class="chip">{p.pagamento ? 'predisposto' : 'non configurata'}</span>}
      </summary>
      <p class="small">{p.piano.charAt(0).toUpperCase() + p.piano.slice(1)}. <span class="muted">Riservatezza: {p.privacy}.</span></p>
      <p class="small">
        {p.pagamento
          ? <>Su <a href={p.keyUrl} target="_blank" rel="noopener noreferrer">{p.keyUrl.replace(/^https:\/\//, '')}</a> crea un account, carica del credito e crea una chiave API; copiala e incollala qui.</>
          : <>Crea la chiave gratuita su <a href={p.keyUrl} target="_blank" rel="noopener noreferrer">{p.keyUrl.replace(/^https:\/\//, '')}</a>, copiala e incollala qui.</>}
      </p>
      <label class="field">
        <span class="small">Chiave {p.nome}</span>
        <div class="input-row">
          <input
            type={show ? 'text' : 'password'}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            placeholder={p.keyHint}
            value={keyValue}
            onInput={(e) => { setKey((e.target as HTMLInputElement).value); setTest(null); }}
            onBlur={save}
          />
          <button type="button" class="btn" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Nascondi' : 'Mostra'}</button>
        </div>
      </label>
      {configured && (
        <label class="field">
          <span class="small">Modello</span>
          <select
            value={value?.model ?? ''}
            onChange={(e) => store({ model: (e.target as HTMLSelectElement).value })}
          >
            <option value="">{p.pagamento ? 'Automatico: il più economico (consigliato)' : 'Automatico (consigliato)'}</option>
            {value?.model && !chatModels.some((m) => m.id === value.model) && <option value={value.model}>{value.model}</option>}
            {chatModels.map((m) => <option key={m.id} value={m.id}>{m.id}{m.vision ? ' · legge le foto' : ''}</option>)}
          </select>
          {!models && <span class="muted small">Tocca «Verifica» per vedere l'elenco dei modelli.</span>}
        </label>
      )}
      <div class="btn-row">
        <button type="button" class="btn btn-primary" disabled={!keyValue.trim() || !online || busy} onClick={verify}>
          {busy ? 'Verifica…' : 'Verifica'}
        </button>
        {configured && (
          <button type="button" class="btn btn-danger" onClick={async () => { await store(null); setKey(null); setModels(null); setTest(null); }}>
            Rimuovi
          </button>
        )}
      </div>
      {test && <p class={`notice ${test.ok ? 'notice-ok' : 'notice-error'} small`} role="status">{test.msg}</p>}
    </details>
  );
}
