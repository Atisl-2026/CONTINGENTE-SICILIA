import { asset, BRAND } from '../branding';
import { ApkLink } from '../components/ApkLink';

// Disegni decorativi delle schede (nessun dato: solo forme, nei colori dei grafici dell'app)
const Barre = () => (
  <svg viewBox="0 0 120 34" aria-hidden="true">
    {[14, 22, 17, 28, 20, 31, 25].map((h, i) => (
      <rect key={i} x={4 + i * 16} y={34 - h} width="9" height={h} rx="3" fill={i % 2 ? '#dce6f5' : '#3987e5'} opacity={i % 2 ? 0.7 : 1} />
    ))}
  </svg>
);
const Linea = () => (
  <svg viewBox="0 0 120 34" aria-hidden="true">
    <path d="M2 28 L20 22 L36 25 L54 14 L72 17 L90 8 L118 4" fill="none" stroke="#3987e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M2 31 L20 27 L36 29 L54 23 L72 25 L90 19 L118 16" fill="none" stroke="#dce6f5" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
const Ciambella = () => (
  <svg viewBox="0 0 120 34" aria-hidden="true">
    <circle cx="60" cy="17" r="13" fill="none" stroke="rgba(220,230,245,.25)" stroke-width="6" />
    <circle cx="60" cy="17" r="13" fill="none" stroke="#3987e5" stroke-width="6" stroke-dasharray="58 82" transform="rotate(-90 60 17)" stroke-linecap="round" />
  </svg>
);
const Fogli = () => (
  <svg viewBox="0 0 120 34" aria-hidden="true">
    {['#2b7cd3', '#1d7044', '#c4482c', '#d93a3a'].map((c, i) => (
      <g key={c} transform={`translate(${18 + i * 22} 3)`}>
        <rect width="18" height="26" rx="3" fill={c} opacity="0.9" />
        <rect x="4" y="8" width="10" height="2" rx="1" fill="#fff" opacity="0.8" />
        <rect x="4" y="13" width="10" height="2" rx="1" fill="#fff" opacity="0.6" />
        <rect x="4" y="18" width="7" height="2" rx="1" fill="#fff" opacity="0.6" />
      </g>
    ))}
  </svg>
);

/** Pagina di benvenuto, prima della scelta dell'accesso. */
export function WelcomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <div class="welcome">
      <div class="welcome-hero">
        <img src={asset(BRAND.logoCompleto)} alt={`Carta della Sicilia con i capoluoghi e il logo del ${BRAND.nome}`} width="1200" height="900" />
      </div>

      <h1 class="welcome-title">
        <span class="welcome-hello">Benvenuti nel</span>
        <span class="welcome-name">{BRAND.nome}</span>
      </h1>

      <div class="welcome-coord">
        <p class="welcome-coord-label">Coordinatori</p>
        <ul>{BRAND.coordinatori.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>
      <div class="welcome-stripe" aria-hidden="true" />

      <div class="welcome-tiles">
        <div class="welcome-tile"><Fogli /><strong>Carica i tuoi file</strong><span>Excel, Word, PowerPoint e PDF</span></div>
        <div class="welcome-tile"><Barre /><strong>Grafici e tabelle</strong><span>letti direttamente dai documenti</span></div>
        <div class="welcome-tile"><Linea /><strong>Resoconti mirati</strong><span>chiedi e l'IA ti dà solo i dati che servono</span></div>
        <div class="welcome-tile"><Ciambella /><strong>Anche offline</strong><span>archivio e ricerca sul telefono</span></div>
      </div>

      <button type="button" class="btn btn-primary btn-block welcome-enter" onClick={onEnter}>
        Entra
      </button>
      <ApkLink />
    </div>
  );
}
