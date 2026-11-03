import { describe, expect, it } from 'vitest';
import { costruisciRiepilogo, etichettaLeggibile, numeroTesto } from '../src/shared/riepilogo.ts';
import type { Grafico } from '../src/shared/types.ts';

const kpi = (foglio: string, voci: [string, number][]): Grafico => ({
  titolo: `${foglio} – numeri chiave`, tipo: 'kpi', posizione: `Foglio «${foglio}»`,
  categorie: voci.map((v) => v[0]), serie: [{ nome: 'Valore', valori: voci.map((v) => v[1]) }]
});
const doc = {
  id: 'monitoraggio', titolo: 'Monitoraggio Sicilia 2026', data: '24/10/2026',
  grafici: [
    kpi('Dashboard', [['PRATICHE DISTINTE', 2906], ['VO PESATE', 1477.5], ['COPERTURA COMUNI (%)', 79.8], ['SOSPENSIONI DISTINTE', 448]]),
    kpi('Vigilanza agricoltura', [['Pratiche speciali', 218], ['% totale pratiche (%)', 7.5]]),
    kpi('Lavoro nero', [['Pratiche', 311], ['Lavoratori in nero', 498], ['Importo contestato (€)', 1301010]]),
    kpi('Personale', [['ISPETTORI TOTALI', 68], ['PRATICHE UNICHE', 2906]]),
    { titolo: 'Pratiche per ispettore', tipo: 'tabella', categorie: ['mario.rossi'], serie: [{ nome: 'Pratiche', valori: [80] }] } as Grafico
  ]
};

describe('riepilogo scritto senza AI', () => {
  it('numeri ed etichette leggibili', () => {
    expect(numeroTesto(2906)).toBe('2.906');
    expect(numeroTesto(1301010)).toBe('1.301.010');
    expect(numeroTesto(79.8)).toBe('79,8');
    expect(numeroTesto(525.9978)).toBe('526');
    expect(etichettaLeggibile('VO PESATE')).toBe('VO pesate');
    expect(etichettaLeggibile('ALT CAPORALATO T.R.E.')).toBe('ALT caporalato T.R.E.');
    expect(etichettaLeggibile('FATTISPECIE/TIPOLOGIE')).toBe('Fattispecie/tipologie');
    expect(etichettaLeggibile('Lavoratori in nero')).toBe('Lavoratori in nero');
    expect(etichettaLeggibile('LAVORATORI IN NERO')).toBe('Lavoratori in nero');
    expect(etichettaLeggibile('CON RUOLO PRIMARIO')).toBe('Con ruolo primario');
    expect(etichettaLeggibile('ENTRAMBI I RUOLI')).toBe('Entrambi i ruoli');
    expect(etichettaLeggibile('PROVVEDIMENTI MISTI LN + S&S')).toBe('Provvedimenti misti LN + S&S');
    expect(etichettaLeggibile('CF DISTINTI')).toBe('CF distinti');
  });

  it('una riga per area, con unità; niente tabelle per persona', () => {
    const r = costruisciRiepilogo([doc], 'mi fai un riepilogo');
    expect(r.evidenza).toEqual([]);
    expect(r.testo.split('\n')).toEqual([
      'Riepilogo – Monitoraggio Sicilia 2026 (dati al 24/10/2026)',
      'Dashboard: Ispezioni (pratiche distinte) 2.906 · VO pesate 1.477,5 · Copertura comuni 79,8% · Sospensioni distinte 448',
      'Vigilanza agricoltura: Pratiche speciali 218 · % totale pratiche 7,5%',
      'Lavoro nero: Pratiche 311 · Lavoratori in nero 498 · Importo contestato € 1.301.010',
      'Personale: Ispettori totali 68 · Pratiche uniche 2.906'
    ]);
  });

  it('«ispezioni totali»: in evidenza il totale, una volta sola', () => {
    const r = costruisciRiepilogo([doc], 'ispezioni totali');
    expect(r.evidenza.map((v) => `${v.etichetta}: ${v.valore} (${v.area})`)).toEqual(['Ispezioni (pratiche distinte): 2.906 (Dashboard)']);
    expect(r.testo).toContain('In evidenza: Ispezioni (pratiche distinte): 2.906');
  });

  it('«quante sospensioni in totale» e «lavoratori in nero complessivi»', () => {
    expect(costruisciRiepilogo([doc], 'quante sospensioni in totale').evidenza.map((v) => v.valore)).toEqual(['448']);
    expect(costruisciRiepilogo([doc], 'lavoratori in nero complessivi').evidenza.map((v) => v.etichetta)).toContain('Lavoratori in nero');
  });
});
