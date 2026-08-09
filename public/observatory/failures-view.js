// failures-view.js — le bloc « Pannes » en accordeon par cause (doc/32).
//
// Rendu et interactions LOCALES seulement : depli d'une commande longue, retour
// de copie. Aucun acces reseau — l'acquittement sort d'ici comme une INTENTION
// (`onAckGroup`), advisor-view l'orchestre. Le regroupement et les phrases
// viennent de failures-format.js, les remedes de remedies.js.

import { groupAlerts, causeLabel, episodeLabel, failuresSummary, projectLabel } from './failures-format.js';
import { remedyFor } from './remedies.js';

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

// La commande d'un episode. Vide chez badInvocation = anterieure a la
// consigne du subject (doc/32) : le dire vaut mieux qu'un trou, qui se lirait
// comme un bug du bloc.
function commandes(alert) {
  if (alert.type === 'stuck') {
    return (Array.isArray(alert.tools) ? alert.tools : [])
      .map(t => `${t.toolName} · ${t.subject}`);
  }
  if (alert.subject) return [alert.subject];
  if (alert.type === 'badInvocation') return ['commande non consignée (alerte ancienne)'];
  return [];
}

function episodeNode(alert) {
  const ep = el('div', alert.acknowledged ? 'failure-episode is-acked' : 'failure-episode');
  const faits = episodeLabel(alert);
  ep.appendChild(el('div', 'failure-head',
    `${stamp(alert.createdAt)}  ${projectLabel(alert.cwd)}${faits ? `  ·  ${faits}` : ''}`));
  for (const cmd of commandes(alert)) {
    const ligne = el('div', cmd === 'commande non consignée (alerte ancienne)'
      ? 'failure-cmd is-missing' : 'failure-cmd', cmd);
    // Une commande longue se replie par CSS ; le clic la deplie. Interaction
    // locale : c'est le role de cette vue.
    ligne.addEventListener('click', () => ligne.classList.toggle('is-open'));
    ep.appendChild(ligne);
  }
  return ep;
}

function remedeNode(remede) {
  const bloc = el('div', 'failure-remede');
  bloc.appendChild(el('div', 'remede-consigne', remede.consigne));
  bloc.appendChild(el('pre', 'remede-extrait', remede.extrait));
  const copier = el('button', 'remede-copier', 'Copier');
  copier.type = 'button';
  const zone = el('span', 'remede-copie', '');
  zone.setAttribute('aria-live', 'polite');
  copier.addEventListener('click', () => {
    const ecrire = globalThis.navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(remede.extrait)
      : Promise.reject(new Error('presse-papier indisponible'));
    ecrire.then(() => { zone.textContent = 'copié'; })
      .catch(() => { zone.textContent = 'copie impossible — sélectionnez le texte ci-dessus'; });
  });
  bloc.append(copier, zone);
  return bloc;
}

function groupNode(group, onAckGroup) {
  const det = el('details', group.unacked ? 'failure-group' : 'failure-group is-acked');
  const resume = el('summary', 'failure-group-head');
  resume.appendChild(el('span', 'failure-cause', causeLabel(group)));
  const n = group.episodes.length;
  resume.appendChild(el('span', 'failure-group-meta',
    `${n} épisode${n > 1 ? 's' : ''} · dernier ${stamp(group.lastAt)}`));
  if (group.unacked) resume.appendChild(el('span', 'failure-a-traiter', 'à traiter'));
  det.appendChild(resume);

  for (const alert of group.episodes) det.appendChild(episodeNode(alert));

  const remede = remedyFor(group.episodes[0]);
  if (remede) det.appendChild(remedeNode(remede));

  if (group.unacked && onAckGroup) {
    const btn = el('button', 'failure-ack', `Tout acquitter (${group.unacked})`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      onAckGroup(group.episodes);
    });
    det.appendChild(btn);
  }
  return det;
}

export function renderFailures(node, alerts, { onAckGroup } = {}) {
  node.textContent = '';
  const enAttente = (alerts || []).some(a => !a.acknowledged);
  const title = el('div', 'failures-title');
  title.append(el('span', undefined, 'Pannes détectées'));
  title.appendChild(el('span', enAttente ? 'failures-count' : 'failures-count is-quiet',
    failuresSummary(alerts)));
  node.appendChild(title);
  if (!alerts || alerts.length === 0) {
    node.appendChild(el('div', 'failures-empty',
      'Aucune panne sur la période. Ce bloc garde ce qui s’est produit même quand personne ne regardait.'));
    return;
  }
  for (const group of groupAlerts(alerts)) node.appendChild(groupNode(group, onAckGroup));
}
