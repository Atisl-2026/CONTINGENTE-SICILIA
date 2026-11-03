// Riepilogo scritto senza AI: un testo per area ricavato dai riquadri «numeri chiave» dei documenti
// statistici. Per le domande sui totali («ispezioni totali») mette in evidenza il dato richiesto.
// Funzioni pure: testate in tests/riepilogo.test.ts.
import { conSinonimi, intentoDomanda } from './intento.ts';
import type { Grafico } from './types.ts';

export interface DocumentoStat {
  id: string;
  titolo: string;
  /** data già formattata (gg/mm/aaaa) o vuota */
  data: string;
  grafici: Grafico[];
}

export interface Voce {
  etichetta: string;
  valore: string;
  /** area (foglio) da cui viene */
  area: string;
  documento: string;
}

export interface Riepilogo {
  /** risposta diretta per le domande sui totali (al massimo 3 voci) */
  evidenza: Voce[];
  documenti: { id: string; titolo: string; data: string; aree: { area: string; voci: Voce[] }[] }[];
  /** tutto in testo semplice, da copiare */
  testo: string;
}

/** 1286500 → «1.286.500», 79.8 → «79,8», sempre con il separatore delle migliaia. */
export function numeroTesto(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(Math.round(n * 100) / 100);
  const [int, dec] = String(abs).split('.');
  const conPunti = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${conPunti}${dec ? `,${dec}` : ''}`;
}

/** Parole corte italiane che non sono sigle. */
const PAROLINE = new Set('a e i o il lo la le gli un in di da su per con tra fra del al ai nel nei dei non che chi sui col'.split(' '));

/** «PRATICHE DISTINTE» → «Pratiche distinte»; le sigle restano («VO pesate», «ALT caporalato T.R.E.»). */
export function etichettaLeggibile(s: string): string {
  const t = s.trim();
  if (/[a-zà-ÿ]/.test(t)) return t; // già scritta in minuscolo/maiuscolo misto
  const parole = t.split(/(\s+|\/)/).map((w) =>
    (/^[A-ZÀ-Ý]{2,3}$/.test(w) && !PAROLINE.has(w.toLowerCase())) || /[.&]/.test(w) ? w : w.toLowerCase());
  const out = parole.join('');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Etichetta e valore, con l'unità dalla fine dell'etichetta: «Copertura (%)» 79.8 → «Copertura», «79,8%». */
function voce(categoria: string, valore: number | null): { etichetta: string; valore: string } | null {
  if (valore == null) return null;
  const m = categoria.match(/^(.*?)\s*\((%|€)\)\s*$/);
  const base = etichettaLeggibile(m ? m[1] : categoria);
  const unita = m?.[2];
  const v = unita === '%' ? `${numeroTesto(valore)}%` : unita === '€' ? `€ ${numeroTesto(valore)}` : numeroTesto(valore);
  // «pratiche distinte» è il numero delle ispezioni: lo si dice
  const etichetta = /^pratiche distinte$/i.test(base) ? 'Ispezioni (pratiche distinte)' : base;
  return { etichetta, valore: v };
}

/** «Foglio «Lavoro nero»» → «Lavoro nero»; altrimenti il titolo senza «– numeri chiave». */
function nomeArea(g: Grafico): string {
  const foglio = g.posizione?.match(/^Foglio «(.*)»$/)?.[1];
  return foglio || g.titolo.replace(/\s*–\s*numeri chiave(\s*\(\d+\))?$/i, '');
}

const radice = (w: string) => w.slice(0, 5);
const parole = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const TOTALE = /distint|total|complessiv|uniche|tutt/i;

export function costruisciRiepilogo(docs: DocumentoStat[], domanda = ''): Riepilogo {
  const documenti = docs.map((d) => {
    const aree = new Map<string, Voce[]>();
    for (const g of d.grafici.filter((x) => x.tipo === 'kpi')) {
      const area = nomeArea(g);
      const voci = aree.get(area) ?? [];
      g.categorie.forEach((c, i) => {
        const v = voce(c, g.serie[0]?.valori[i] ?? null);
        if (v) voci.push({ ...v, area, documento: d.titolo });
      });
      aree.set(area, voci);
    }
    return { id: d.id, titolo: d.titolo, data: d.data, aree: [...aree].map(([area, voci]) => ({ area, voci })).filter((a) => a.voci.length) };
  }).filter((d) => d.aree.length);

  // totali su un argomento: le voci che ne parlano, prima quelle «distinte/totali»
  const int = intentoDomanda(domanda);
  let evidenza: Voce[] = [];
  if (int.totali && int.argomento.length) {
    const cercate = new Set(conSinonimi(int.argomento).map(radice));
    const tutte = documenti.flatMap((d) => d.aree.flatMap((a) => a.voci));
    // le percentuali non sono totali
    const pertinenti = tutte.filter((v) => !v.valore.endsWith('%') && parole(v.etichetta).some((w) => cercate.has(radice(w))));
    const principali = pertinenti.filter((v) => TOTALE.test(v.etichetta));
    const scelte = principali.length ? principali : pertinenti;
    const viste = new Set<string>();
    evidenza = scelte.filter((v) => {
      const k = v.valore; // stesso numero in due fogli (es. pratiche distinte e pratiche uniche): una volta sola
      if (viste.has(k)) return false;
      viste.add(k);
      return true;
    }).slice(0, 3);
  }

  const righe: string[] = [];
  for (const d of documenti) {
    righe.push(`Riepilogo – ${d.titolo}${d.data ? ` (dati al ${d.data})` : ''}`);
    if (evidenza.length && documenti.length === 1) {
      righe.push(`In evidenza: ${evidenza.map((v) => `${v.etichetta}: ${v.valore}`).join(' · ')}`);
    }
    for (const a of d.aree) righe.push(`${a.area}: ${a.voci.map((v) => `${v.etichetta} ${v.valore}`).join(' · ')}`);
    righe.push('');
  }
  if (evidenza.length && documenti.length > 1) {
    righe.unshift(`In evidenza: ${evidenza.map((v) => `${v.etichetta}: ${v.valore} (${v.documento})`).join(' · ')}`, '');
  }
  return { evidenza, documenti, testo: righe.join('\n').trim() };
}
