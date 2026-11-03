import { useState } from 'preact/hooks';
import { formatDate } from '../lib/format';
import { recordHref } from '../lib/route';
import { costruisciRiepilogo } from '../shared/riepilogo.ts';
import type { StoredRecord } from '../shared/types.ts';

/** Riepilogo scritto senza AI, dai numeri chiave dei documenti statistici; si può copiare. */
export function RiepilogoScritto({ domanda, records }: { domanda: string; records: StoredRecord[] }) {
  const [copiato, setCopiato] = useState<'' | 'ok' | 'no'>('');
  const r = costruisciRiepilogo(
    records.map((x) => ({ id: x.id, titolo: x.titolo, data: x.data_aggiornamento ? formatDate(x.data_aggiornamento) : '', grafici: x.grafici ?? [] })),
    domanda
  );
  if (!r.documenti.length) return null;

  const copia = async () => {
    try {
      await navigator.clipboard.writeText(r.testo);
      setCopiato('ok');
    } catch {
      setCopiato('no');
    }
    setTimeout(() => setCopiato(''), 2500);
  };

  return (
    <article class="card riepilogo" aria-label="Riepilogo dei numeri chiave">
      {r.evidenza.length > 0 && (
        <div class="riepilogo-evidenza">
          {r.evidenza.map((v) => (
            <p key={`${v.area}-${v.etichetta}`}>
              <span class="ev-label">{v.etichetta}</span>
              <strong class="ev-val">{v.valore}</strong>
              <span class="muted small">{v.area}{r.documenti.length > 1 ? ` · ${v.documento}` : ''}</span>
            </p>
          ))}
        </div>
      )}
      {r.documenti.map((d) => (
        <section key={d.id} class="riepilogo-doc">
          <h4>
            Riepilogo – <a href={recordHref(d.id)}>{d.titolo}</a>
            {d.data && <span class="muted small"> · dati al {d.data}</span>}
          </h4>
          <dl class="riepilogo-aree">
            {d.aree.map((a) => (
              <div key={a.area}>
                <dt>{a.area}</dt>
                <dd>
                  {a.voci.map((v, i) => (
                    <span key={i} class="riep-voce">{v.etichetta} <strong>{v.valore}</strong></span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <div class="riepilogo-foot">
        <button type="button" class="btn" onClick={copia}>{copiato === 'ok' ? 'Copiato ✓' : 'Copia il testo'}</button>
        <span class="muted small">
          {copiato === 'no' ? 'Copia non riuscita: tieni premuto sul testo per selezionarlo.' : 'Riepilogo automatico dai numeri chiave del file, senza AI.'}
        </span>
      </div>
    </article>
  );
}
