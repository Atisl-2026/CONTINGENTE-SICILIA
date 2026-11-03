// Che cosa chiede la domanda: un riepilogo generale, dei totali, o un argomento preciso.
// E le parole che nei documenti statistici indicano la stessa cosa («ispezioni» = «pratiche»).

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Gruppi di parole equivalenti nelle statistiche ispettive. */
export const SINONIMI_STAT: string[][] = [
  ['ispezioni', 'ispezione', 'pratiche', 'pratica', 'accessi', 'accesso', 'verifiche', 'controlli'],
  ['sospensioni', 'sospensione', 'provvedimenti', 'provvedimento', 'sospese'],
  ['tutelati', 'tutela', 'tutelate', 'posizioni'],
  ['importi', 'importo', 'sanzioni', 'sanzione', 'contestato', 'contestati', 'somme', 'euro'],
  ['agricoltura', 'agricolo', 'agricola', 'agricole', 'braccianti', 'campi'],
  ['esternalizzazione', 'esternalizzazioni', 'appalti', 'appalto', 'interposizione', 'somministrazione'],
  ['nero', 'irregolari', 'sommerso', 'irregolare'],
  ['violazioni', 'violazione', 'illeciti', 'infrazioni', 'irregolarita'],
  ['ispettori', 'ispettore', 'personale', 'funzionari'],
  ['copertura', 'comuni', 'territorio', 'territoriale']
];

/** Parole che non dicono l'argomento: richieste di riepilogo, totali, cortesia, riferimenti generici. */
const NEUTRE = new Set((
  'mi ci ti fai fare puoi potresti vorrei voglio dammi dimmi mostrami fammi elenca elencami indica dare avere ' +
  'un una uno il lo la i gli le di da del dello della dei degli delle al allo alla ai agli alle nel nella nei nelle ' +
  'con per su sul sulla sui tra fra e ed o che chi cosa come quanto quanti quante quale quali qual sono e stato stati ' +
  'riepilogo riepiloghi riepilogare resoconto sintesi sintetico sintetica panoramica quadro riassunto riassumi ' +
  'situazione generale generali complessivo complessiva complessivi totale totali globale insieme report rapporto ' +
  'dati dato principali principale numeri chiave numero informazioni andamento attivita monitoraggio stato ' +
  'sicilia regione regionale anno 2024 2025 2026 2027 aggiornato aggiornamento ultimo ultimi oggi tutto tutti tutte ' +
  'favore grazie per piacere breve completo completa'
).split(' '));

const RIEPILOGO = /\b(riepilog\w*|resocont\w*|sintes\w*|sintetic\w*|panoramic\w*|riassun\w*|quadro|report|rapporto|dati principali|numeri chiave|situazione|com[e'] (stiamo|siamo|va|vanno))\b/;
const TOTALI = /\b(total[ei]|complessiv\w*|globale|in tutto|in totale|tutt[ie] (le|gli|i)|quant[ei] (sono|ne))\b/;

export interface Intento {
  /** riepilogo senza un argomento preciso («mi fai un riepilogo») */
  generale: boolean;
  /** chiede totali o dati complessivi */
  totali: boolean;
  /** parole che indicano l'argomento (vuoto = domanda generica) */
  argomento: string[];
}

export function intentoDomanda(domanda: string): Intento {
  const q = norm(domanda);
  const argomento = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NEUTRE.has(w));
  const riepilogo = RIEPILOGO.test(q);
  return {
    generale: riepilogo && argomento.length === 0,
    totali: TOTALI.test(q) || (riepilogo && argomento.length <= 2),
    argomento
  };
}

/** Parole della domanda più le equivalenti («ispezioni» → anche «pratiche», «accessi»…). */
export function conSinonimi(parole: string[]): string[] {
  const out = new Set(parole);
  for (const gruppo of SINONIMI_STAT) {
    if (gruppo.some((g) => parole.some((p) => p === g || (p.length >= 5 && g.length >= 5 && p.slice(0, 5) === g.slice(0, 5))))) {
      for (const g of gruppo) out.add(g);
    }
  }
  return [...out];
}
