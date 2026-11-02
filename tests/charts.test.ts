import { describe, expect, it } from 'vitest';
import { etichetteTemporali, graficiNelBrano, graficoToText, leggiGraficoOffice, normalizeGrafico, parseNumero, tabellaToGrafico } from '../src/shared/charts.ts';
import { parseMarkdown } from '../src/shared/markdown.ts';
import { parseChartExtract } from '../src/shared/charts-ai.ts';
import { buildDbRequest } from '../src/shared/gemini.ts';

describe('numeri', () => {
  it('formati italiani e inglesi', () => {
    expect(parseNumero('1.234,5')).toBe(1234.5);
    expect(parseNumero('1.234')).toBe(1234);
    expect(parseNumero('12,5%')).toBe(12.5);
    expect(parseNumero('€ 1.200')).toBe(1200);
    expect(parseNumero('1,234.56')).toBe(1234.56);
    expect(parseNumero('(35)')).toBe(-35);
    expect(parseNumero('-')).toBeNull();
    expect(parseNumero('n.d.')).toBeNull();
    expect(parseNumero('Palermo')).toBeUndefined();
    expect(parseNumero('1.234', true)).toBe(1.234);
  });
  it('etichette nel tempo', () => {
    expect(etichetteTemporali(['2023', '2024', '2025'])).toBe(true);
    expect(etichetteTemporali(['Gen', 'Feb', 'Mar'])).toBe(true);
    expect(etichetteTemporali(['1° trim', '2° trim'])).toBe(true);
    expect(etichetteTemporali(['Palermo', 'Catania'])).toBe(false);
  });
});

describe('tabelle → grafici', () => {
  it('righe = categorie, colonne numeriche = serie, senza il totale', () => {
    const g = tabellaToGrafico([['Provincia', '2024', '2025'], ['Palermo', '1.204', '1.168'], ['Catania', '1.130', '1.152'], ['Totale', '2.334', '2.320']])!;
    expect(g.categorie).toEqual(['Palermo', 'Catania']);
    expect(g.serie).toEqual([{ nome: '2024', valori: [1204, 1130] }, { nome: '2025', valori: [1168, 1152] }]);
  });
  it('una riga con anni in intestazione → andamento nel tempo', () => {
    const g = tabellaToGrafico([['Indicatore', '2022', '2023', '2024'], ['Ispezioni', '1.900', '2.050', '2.230']])!;
    expect(g.categorie).toEqual(['2022', '2023', '2024']);
    expect(g.tipo).toBe('linee');
  });
  it('percentuali che fanno 100 → torta', () => {
    const g = tabellaToGrafico([['Esito', 'Quota'], ['Regolari', '39%'], ['Irregolari', '53%'], ['In corso', '8%']])!;
    expect(g).toMatchObject({ tipo: 'torta', unita: '%' });
  });
  it('tabelle senza numeri restano testo', () => {
    expect(tabellaToGrafico([['Nome', 'Ruolo'], ['Rossi', 'Ispettore']])).toBeNull();
  });
});

describe('grafici di Office', () => {
  it('legge serie, categorie e titolo dalla cache del grafico', () => {
    const xml = `<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Infortuni</a:t></a:r></a:p></c:rich></c:tx></c:title>
      <c:plotArea><c:lineChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Gen</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="2"><c:v>Mar</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="2"><c:v>12.5</c:v></c:pt></c:numCache></c:numRef></c:val>
      </c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>`;
    expect(leggiGraficoOffice(xml, 'Slide 2')).toEqual({
      titolo: 'Infortuni', tipo: 'linee', categorie: ['Gen', 'Feb', 'Mar'], serie: [{ nome: '2025', valori: [10, null, 12.5] }], posizione: 'Slide 2'
    });
  });
});

describe('grafici nelle risposte AI', () => {
  const g = { titolo: 'Ispezioni', tipo: 'barre', categorie: ['A', 'B'], serie: [{ nome: 'N', valori: [1, 2] }] };
  it('blocco ```grafico → grafico, con le fonti note', () => {
    const md = `Ecco i dati [rep].\n\n\`\`\`grafico\n${JSON.stringify({ ...g, fonti: ['rep', 'ignoto'] })}\n\`\`\`\n\nFine.`;
    const blocks = parseMarkdown(md, new Set(['rep']));
    expect(blocks.map((b) => b.t)).toEqual(['p', 'chart', 'p']);
    expect(blocks[1]).toMatchObject({ t: 'chart', aperto: false, fonti: ['rep'], g: { titolo: 'Ispezioni', categorie: ['A', 'B'] } });
  });
  it('mentre arriva il testo il blocco è «aperto»', () => {
    const blocks = parseMarkdown('Testo\n```grafico\n{"titolo": "Isp', new Set());
    expect(blocks[1]).toMatchObject({ t: 'chart', aperto: true, g: null });
  });
  it('tabelle Markdown', () => {
    const blocks = parseMarkdown('| Provincia | Casi |\n|---|---|\n| Palermo | 3 |\n| Enna | 1 |');
    expect(blocks[0]).toMatchObject({ t: 'table' });
    expect((blocks[0] as { rows: unknown[] }).rows).toHaveLength(2);
  });
  it('JSON non valido o con valori testuali', () => {
    expect(normalizeGrafico({ titolo: 'x', categorie: ['a'], serie: [{ nome: 's', valori: ['n.d.'] }] })).toBeNull();
    expect(normalizeGrafico({ categorie: ['a', 'b'], serie: [{ nome: 's', valori: ['1.200', 3] }] })).toMatchObject({ titolo: 's', serie: [{ valori: [1200, 3] }] });
  });
  it('i dati strutturati arrivano all\'AI e il prompt chiede risposte mirate con grafici', () => {
    const req = buildDbRequest('ispezioni a Catania', [{ recordId: 'rep', titolo: 'Report', categoria: '', fonte: '', data_aggiornamento: '', testo: 't', grafici: ['{"titolo":"Ispezioni"}'] }]);
    const text = JSON.stringify(req);
    expect(text).toContain('DATI STRUTTURATI del documento rep');
    expect(req.systemInstruction!.parts[0].text).toMatch(/RISPOSTA MIRATA/);
    expect(req.systemInstruction!.parts[0].text).toMatch(/```grafico/);
  });
});

describe('testo e lettura AI', () => {
  it('il testo del grafico permette di ritrovarlo nel brano', () => {
    const g = normalizeGrafico({ titolo: 'Ispezioni', categorie: ['A'], serie: [{ nome: 'N', valori: [15000] }], posizione: 'Slide 2' })!;
    const t = graficoToText(g);
    expect(t).toContain('Grafico «Ispezioni» (Slide 2)');
    expect(t).toMatch(/A \| 15\.000/);
    expect(graficiNelBrano([g], `bla\n${t}`)).toEqual([g]);
  });
  it('risposta di Gemini con pagine', () => {
    const r = parseChartExtract(JSON.stringify({ descrizione: 'Report', grafici: [{ titolo: 'T', tipo: 'barre', pagina: 3, categorie: ['a', 'b'], serie: [{ nome: 's', valori: [1, null] }] }] }));
    expect(r.grafici[0]).toMatchObject({ posizione: 'pag. 3', serie: [{ valori: [1, null] }] });
  });
});
