// Tipi condivisi tra app (browser) e script Node (build-db).
// Nota: solo sintassi "cancellabile" (niente enum) perché Node esegue questi file togliendo i tipi.

/** Record come definito dallo schema del database. */
export interface DbRecord {
  id: string;
  titolo: string;
  testo: string;
  categoria: string;
  tag: string[];
  fonte: string;
  /** Data in formato ISO YYYY-MM-DD (stringa vuota se sconosciuta). */
  data_aggiornamento: string;
  /** true se la scheda è visibile anche nell'accesso demo (pubblicata in chiaro). */
  demo?: boolean;
  /**
   * Solo per i documenti ricavati da un PDF: posizione nel testo in cui inizia ogni pagina
   * (pagine[0] = pagina 1). Serve a indicare «pag. N» accanto ai passaggi trovati.
   */
  pagine?: number[];
  /** Tabelle numeriche e grafici letti dal file (fogli Excel, tabelle Word, grafici di PowerPoint…). */
  grafici?: Grafico[];
}

export type TipoGrafico = 'barre' | 'linee' | 'area' | 'torta' | 'ciambella' | 'kpi' | 'tabella';

export interface Serie {
  nome: string;
  /** un valore per categoria; null = dato mancante */
  valori: (number | null)[];
}

/** Dati di un grafico: categorie sull'asse orizzontale (o spicchi), una o più serie di valori. */
export interface Grafico {
  titolo: string;
  tipo: TipoGrafico;
  categorie: string[];
  serie: Serie[];
  /** es. "%", "€", "ore" */
  unita?: string;
  /** dove si trova nel file: "Slide 3", "Foglio «Dati»", "pag. 4" */
  posizione?: string;
  nota?: string;
}

/** Provenienza del record nel database locale. */
export type Origine = 'remoto' | 'locale';

/** Record salvato in IndexedDB: schema + metadati di sincronizzazione. */
export interface StoredRecord extends DbRecord {
  /** 'remoto' = pubblicato su GitHub; 'locale' = creato o importato nell'app e non ancora pubblicato. */
  origine: Origine;
  /** true se un record remoto è stato modificato nell'app: gli aggiornamenti remoti non lo sovrascrivono. */
  modificato?: boolean;
  /** Timestamp dell'ultima scrittura locale. */
  salvato_il: number;
}

/** Blocco di testo indicizzato separatamente ma collegato al record padre. */
export interface Chunk {
  /** `${recordId}#${n}` */
  id: string;
  recordId: string;
  n: number;
  testo: string;
}

/** Database in chiaro (demo.json, output di build-db, backup). */
export interface DbFile {
  versione: string;
  generato?: string;
  hash?: string;
  records: DbRecord[];
}
