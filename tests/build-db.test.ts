import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo JavaScript senza tipi
import { splitFaq } from '../scripts/build-db.mjs';

describe('build-db', () => {
  it('splitFaq divide domande e risposte', () => {
    const pairs = splitFaq('Intro\n\nD: Come si fa?\nR: Così.\n\n2. Quando?\nSubito.\nAnche dopo.');
    expect(pairs).toEqual([
      { q: 'Come si fa?', a: 'Così.' },
      { q: 'Quando?', a: 'Subito.\nAnche dopo.' }
    ]);
  });

  it('converte la cartella di esempio in un db.json valido', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dbtest-'));
    const out = path.join(dir, 'db.json');
    try {
      execFileSync('node', ['scripts/build-db.mjs', 'sorgenti-esempio', '--out', out, '--versione', '1'], { stdio: 'pipe' });
      const db = JSON.parse(readFileSync(out, 'utf8'));
      expect(db.versione).toBe('1');
      const ids = db.records.map((r: { id: string }) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      // almeno un record da ogni formato di esempio
      for (const id of [
        'normativa-regolamento-veicoli-aziendali', // .docx
        'procedure-richiesta-ferie', // .pdf
        'formazione-antincendio-punti-chiave', // .pptx
        'schede-tecniche-stampante-multifunzione-mf200', // .html
        'procedure-gestione-rifiuti-ufficio', // .md
        'faq-badge-e-accessi-posso-far-entrare-un-ospite', // .txt (FAQ divisa)
        'schede-tecniche-registro-dispositivi-sicurezza' // .xlsx tabella generica
      ]) {
        expect(ids).toContain(id);
      }
      expect(ids).toHaveLength(17);
      // statistiche: grafici e tabelle letti da PowerPoint, Excel e Word
      const report = db.records.find((r: { id: string }) => r.id === 'statistiche-report-attivita-sicilia-2025');
      expect(report.grafici.map((g: { titolo: string; tipo: string }) => `${g.tipo}:${g.titolo}`)).toEqual([
        'barre:Ispezioni per provincia', 'torta:Esito delle ispezioni (%)', 'linee:Andamento mensile 2025', 'barre:Violazioni più frequenti 2025'
      ]);
      expect(report.grafici[1]).toMatchObject({ unita: '%', categorie: ['Regolari', 'Irregolari', 'In corso'], serie: [{ valori: [39, 53, 8] }] });
      expect(report.testo).toContain('Grafico «Andamento mensile 2025» (Slide 4)');
      const excel = db.records.find((r: { id: string }) => r.id === 'statistiche-dati-provinciali-2023-2025');
      expect(excel.grafici[0].categorie).not.toContain('Totale');
      expect(excel.grafici[2]).toMatchObject({ tipo: 'linee', categorie: ['1° trim', '2° trim', '3° trim', '4° trim'] });
      const word = db.records.find((r: { id: string }) => r.id === 'statistiche-relazione-3-trimestre-2025');
      expect(word.grafici[1]).toMatchObject({ titolo: 'Tabella 2 – Infortuni denunciati per provincia', serie: [{ nome: 'Infortuni 2024', valori: [1204, 1130, 702, 455, 398] }, { nome: 'Infortuni 2025' }] });
      const ferie = db.records.find((r: { id: string }) => r.id === 'procedure-richiesta-ferie');
      expect(ferie).toMatchObject({ categoria: 'Procedure', data_aggiornamento: '2026-09-15', titolo: 'Richiesta di ferie e permessi' });
      expect(ferie.testo).toContain('almeno 5 giorni lavorativi');
      // FAQ Excel: un record per riga, tag dalla colonna Tag
      const vpn = db.records.find((r: { titolo: string }) => r.titolo === 'Come mi collego alla VPN da casa?');
      expect(vpn).toMatchObject({ categoria: 'FAQ', tag: ['vpn', 'smart working'] });
      // HTML: menu e piè di pagina rimossi
      const mf = db.records.find((r: { id: string }) => r.id.includes('mf200'));
      expect(mf.testo).not.toMatch(/Cookie|Contatti/);
      expect(mf.testo).toContain('24 ore');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
