// Regole dei servizi AI (programmatore) e domande disponibili (socio).
import { getSettings, updateSettings, useSettings, type Settings } from '../lib/settings';
import { configurato, leggiConteggi, nomeFornitore } from '../lib/router';
import {
  descriviLimite, ordineDi, regolaDi, residue, usate, type Fornitore, type PoliticaAi, type RegolaAi
} from '../shared/politica.ts';
import { PROVIDERS } from '../shared/providers.ts';

const tipo = (f: Fornitore) => (f === 'gemini' ? 'gratuito / a consumo' : PROVIDERS[f].pagamento ? 'a pagamento' : 'gratuito');

async function salva(modifica: (p: PoliticaAi, s: Settings) => PoliticaAi) {
  const s = await getSettings();
  const attuale: PoliticaAi = { ordine: ordineDi(s.politica), regole: { ...(s.politica?.regole ?? {}) } };
  await updateSettings({ politica: modifica(attuale, s) });
}

const cambiaRegola = (f: Fornitore, patch: Partial<RegolaAi>) =>
  salva((p, s) => ({ ...p, regole: { ...p.regole, [f]: { ...regolaDi(s.politica, f), ...patch } } }));

const sposta = (f: Fornitore, d: -1 | 1) =>
  salva((p) => {
    const o = [...p.ordine];
    const i = o.indexOf(f);
    const j = i + d;
    if (i < 0 || j < 0 || j >= o.length) return p;
    [o[i], o[j]] = [o[j], o[i]];
    return { ...p, ordine: o };
  });

/** Programmatore: quali servizi usare, in che ordine e quante domande può fare ogni socio. */
export function AiRules() {
  const s = useSettings();
  const ordine = ordineDi(s.politica);
  const configurati = ordine.filter((f) => configurato(s, f));
  const altri = ordine.filter((f) => !configurato(s, f));

  return (
    <div class="card ai-rules">
      <h3>Regole dei servizi AI</h3>
      <p class="muted small">
        Scegli quali servizi si possono usare, in che ordine si provano (se il primo non risponde si passa al successivo)
        e quante domande può fare <strong>ogni socio</strong> con ciascuno. Le regole arrivano ai soci alla prossima
        <strong> Pubblica</strong>, insieme alle chiavi cifrate con la password AI.
      </p>

      {configurati.length === 0 && <p class="small">Nessun servizio configurato: inserisci almeno una chiave qui sopra.</p>}

      <ol class="rules-list">
        {configurati.map((f, i) => {
          const r = regolaDi(s.politica, f);
          return (
            <li key={f} class={`rule ${r.attivo ? '' : 'rule-off'}`}>
              <div class="rule-head">
                <span class="rule-pos" aria-hidden="true">{r.attivo ? configurati.filter((x) => regolaDi(s.politica, x).attivo).indexOf(f) + 1 : '–'}</span>
                <div class="rule-name">
                  <strong>{nomeFornitore(f)}</strong>
                  <span class="muted small">{tipo(f)}</span>
                </div>
                <div class="rule-move">
                  <button type="button" class="btn btn-icon" aria-label={`Sposta ${nomeFornitore(f)} prima`} disabled={i === 0} onClick={() => sposta(f, -1)}>▲</button>
                  <button type="button" class="btn btn-icon" aria-label={`Sposta ${nomeFornitore(f)} dopo`} disabled={i === configurati.length - 1} onClick={() => sposta(f, 1)}>▼</button>
                </div>
              </div>
              <label class="switch">
                <span>Attivo</span>
                <input type="checkbox" role="switch" checked={r.attivo} onChange={(e) => cambiaRegola(f, { attivo: (e.target as HTMLInputElement).checked })} />
              </label>
              {r.attivo && (
                <div class="rule-limit">
                  <span class="small">Domande per socio</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    aria-label={`Limite di domande per socio con ${nomeFornitore(f)} (0 = senza limite)`}
                    value={r.limite || ''}
                    placeholder="senza limite"
                    onChange={(e) => cambiaRegola(f, { limite: Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)) })}
                  />
                  <select
                    aria-label="Periodo del limite"
                    value={r.periodo}
                    onChange={(e) => cambiaRegola(f, { periodo: (e.target as HTMLSelectElement).value as RegolaAi['periodo'] })}
                  >
                    <option value="giorno">al giorno</option>
                    <option value="mese">al mese</option>
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {altri.length > 0 && (
        <p class="muted small">Non configurati (senza chiave): {altri.map(nomeFornitore).join(', ')}.</p>
      )}
      <p class="muted small">
        Campo vuoto o 0 = senza limite. Il conteggio avviene sul telefono di ogni socio e si azzera ogni giorno o ogni mese;
        quando un servizio arriva al limite si passa al successivo. Il programmatore non ha limiti; «Attivo» vale per tutti.
      </p>
    </div>
  );
}

/** Socio: domande AI ancora disponibili su questo telefono, per servizio. */
export function AiQuota() {
  const s = useSettings();
  const servizi = ordineDi(s.politica).filter((f) => configurato(s, f) && regolaDi(s.politica, f).attivo);
  const conLimite = servizi.filter((f) => regolaDi(s.politica, f).limite > 0);
  if (!servizi.length) return null;
  const c = leggiConteggi();
  return (
    <div class="ai-quota">
      <p class="small"><strong>Servizi AI disponibili</strong>, nell'ordine in cui si usano:</p>
      <ul class="small">
        {servizi.map((f) => {
          const r = regolaDi(s.politica, f);
          const resto = residue(s.politica, c, f);
          return (
            <li key={f}>
              {nomeFornitore(f)}: {r.limite
                ? <>{resto} di {r.limite} {r.periodo === 'giorno' ? 'oggi' : 'questo mese'} <span class="muted">(usate {usate(c, f, r.periodo)})</span></>
                : descriviLimite(r)}
            </li>
          );
        })}
      </ul>
      {conLimite.length > 0 && <p class="muted small">I limiti li stabilisce il programmatore.</p>}
    </div>
  );
}
