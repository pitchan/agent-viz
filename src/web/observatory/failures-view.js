// failures-view.js — le bloc « Pannes » en accordeon par cause (doc/32).
//
// Rendu et interactions LOCALES seulement : depli d'une commande longue, retour
// de copie. Aucun acces reseau — l'acquittement sort d'ici comme une INTENTION
// (`onAckGroup`), advisor-view l'orchestre. Le regroupement et les phrases
// viennent de failures-format.js, les remedes de remedies.js.

import { groupAlerts, causeLabel, episodeLabel, failuresSummary, projectLabel, panelAlerts } from './failures-format.js';
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

const SANS_COMMANDE = 'commande non consignée (alerte ancienne)';

// La commande d'un episode. Vide chez badInvocation = anterieure a la
// consigne du subject (doc/32) : le dire vaut mieux qu'un trou, qui se lirait
// comme un bug du bloc.
function commandes(alert) {
  if (alert.type === 'stuck') {
    return (Array.isArray(alert.tools) ? alert.tools : [])
      .map(t => (t.subject ? `${t.toolName} · ${t.subject}` : t.toolName));
  }
  if (alert.subject) return [alert.subject];
  if (alert.type === 'badInvocation') return [SANS_COMMANDE];
  return [];
}

// Une commande longue se replie par CSS et se deplie au geste. Le geste n'est
// pas reserve a la souris : role, tabindex et clavier, et l'etat s'annonce
// (aria-expanded) au lieu de ne vivre que dans une classe CSS. La ligne « non
// consignee » n'a rien a deplier — la deguiser en bouton mentirait.
function commandNode(cmd) {
  if (cmd === SANS_COMMANDE) return el('div', 'failure-cmd is-missing', cmd);

  const ligne = el('div', 'failure-cmd', cmd);
  ligne.setAttribute('role', 'button');
  ligne.setAttribute('tabindex', '0');
  ligne.setAttribute('aria-expanded', 'false');
  const basculer = () => {
    ligne.classList.toggle('is-open');
    ligne.setAttribute('aria-expanded', String(ligne.classList.contains('is-open')));
  };
  ligne.addEventListener('click', basculer);
  ligne.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); // sinon l'espace defile le panneau sous les doigts
    basculer();
  });
  return ligne;
}

function episodeNode(alert) {
  const ep = el('div', alert.acknowledged ? 'failure-episode is-acked' : 'failure-episode');
  const faits = episodeLabel(alert);
  ep.appendChild(el('div', 'failure-head',
    `${stamp(alert.createdAt)}  ${projectLabel(alert.cwd)}${faits ? `  ·  ${faits}` : ''}`));
  for (const cmd of commandes(alert)) ep.appendChild(commandNode(cmd));
  return ep;
}

function remedeNode(remede) {
  const bloc = el('div', 'failure-remede');
  bloc.appendChild(el('div', 'remede-consigne', remede.consigne));
  bloc.appendChild(el('pre', 'remede-extrait', remede.extrait));
  const copier = el('button', 'obs-btn remede-copier', 'Copier');
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
    const btn = el('button', 'obs-btn obs-btn--primary failure-ack', `Tout acquitter (${group.unacked})`);
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
  // Le filtre se pose ICI, a l'affichage, et nulle part en amont : le journal
  // continue de consigner les stuck (la pastille vivante les lit par la meme
  // route), seul ce bloc refuse de les montrer — voir panelAlerts.
  const pannes = panelAlerts(alerts);
  const enAttente = pannes.some(a => !a.acknowledged);
  const title = el('div', 'failures-title');
  title.append(el('span', undefined, 'Pannes détectées'));
  title.appendChild(el('span', enAttente ? 'failures-count' : 'failures-count is-quiet',
    failuresSummary(pannes)));
  node.appendChild(title);
  if (pannes.length === 0) {
    node.appendChild(el('div', 'failures-empty',
      'Aucune panne sur la période. Ce bloc garde ce qui s’est produit même quand personne ne regardait.'));
    return;
  }
  for (const group of groupAlerts(pannes)) node.appendChild(groupNode(group, onAckGroup));
}
