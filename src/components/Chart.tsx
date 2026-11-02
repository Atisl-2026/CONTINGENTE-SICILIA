// Grafici in SVG, senza librerie: barre (verticali o orizzontali), linee, area, torta/ciambella,
// riquadri KPI e vista tabella. Dati: shared/types.ts → Grafico.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, RefObject } from 'preact';
import type { Grafico, TipoGrafico } from '../shared/types.ts';
import { etichetteTemporali, formatNumero } from '../shared/charts.ts';

/** Colori delle serie: ordine fisso, verificato per daltonismo sullo sfondo scuro dell'app. */
export const SERIE_COLORI = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const colore = (i: number) => SERIE_COLORI[i % SERIE_COLORI.length];

/** Larghezza disponibile del contenitore (per disegnare l'SVG a misura, testi non deformati). */
function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 320);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmt = (v: number | null | undefined, g: Grafico) => formatNumero(v, g.unita === '%' ? '%' : '');
const fmtBreve = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${formatNumero(v / 1e9)} Mld`;
  if (a >= 1e6) return `${formatNumero(v / 1e6)} Mln`;
  if (a >= 1e4) return `${formatNumero(v / 1e3)} mila`;
  return formatNumero(v);
};

/** Valori "tondi" per l'asse: 0 … max in 4 passi. */
function scala(min: number, max: number, passi = 4): number[] {
  const lo = Math.min(0, min);
  const hi = max <= lo ? lo + 1 : max;
  const raw = (hi - lo) / passi;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v < hi + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const tronca = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ============================================================ barre orizzontali (elenco)

function BarreOrizzontali({ g, attive }: { g: Grafico; attive: number[] }) {
  const vals = attive.flatMap((s) => g.serie[s].valori.filter((v): v is number => v != null));
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  return (
    <div class="hbars" role="list">
      {g.categorie.map((c, i) => (
        <div class="hbar-row" role="listitem" key={i}>
          <div class="hbar-label">{c}</div>
          {attive.map((s) => {
            const v = g.serie[s].valori[i];
            const w = v == null ? 0 : (Math.abs(v) / span) * 100;
            const left = v != null && v < 0 ? ((v - min) / span) * 100 : (-min / span) * 100;
            return (
              <div class="hbar-line" key={s} title={`${g.serie[s].nome}: ${fmt(v, g)}`}>
                <div class="hbar-track">
                  <div class="hbar-fill" style={{ width: `${w}%`, marginLeft: `${left}%`, background: colore(s) }} />
                </div>
                <span class="hbar-value">{fmt(v, g)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ============================================================ barre verticali, linee, area (assi cartesiani)

function Cartesiano({ g, attive, tipo }: { g: Grafico; attive: number[]; tipo: 'barre' | 'linee' | 'area' }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = g.categorie.length;
  const vals = attive.flatMap((s) => g.serie[s].valori.filter((v): v is number => v != null));
  const ticks = scala(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const H = 220;
  const pad = { t: 12, r: 10, b: 30, l: Math.min(64, 12 + Math.max(...ticks.map((t) => fmtBreve(t).length)) * 6.6) };
  const W = Math.max(240, width);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const band = iw / n;
  const xc = (i: number) => pad.l + band * (i + 0.5);
  // etichette dell'asse orizzontale: solo quante ne entrano
  const maxLab = Math.max(2, Math.floor(iw / 46));
  const every = Math.ceil(n / maxLab);
  const lab = Math.max(4, Math.floor((band * every) / 6.4));

  const onMove = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - pad.l) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div class="chart-plot" ref={ref}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${g.titolo}: grafico`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} class={t === 0 ? 'axis-zero' : 'grid'} />
            <text x={pad.l - 6} y={y(t) + 4} class="tick" text-anchor="end">{fmtBreve(t)}</text>
          </g>
        ))}
        {g.categorie.map((c, i) => (i % every === 0 ? (
          <text key={i} x={xc(i)} y={H - 10} class="tick" text-anchor="middle">{tronca(c, lab)}</text>
        ) : null))}
        {hover != null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} class="hover-band" />}

        {tipo === 'barre' && attive.map((s, k) => {
          const gw = band * 0.72;
          const bw = Math.max(2, gw / attive.length - 2);
          return g.serie[s].valori.map((v, i) => {
            if (v == null) return null;
            const x = pad.l + band * i + (band - gw) / 2 + k * (bw + 2);
            const y0 = y(0);
            const y1 = y(v);
            const h = Math.abs(y0 - y1);
            const r = Math.min(4, bw / 2, h);
            const top = Math.min(y0, y1);
            // estremità arrotondata dalla parte del valore, base squadrata sull'asse
            const d = v >= 0
              ? `M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y0} Z`
              : `M${x},${y0} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + bw - r} Q${x + bw},${top + h} ${x + bw},${top + h - r} V${y0} Z`;
            return <path key={`${s}-${i}`} d={d} fill={colore(s)} opacity={hover == null || hover === i ? 1 : 0.55} />;
          });
        })}

        {tipo !== 'barre' && attive.map((s) => {
          const pts = g.serie[s].valori.map((v, i) => (v == null ? null : [xc(i), y(v)] as const));
          const segs: string[] = [];
          let cur = '';
          pts.forEach((p) => {
            if (!p) { if (cur) segs.push(cur); cur = ''; return; }
            cur += `${cur ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)} `;
          });
          if (cur) segs.push(cur);
          const valid = pts.filter((p): p is readonly [number, number] => !!p);
          return (
            <g key={s}>
              {tipo === 'area' && valid.length > 1 && (
                <path
                  d={`M${valid[0][0]},${y(Math.max(lo, 0))} ${valid.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${valid[valid.length - 1][0]},${y(Math.max(lo, 0))} Z`}
                  fill={colore(s)}
                  opacity={0.18}
                />
              )}
              {segs.map((d, j) => <path key={j} d={d} fill="none" stroke={colore(s)} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" />)}
              {(n <= 16 || hover != null) && pts.map((p, i) => (p && (n <= 16 || hover === i) ? (
                <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill={colore(s)} class="dot" />
              ) : null))}
            </g>
          );
        })}
        {hover != null && tipo !== 'barre' && <line x1={xc(hover)} x2={xc(hover)} y1={pad.t} y2={pad.t + ih} class="crosshair" />}
      </svg>
      {hover != null && (
        <div class="chart-tip" style={{ left: `${Math.min(Math.max(xc(hover) / W, 0.2), 0.8) * 100}%` }} role="status">
          <strong>{g.categorie[hover]}</strong>
          {attive.map((s) => (
            <div key={s} class="tip-row">
              <span class="swatch" style={{ background: colore(s) }} />
              {g.serie[s].nome}: <b>{fmt(g.serie[s].valori[hover], g)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================ torta e ciambella

function Torta({ g, ciambella }: { g: Grafico; ciambella: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  // spicchi oltre il sesto raggruppati in «Altro»
  const raw = g.categorie.map((c, i) => ({ c, v: Math.max(0, g.serie[0].valori[i] ?? 0), i })).filter((x) => x.v > 0);
  raw.sort((a, b) => b.v - a.v);
  const fette = raw.length > 6 ? [...raw.slice(0, 5), { c: 'Altro', v: raw.slice(5).reduce((a, b) => a + b.v, 0), i: -1 }] : raw;
  const tot = fette.reduce((a, b) => a + b.v, 0) || 1;
  const R = 90;
  const r0 = ciambella ? 54 : 0;
  let a = -Math.PI / 2;
  const arcs = fette.map((f, k) => {
    const a0 = a;
    const a1 = a + (f.v / tot) * Math.PI * 2;
    a = a1;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rr: number) => `${110 + rr * Math.cos(ang)},${110 + rr * Math.sin(ang)}`;
    const d = fette.length === 1
      ? `M${110 - R},110 A${R},${R} 0 1 1 ${110 + R},110 A${R},${R} 0 1 1 ${110 - R},110 Z`
      : r0
        ? `M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r0)} A${r0},${r0} 0 ${big} 0 ${p(a0, r0)} Z`
        : `M110,110 L${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} Z`;
    return { d, k, f };
  });
  const sel = hover != null ? fette[hover] : null;
  return (
    <div class="pie-wrap">
      <svg viewBox="0 0 220 220" width="200" height="200" role="img" aria-label={`${g.titolo}: grafico a torta`}>
        {arcs.map(({ d, k }) => (
          <path
            key={k}
            d={d}
            fill={colore(k)}
            class="slice"
            opacity={hover == null || hover === k ? 1 : 0.5}
            onPointerEnter={() => setHover(k)}
            onPointerDown={() => setHover(k)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
        {ciambella && (
          <text x="110" y="116" text-anchor="middle" class="pie-center">
            {sel ? `${formatNumero((sel.v / tot) * 100)}%` : fmtBreve(tot)}
          </text>
        )}
      </svg>
      <ul class="legend legend-col">
        {fette.map((f, k) => (
          <li key={k} class={hover === k ? 'on' : ''} onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)}>
            <span class="swatch" style={{ background: colore(k) }} />
            <span class="lg-name">{f.c}</span>
            <span class="lg-val">{fmt(f.v, g)}{g.unita !== '%' && <small> · {formatNumero((f.v / tot) * 100)}%</small>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================ riquadri KPI e tabella

function Kpi({ g }: { g: Grafico }) {
  const [s0, s1] = g.serie;
  return (
    <div class="kpi-grid">
      {g.categorie.map((c, i) => {
        const v = s0.valori[i];
        const prev = s1?.valori[i];
        const delta = v != null && prev != null && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null;
        return (
          <div class="kpi" key={i}>
            <div class="kpi-label">{c}</div>
            <div class="kpi-value">{fmt(v, g)}</div>
            {s1 && (
              <div class="kpi-sub">
                {s1.nome}: {fmt(prev, g)}
                {delta != null && (
                  <span class={delta >= 0 ? 'delta up' : 'delta down'}>
                    {delta >= 0 ? '▲' : '▼'} {formatNumero(Math.abs(delta))}%
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TabellaDati({ g }: { g: Grafico }) {
  return (
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th scope="col">{g.categorie.length && etichetteTemporali(g.categorie) ? 'Periodo' : 'Voce'}</th>{g.serie.map((s, i) => <th scope="col" key={i}>{s.nome}</th>)}</tr>
        </thead>
        <tbody>
          {g.categorie.map((c, i) => (
            <tr key={i}><th scope="row">{c}</th>{g.serie.map((s, j) => <td key={j}>{fmt(s.valori[i], g)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================ scheda del grafico

const ETICHETTE: Partial<Record<TipoGrafico, string>> = { barre: 'Barre', linee: 'Linee', area: 'Area', torta: 'Torta', ciambella: 'Ciambella', kpi: 'Numeri' };

/** Serie con scale troppo diverse (es. numero di ispezioni ed euro): un grafico ciascuna, mai due assi. */
function scaleDiverse(g: Grafico, attive: number[]): boolean {
  if (attive.length < 2) return false;
  const maxes = attive.map((s) => Math.max(...g.serie[s].valori.map((v) => Math.abs(v ?? 0))));
  const pos = maxes.filter((m) => m > 0);
  return pos.length >= 2 && Math.max(...pos) / Math.min(...pos) >= 15;
}

function Disegno({ g, tipo, attive }: { g: Grafico; tipo: TipoGrafico; attive: number[] }) {
  if (!attive.length) return <p class="muted small">Tocca una voce della legenda per mostrarla.</p>;
  if (tipo === 'kpi') return <Kpi g={g} />;
  if (tipo === 'tabella') return <TabellaDati g={g} />;
  if ((tipo === 'torta' || tipo === 'ciambella') && g.serie.length >= 1) {
    return <Torta g={{ ...g, serie: [g.serie[attive[0]]] }} ciambella={tipo === 'ciambella'} />;
  }
  const lungo = g.categorie.length > 8 || g.categorie.reduce((a, c) => a + c.length, 0) / g.categorie.length > 9;
  if (tipo === 'barre' && lungo && !etichetteTemporali(g.categorie)) return <BarreOrizzontali g={g} attive={attive} />;
  return <Cartesiano g={g} attive={attive} tipo={tipo === 'barre' || tipo === 'linee' || tipo === 'area' ? tipo : 'barre'} />;
}

interface Props {
  g: Grafico;
  /** testo sotto il titolo (es. documento di provenienza) */
  fonte?: ComponentChildren;
}

/** Scheda completa: titolo, scelta del tipo, legenda (tocca per nascondere una serie), grafico o tabella. */
export function ChartCard({ g, fonte }: Props) {
  const [tipo, setTipo] = useState<TipoGrafico>(g.tipo);
  const [tabella, setTabella] = useState(g.tipo === 'tabella');
  const [nascoste, setNascoste] = useState<Set<number>>(new Set());
  useEffect(() => { setTipo(g.tipo); setNascoste(new Set()); }, [g]);
  const attive = g.serie.map((_, i) => i).filter((i) => !nascoste.has(i));
  const torta = tipo === 'torta' || tipo === 'ciambella';
  const scelte: TipoGrafico[] = ['barre', 'linee', ...(g.categorie.length >= 3 ? (['area'] as TipoGrafico[]) : []),
    ...(g.categorie.length <= 12 ? (['torta'] as TipoGrafico[]) : []), ...(g.categorie.length <= 8 ? (['kpi'] as TipoGrafico[]) : [])];
  const separati = !torta && tipo !== 'kpi' && !tabella && scaleDiverse(g, attive);
  const toggle = (i: number) => {
    const s = new Set(nascoste);
    if (s.has(i)) s.delete(i); else s.add(i);
    // in torta si mostra una serie per volta
    if (torta) { setNascoste(new Set(g.serie.map((_, j) => j).filter((j) => j !== i))); return; }
    setNascoste(s);
  };
  const viste = torta ? [attive[0] ?? 0] : attive;

  return (
    <figure class="chart-card">
      <figcaption>
        <div class="chart-head">
          <div>
            <h4 class="chart-title">{g.titolo}</h4>
            {(g.posizione || g.unita || fonte) && (
              <p class="chart-sub">
                {fonte}{fonte && g.posizione ? ' · ' : ''}{g.posizione}{g.unita && g.unita !== '%' ? ` · valori in ${g.unita}` : ''}
              </p>
            )}
          </div>
          <button type="button" class="chip" aria-pressed={tabella} onClick={() => setTabella(!tabella)}>
            {tabella ? 'Grafico' : 'Tabella'}
          </button>
        </div>
      </figcaption>

      {!tabella && (
        <div class="seg" role="group" aria-label="Tipo di grafico">
          {scelte.map((t) => (
            <button key={t} type="button" aria-pressed={tipo === t || (t === 'torta' && tipo === 'ciambella')} onClick={() => setTipo(t)}>
              {ETICHETTE[t]}
            </button>
          ))}
        </div>
      )}

      {g.serie.length > 1 && !tabella && tipo !== 'kpi' && (
        <ul class="legend">
          {g.serie.map((s, i) => (
            <li key={i}>
              <button type="button" class={viste.includes(i) ? '' : 'off'} aria-pressed={viste.includes(i)} onClick={() => toggle(i)}>
                <span class="swatch" style={{ background: colore(i) }} />
                {s.nome}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tabella ? <TabellaDati g={g} /> : separati ? (
        <div class="multiples">
          <p class="muted small">Le serie hanno grandezze molto diverse: un grafico per ciascuna.</p>
          {attive.map((s) => (
            <div key={s} class="multiple">
              <p class="multiple-title"><span class="swatch" style={{ background: colore(s) }} />{g.serie[s].nome}</p>
              <Disegno g={g} tipo={tipo} attive={[s]} />
            </div>
          ))}
        </div>
      ) : (
        <Disegno g={g} tipo={tipo} attive={viste} />
      )}
      {g.nota && <p class="chart-note">{g.nota}</p>}
    </figure>
  );
}
