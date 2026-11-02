// Lettura di grafici e tabelle con l'AI (Gemini) da PDF e immagini: nei PDF i grafici sono disegni,
// i numeri vanno letti "guardando" la pagina. Richiesta e lettura della risposta: funzioni pure.
import { normalizeGrafici } from './charts.ts';
import type { GeminiRequest } from './gemini.ts';
import type { Grafico } from './types.ts';

export const SYSTEM_CHART_EXTRACT = `Sei un analista di dati. Ti viene dato un documento (PDF o immagine) con statistiche, tabelle e grafici.
Estrai TUTTI i grafici e le tabelle numeriche presenti, ciascuno come oggetto separato:
- "titolo": il titolo del grafico o della tabella come scritto nel documento (se manca, descrivilo in poche parole);
- "tipo": "barre", "linee", "area", "torta", "ciambella" o "tabella" (come appare nel documento);
- "pagina": numero della pagina in cui si trova (1 per un'immagine);
- "unita": unità dei valori se indicata ("%", "€", "ore"…), altrimenti stringa vuota;
- "categorie": le etichette dell'asse orizzontale, gli spicchi o le righe della tabella, nell'ordine;
- "serie": per ogni serie (legenda o colonna numerica) il nome e i valori, uno per categoria, nello stesso ordine.
Regole: usa i numeri scritti nel documento (etichette dei dati, valori in tabella). Se un grafico non riporta i numeri,
stimali dalla scala e scrivi in "nota" che sono valori stimati dal grafico. Numeri senza separatore delle migliaia,
decimali con il punto; null se un valore manca. Non inventare grafici che non ci sono.
In "descrizione" scrivi 2-4 frasi sul contenuto del documento (argomento, periodo, territorio).`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    descrizione: { type: 'STRING' },
    grafici: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titolo: { type: 'STRING' },
          tipo: { type: 'STRING', enum: ['barre', 'linee', 'area', 'torta', 'ciambella', 'tabella'] },
          pagina: { type: 'INTEGER' },
          unita: { type: 'STRING' },
          nota: { type: 'STRING' },
          categorie: { type: 'ARRAY', items: { type: 'STRING' } },
          serie: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { nome: { type: 'STRING' }, valori: { type: 'ARRAY', items: { type: 'NUMBER', nullable: true } } },
              required: ['nome', 'valori']
            }
          }
        },
        required: ['titolo', 'tipo', 'categorie', 'serie']
      }
    }
  },
  required: ['grafici']
};

/** Formati che l'AI sa leggere per i grafici. */
export const MIME_AI: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

/** Limite del file (il contenuto viaggia nella richiesta, codificato). */
export const MAX_BYTES_AI = 14 * 1024 * 1024;

export function buildChartExtractRequest(data: string, mimeType: string, nome: string): GeminiRequest {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_CHART_EXTRACT }] },
    contents: [{
      role: 'user',
      parts: [{ inlineData: { mimeType, data } }, { text: `File: ${nome}. Estrai grafici e tabelle numeriche.` }]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 32768, responseMimeType: 'application/json', responseSchema: SCHEMA }
  };
}

export interface LetturaAi {
  descrizione: string;
  grafici: Grafico[];
}

/** Risposta dell'AI → grafici validi (posizione «pag. N» dai numeri di pagina). */
export function parseChartExtract(text: string, immagine = false): LetturaAi {
  let o: { descrizione?: unknown; grafici?: unknown };
  try {
    o = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as typeof o;
  } catch {
    throw new Error("l'AI non ha restituito dati leggibili");
  }
  const raw = Array.isArray(o.grafici) ? o.grafici : [];
  const withPos = raw.map((g) => {
    const x = g as Record<string, unknown>;
    const pag = Number(x.pagina);
    return { ...x, posizione: !immagine && pag > 0 ? `pag. ${pag}` : undefined };
  });
  return { descrizione: String(o.descrizione ?? '').trim(), grafici: normalizeGrafici(withPos) };
}

/** Byte → base64 (a pezzi, senza superare i limiti degli argomenti). */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}
