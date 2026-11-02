import { describe, expect, it } from 'vitest';
import { blocchi, leggiFoglio } from '../src/shared/fogli.ts';
import { leggiGraficoOffice } from '../src/shared/charts.ts';

/** Foglio come lo legge readXlsx: righe non vuote, con il numero di riga e le colonne al loro posto. */
function foglio(celle: Record<string, string>) {
  const perRiga = new Map<number, string[]>();
  for (const [ref, v] of Object.entries(celle)) {
    const m = ref.match(/^([A-Z])(\d+)$/)!;
    const r = +m[2], c = m[1].charCodeAt(0) - 65;
    const row = perRiga.get(r) ?? [];
    row[c] = v;
    perRiga.set(r, row);
  }
  const righe = [...perRiga.keys()].sort((a, b) => a - b);
  const width = Math.max(...[...perRiga.values()].map((r) => r.length));
  return { righe, rows: righe.map((r) => Array.from({ length: width }, (_, i) => perRiga.get(r)![i] ?? '')) };
}

// come il foglio «Violazioni e tutele»: titolo, numeri chiave in riga, tabella, tabella di appoggio del grafico
const cruscotto = foglio({
  A1: 'Violazioni e lavoratori tutelati – 2026',
  J2: 'Fenomeno', K2: 'Violazioni',
  A3: 'Verbali', B3: '1761', C3: 'Importi contestati', D3: '€ 6312153.87', E3: 'Ultimo dato', F3: '23/10/2026', J3: 'Esternalizzazione', K3: '7441',
  A4: 'Posizioni lavoratori', B4: '2184', C4: 'CF distinti', D4: '1902', J4: 'Lavoro Nero', K4: '526',
  A7: 'Fenomeno', B7: 'Violazioni pesate', C7: '% totale', D7: 'Importo contestato',
  A8: 'Esternalizzazione', B8: '7441', C8: '61.3%', D8: '€ 377287',
  A9: 'Lavoro Nero', B9: '526', C9: '4.3%', D9: '€ 1301010',
  A10: 'Caporalato', B10: '3', C10: '0.02%', D10: '€ 0',
  A11: 'TOTALE', B11: '7970', C11: '100%', D11: '€ 1678297'
});

describe('fogli Excel «a cruscotto»', () => {
  it('separa titolo, numeri chiave e tabelle in blocchi', () => {
    const bs = blocchi(cruscotto.rows, cruscotto.righe);
    expect(bs.map((b) => `${b.top}:${b.left}-${b.bottom}:${b.right}`)).toEqual(['1:0-1:0', '2:9-4:10', '3:0-4:5', '7:0-11:3']);
  });

  it('numeri chiave in un riquadro, tabella con titolo e unità, niente «Colonna 2»', () => {
    const { grafici, testo } = leggiFoglio('Violazioni e tutele', cruscotto.rows, cruscotto.righe);
    const kpi = grafici[0];
    const tab = grafici.find((g) => g.titolo === 'Violazioni pesate per fenomeno')!;
    expect(kpi).toMatchObject({ tipo: 'kpi', titolo: 'Violazioni e lavoratori tutelati – 2026 – numeri chiave' });
    expect(kpi.categorie).toEqual(['Verbali', 'Importi contestati (€)', 'Posizioni lavoratori', 'CF distinti']);
    expect(kpi.serie[0].valori).toEqual([1761, 6312153.87, 2184, 1902]);
    expect(tab.categorie).toEqual(['Esternalizzazione', 'Lavoro Nero', 'Caporalato']); // senza TOTALE
    expect(tab.serie.map((s) => s.nome)).toEqual(['Violazioni pesate', '% totale', 'Importo contestato']);
    expect(grafici.flatMap((g) => g.serie.map((s) => s.nome)).join()).not.toMatch(/Colonna/);
    expect(testo).toContain('Ultimo dato: 23/10/2026');
    expect(testo).toContain('Tabella «Violazioni pesate per fenomeno»');
  });

  it('la tabella di appoggio di un grafico Excel non si ripete', () => {
    const chart = { titolo: 'Violazioni per fenomeno', tipo: 'torta' as const, categorie: ['Esternalizzazione', 'Lavoro Nero'], serie: [{ nome: 'Violazioni', valori: [7441, 526] }] };
    const { grafici } = leggiFoglio('Violazioni e tutele', cruscotto.rows, cruscotto.righe, [chart]);
    expect(grafici.map((g) => g.titolo)).toEqual([
      'Violazioni e lavoratori tutelati – 2026 – numeri chiave', 'Violazioni pesate per fenomeno', 'Violazioni per fenomeno'
    ]);
    expect(grafici[2].tipo).toBe('torta');
  });

  it('tabelle affiancate con le stesse intestazioni diventano una sola; riquadri «etichetta sopra, valore sotto»', () => {
    const f = foglio({
      A1: 'PRATICHE', A2: '2906', C1: 'COPERTURA COMUNI', C2: '79.8%',
      A4: 'Profilo', B4: 'N.', C4: 'Profilo', D4: 'N.',
      A5: 'Italiani', B5: '415', C5: 'Comunitari', D5: '14',
      A6: 'Extracomunitari', B6: '69', C6: 'Maschi', D6: '336'
    });
    const { grafici } = leggiFoglio('Lavoro nero', f.rows, f.righe);
    expect(grafici[0]).toMatchObject({ tipo: 'kpi', categorie: ['PRATICHE', 'COPERTURA COMUNI (%)'], serie: [{ valori: [2906, 79.8] }] });
    expect(grafici[1].categorie).toEqual(['Italiani', 'Extracomunitari', 'Comunitari', 'Maschi']);
  });

  it('grafico Excel senza titolo né nome della serie: titolo dalle intestazioni delle celle', () => {
    const xml = `<c:chartSpace><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:pieChart><c:ser>
      <c:cat><c:strRef><c:f>Dashboard!$N$3:$N$4</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Agrigento</c:v></c:pt><c:pt idx="1"><c:v>Enna</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f>Dashboard!$O$3:$O$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>336</c:v></c:pt><c:pt idx="1"><c:v>1.24E2</c:v></c:pt></c:numCache></c:numRef></c:val>
      </c:ser></c:pieChart></c:plotArea></c:chart></c:chartSpace>`;
    const intest: Record<string, string> = { 'Dashboard!$O$3:$O$4': 'Pratiche', 'Dashboard!$N$3:$N$4': 'Provincia' };
    const g = leggiGraficoOffice(xml, undefined, (ref) => ({ valori: [], intestazione: intest[ref] ?? '' }))!;
    expect(g).toMatchObject({ titolo: 'Pratiche per provincia', tipo: 'torta', serie: [{ nome: 'Pratiche', valori: [336, 124] }] });
  });
});
