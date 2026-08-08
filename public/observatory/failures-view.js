// failures-view.js — le bloc « Pannes », en tete du tiroir Conseils.
//
// Rendu seulement : la formulation est dans failures-format.js, la donnee
// vient de GET /alerts. C'est le seul endroit du produit ou une panne survit a
// la session pendant laquelle elle s'est produite — le canevas et le flux
// d'activite se vident, ce tiroir non.

import { failureLine, failuresSummary } from './failures-format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Date et heure : une panne d'il y a trois jours et une d'il y a trois minutes
// se lisent dans la meme liste, une heure seule les confondrait.
function stamp(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function failureRow(alert) {
  const line = failureLine(alert);
  const row = el('div', alert.acknowledged ? 'failure-row is-acked' : 'failure-row');
  row.append(
    el('div', 'failure-head', `${stamp(line.time)}  ${line.project}`),
    el('div', 'failure-what', line.headline),
  );
  if (line.subject) row.appendChild(el('div', 'failure-subject', line.subject));
  if (alert.acknowledged) row.appendChild(el('div', 'failure-acked', 'acquittée'));
  return row;
}

export function renderFailures(node, alerts) {
  node.textContent = '';
  // Le compte est mis en avant quand il y a quelque chose a acquitter, et rendu
  // muet sinon : « aucune » en rouge se lit de loin comme une alerte.
  const enAttente = alerts.some(a => !a.acknowledged);
  const title = el('div', 'failures-title');
  title.append(el('span', undefined, 'Pannes détectées'));
  title.appendChild(el('span', enAttente ? 'failures-count' : 'failures-count is-quiet',
    failuresSummary(alerts)));
  node.appendChild(title);
  if (alerts.length === 0) {
    node.appendChild(el('div', 'failures-empty',
      'Aucune panne sur la période. Ce bloc garde ce qui s’est produit même quand personne ne regardait.'));
    return;
  }
  for (const alert of alerts) node.appendChild(failureRow(alert));
}
