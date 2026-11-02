// Identità dell'app: nome, marchio e contatti. Unico punto da modificare per personalizzarla.
export const BRAND = {
  nome: 'Contingente Sicilia',
  nomeBreve: 'Contingente',
  sottotitolo: 'Statistiche, report e documenti del Contingente',
  /** coordinatori mostrati nella pagina di benvenuto */
  coordinatori: ['Ughettini', 'Cuzzucrea', 'Inuso'],
  logo: 'brand/logo.png',
  logoCompleto: 'brand/sicilia.jpg',
  /** Contatti per chi ha dimenticato la password (soci e password AI). */
  contatti: {
    email: 'inlispettori@gmail.com',
    telefono: '349 866 9025',
    telefonoLink: '+393498669025'
  }
} as const;

/** Argomenti (categorie) proposti nei filtri di ricerca e nei moduli, in questo ordine. */
export const ARGOMENTI = ['Statistiche', 'Report', 'Relazioni', 'Normativa', 'Procedure', 'Generale'];

export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Argomenti standard + quelli già presenti (senza doppioni, ignorando maiuscole e accenti). */
export function withStandardTopics(existing: string[]): string[] {
  const norm = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const seen = new Set(ARGOMENTI.map(norm));
  return [...ARGOMENTI, ...existing.filter((c) => !seen.has(norm(c)) && seen.add(norm(c)))];
}
