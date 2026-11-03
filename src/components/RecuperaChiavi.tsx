import { useState } from 'preact/hooks';
import { getAiEnvelope, recuperaChiaviAdmin, type Accesso } from '../lib/access';
import { useLiveQuery } from '../lib/live';

/**
 * Programmatore: le chiavi AI restano su un solo telefono e si cancellano con «Esci».
 * Se sul sito c'è la copia cifrata (password AI), si recuperano qui insieme alle regole.
 */
export function RecuperaChiavi({ access }: { access: Accesso }) {
  const envelope = useLiveQuery(getAiEnvelope);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; testo: string } | null>(null);
  if (!envelope || access.aiKey) return msg?.ok ? <p class="notice notice-ok small" role="status">{msg.testo}</p> : null;

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await recuperaChiaviAdmin(pw);
      setPw('');
      setMsg({ ok: true, testo: 'Chiavi e regole dei servizi AI recuperate su questo telefono.' });
    } catch (err) {
      setMsg({ ok: false, testo: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card recupera" onSubmit={onSubmit}>
      <h3>Recupera le chiavi AI</h3>
      <p class="muted small">
        Le chiavi dei servizi AI restano solo sul telefono e si cancellano quando tocchi <strong>Esci</strong>. Una copia
        cifrata è sul sito, con la password AI: inseriscila per recuperare chiavi (Gemini, Claude, ChatGPT…) e regole.
      </p>
      <label class="field">
        <span class="small">Password AI</span>
        <input type="password" autocomplete="off" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
      </label>
      <button class="btn btn-primary btn-block" type="submit" disabled={!pw || busy}>{busy ? 'Recupero…' : 'Recupera chiavi e regole'}</button>
      {msg && <p class={`notice ${msg.ok ? 'notice-ok' : 'notice-error'} small`} role="status">{msg.testo}</p>}
    </form>
  );
}
