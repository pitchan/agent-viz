// format.js — display helpers for the observatory pages.
//
// Pure functions only, no DOM at import time, so they can be unit-tested.
// formatTokens is NOT redefined here: viz-state.js already owns it and is
// importable under Node.

export { formatTokens } from '../viz-state.js';

export function formatUsd(n) {
  return `${n.toFixed(2).replace('.', ',')} $`;
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}

// "—" rather than "0 min": a session without timestamps has an unknown
// duration, not a null one.
export function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return '—';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const CONFIDENCE_LABELS = { fait: 'Fait mesuré', correlation: 'Corrélation', hypothese: 'Hypothèse' };
export function confidenceLabel(c) {
  return CONFIDENCE_LABELS[c] || 'Inconnu';
}

const BASIS_LABELS = {
  'jetons-mesures': 'jetons mesurés',
  'octets-approx-4o-par-jeton': 'estimé depuis les octets (≈ 4 octets par jeton)',
};
export function costBasisLabel(basis) {
  return BASIS_LABELS[basis] || basis;
}

export function costLabel(rec) {
  const partial = rec.evidence.costComplete === false
    ? ' (coût partiel : un modèle sans tarif connu)' : '';
  return `${formatUsd(rec.estimatedCostUsd)} — ${costBasisLabel(rec.costBasis)}${partial}`;
}

// Heading of a cost-basis block. It exists to tell the reader that the two
// blocks are not comparable — the whole point of ranking them separately.
const BASIS_TITLES = {
  'jetons-mesures': 'Chiffré en jetons mesurés',
  'octets-approx-4o-par-jeton': 'Estimé depuis les octets — à ne pas comparer au bloc ci-dessus',
};
export function basisTitle(basis) {
  return BASIS_TITLES[basis] || basis;
}
