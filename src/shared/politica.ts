// Regole dell'amministratore sui servizi AI: quali si usano, in che ordine e quante domande può fare
// ogni socio (al giorno o al mese). Le regole viaggiano con le chiavi, cifrate con la password AI.
// Il conteggio delle domande è fatto sul telefono di ciascun socio (l'app non ha un server).
import type { ProviderId } from './providers.ts';

export type Fornitore = 'gemini' | ProviderId;

/** Ordine predefinito: Gemini, poi i servizi a pagamento, poi le riserve gratuite. */
export const FORNITORI: Fornitore[] = ['gemini', 'claude', 'openai', 'groq', 'mistral', 'openrouter'];

export type Periodo = 'giorno' | 'mese';

export interface RegolaAi {
  /** usabile (da tutti: soci e programmatore) */
  attivo: boolean;
  /** domande per socio nel periodo; 0 = senza limite */
  limite: number;
  periodo: Periodo;
}

export interface PoliticaAi {
  /** ordine in cui si provano i servizi (quelli mancanti vanno in fondo, nell'ordine predefinito) */
  ordine: Fornitore[];
  regole: Partial<Record<Fornitore, RegolaAi>>;
}

export const REGOLA_PREDEFINITA: RegolaAi = { attivo: true, limite: 0, periodo: 'giorno' };

export function regolaDi(p: PoliticaAi | undefined, f: Fornitore): RegolaAi {
  return { ...REGOLA_PREDEFINITA, ...(p?.regole?.[f] ?? {}) };
}

export function ordineDi(p: PoliticaAi | undefined): Fornitore[] {
  const scelti = (p?.ordine ?? []).filter((f, i, a) => FORNITORI.includes(f) && a.indexOf(f) === i);
  return [...scelti, ...FORNITORI.filter((f) => !scelti.includes(f))];
}

/** Chiave del periodo in corso, nell'ora locale: "2026-11-02" o "2026-11". */
export function chiavePeriodo(periodo: Periodo, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const mese = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  return periodo === 'mese' ? mese : `${mese}-${p(d.getDate())}`;
}

/** Domande fatte, per servizio e periodo: { claude: { "2026-11-02": 3 } }. */
export type Conteggi = Partial<Record<Fornitore, Record<string, number>>>;

export function usate(c: Conteggi, f: Fornitore, periodo: Periodo, d = new Date()): number {
  return c[f]?.[chiavePeriodo(periodo, d)] ?? 0;
}

/** Domande ancora disponibili per un socio (Infinity = senza limite). */
export function residue(p: PoliticaAi | undefined, c: Conteggi, f: Fornitore, d = new Date()): number {
  const r = regolaDi(p, f);
  if (!r.limite) return Infinity;
  return Math.max(0, r.limite - usate(c, f, r.periodo, d));
}

/** Registra una domanda; i periodi passati si buttano (restano solo quello di oggi e del mese). */
export function conta(c: Conteggi, f: Fornitore, d = new Date()): Conteggi {
  const giorno = chiavePeriodo('giorno', d);
  const mese = chiavePeriodo('mese', d);
  const prima = c[f] ?? {};
  return { ...c, [f]: { [giorno]: (prima[giorno] ?? 0) + 1, [mese]: (prima[mese] ?? 0) + 1 } };
}

/** Accetta regole da qualsiasi origine (file dei soci, impostazioni): valori fuori posto tolti. */
export function normalizePolitica(raw: unknown): PoliticaAi | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { ordine?: unknown; regole?: Record<string, unknown> };
  const ordine = Array.isArray(o.ordine) ? o.ordine.filter((f): f is Fornitore => FORNITORI.includes(f as Fornitore)) : [];
  const regole: PoliticaAi['regole'] = {};
  for (const f of FORNITORI) {
    const r = o.regole?.[f] as Partial<RegolaAi> | undefined;
    if (!r || typeof r !== 'object') continue;
    regole[f] = {
      attivo: r.attivo !== false,
      limite: Math.max(0, Math.min(100000, Math.floor(Number(r.limite) || 0))),
      periodo: r.periodo === 'mese' ? 'mese' : 'giorno'
    };
  }
  return { ordine, regole };
}

export const descriviLimite = (r: RegolaAi) =>
  r.limite ? `${r.limite} ${r.limite === 1 ? 'domanda' : 'domande'} al ${r.periodo}` : 'senza limite';
