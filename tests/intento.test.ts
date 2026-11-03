import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { conSinonimi, intentoDomanda } from '../src/shared/intento.ts';
import { pertinenza } from '../src/shared/charts.ts';
import type { Grafico, StoredRecord } from '../src/shared/types.ts';

describe('che cosa chiede la domanda', () => {
  it('riepilogo generale, totali, argomento preciso', () => {
    expect(intentoDomanda('Mi fai un riepilogo?')).toMatchObject({ generale: true, totali: true });
    expect(intentoDomanda('resoconto generale dei dati 2026')).toMatchObject({ generale: true });
    expect(intentoDomanda('ispezioni totali')).toMatchObject({ generale: false, totali: true, argomento: ['ispezioni'] });
    expect(intentoDomanda('quante sospensioni in totale')).toMatchObject({ generale: false, totali: true });
    expect(intentoDomanda('riepilogo lavoro nero')).toMatchObject({ generale: false, totali: true, argomento: ['lavoro', 'nero'] });
    expect(intentoDomanda('lavoratori in nero a Catania')).toMatchObject({ generale: false, totali: false });
  });
  it('parole equivalenti nelle statistiche', () => {
    expect(conSinonimi(['ispezioni'])).toEqual(expect.arrayContaining(['pratiche', 'accessi']));
    expect(conSinonimi(['sospensioni'])).toContain('provvedimenti');
    expect(conSinonimi(['esternalizzazioni'])).toContain('appalti');
  });
  it('«ispezioni» trova la tabella delle «pratiche»', () => {
    const g: Grafico = { titolo: 'Dashboard – numeri chiave', tipo: 'kpi', categorie: ['PRATICHE DISTINTE', 'VERBALI'], serie: [{ nome: 'Valore', valori: [2906, 1761] }] };
    expect(pertinenza(g, 'ispezioni totali')).toBeGreaterThan(0);
  });
});

describe('riepiloghi e totali: numeri chiave sempre all\'AI', () => {
  const kpi = (titolo: string, cat: string[]): Grafico => ({ titolo, tipo: 'kpi', categorie: cat, serie: [{ nome: 'Valore', valori: cat.map((_, i) => i + 1) }] });
  const grafici: Grafico[] = [
    kpi('Dashboard – numeri chiave', ['PRATICHE DISTINTE', 'VERBALI']),
    kpi('Sospensioni – numeri chiave', ['Provvedimenti distinti', 'Importi contestati (€)']),
    { titolo: 'Pratiche per ispettore', tipo: 'tabella', categorie: ['mario.rossi'], serie: [{ nome: 'Pratiche', valori: [80] }] },
    { titolo: 'Lavoratori in nero per provincia', tipo: 'barre', categorie: ['Catania'], serie: [{ nome: 'Lavoratori in nero', valori: [104] }] }
  ];
  it('riepilogo generale: tutti i numeri chiave, niente dettagli per persona', async () => {
    const { scegliTabelle } = await import('../src/lib/ai');
    expect(scegliTabelle(grafici, 'mi fai un riepilogo').map((g) => g.titolo)).toEqual(['Dashboard – numeri chiave', 'Sospensioni – numeri chiave']);
  });
  it('domanda precisa: solo le tabelle pertinenti', async () => {
    const { scegliTabelle } = await import('../src/lib/ai');
    expect(scegliTabelle(grafici, 'lavoratori in nero a Catania').map((g) => g.titolo)).toEqual(['Lavoratori in nero per provincia']);
  });
  it('il documento con i numeri chiave entra tra i brani anche se la ricerca non l\'ha trovato', async () => {
    const { clearAll, putRecords } = await import('../src/lib/db');
    const { conSintesi } = await import('../src/lib/ai');
    await clearAll();
    const rec = (id: string, g?: Grafico[]): StoredRecord => ({
      id, titolo: id, testo: `Testo di ${id}`, categoria: 'Statistiche', tag: [], fonte: '', data_aggiornamento: '2026-10-24', origine: 'locale', salvato_il: 0, ...(g ? { grafici: g } : {})
    });
    await putRecords([rec('monitoraggio', grafici), rec('circolare')]);
    const res = await conSintesi('mi fai un riepilogo', []);
    expect(res.map((r) => r.record.id)).toEqual(['monitoraggio']);
    expect(res[0].chunk.testo).toBe('Testo di monitoraggio');
    expect(await conSintesi('lavoratori in nero a Catania', [])).toEqual([]);
  });
});

describe('ordine dei numeri chiave', () => {
  it('«ispezioni totali»: prima il riquadro con le pratiche distinte, non quello del personale', () => {
    const dash: Grafico = { titolo: 'Monitoraggio ispezioni Sicilia 2026 – numeri chiave', tipo: 'kpi', categorie: ['PRATICHE DISTINTE', 'VERBALI'], serie: [{ nome: 'Valore', valori: [2906, 1761] }] };
    const pers: Grafico = { titolo: 'Personale ispettivo – statistica totale – numeri chiave', tipo: 'kpi', categorie: ['ISPETTORI TOTALI', 'PRATICHE UNICHE'], serie: [{ nome: 'Valore', valori: [68, 2906] }] };
    expect(pertinenza(dash, 'ispezioni totali')).toBeGreaterThan(pertinenza(pers, 'ispezioni totali'));
  });
});
