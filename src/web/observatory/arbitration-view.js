// arbitration-view.js — la section « Arbitrages rendus » et les contrôles
// d'arbitrage d'une carte active (doc/42).
//
// Rendering only, comme failures-view.js : le classement décide ce qui est
// arbitré (serveur), le magasin recharge après chaque geste. Deux rails de
// clic, volontairement distincts : « Réactiver » porte data-status et passe
// par la délégation existante de la page ; « Consigner » est câblé ICI, avec
// sa raison — il ne porte PAS de data-status, sinon la délégation partirait
// au serveur sans raison.

import { arbitratedLine } from './format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, label) {
  const btn = el('button', className, label);
  btn.type = 'button';
  return btn;
}

// La section repliée, ajoutée au bout de la liste des conseils. Le compte
// reste lisible section fermée (décision : jamais silencieux) ; aucune
// section quand il n'y a rien — un tiroir vide se lirait comme une panne.
export function renderArbitrated(node, arbitrated) {
  if (arbitrated.length === 0) return;
  const section = el('details', 'advisor-arbitrated');
  section.appendChild(el('summary', 'advisor-arbitrated-summary',
    `Arbitrages rendus (${arbitrated.length})`));
  for (const rec of arbitrated) {
    const card = el('div', 'advisor-card');
    card.dataset.recId = String(rec.id);
    const btn = button('obs-btn', 'Réactiver');
    btn.dataset.status = 'new';
    card.append(
      el('div', 'advisor-card-title', rec.title),
      el('div', 'advisor-card-arbitrated', arbitratedLine(rec)),
      btn,
    );
    section.appendChild(card);
  }
  node.appendChild(section);
}

// « Déjà arbitré » déplie un champ raison + « Consigner » ; la raison est
// exigée non blanche ici même — le serveur la refuse de toute façon (400),
// autant ne jamais l'envoyer.
export function arbitrationControls(onArbitrate) {
  const wrap = el('div', 'advisor-arbitrate');
  const toggle = button('obs-btn', 'Déjà arbitré');
  const form = el('div', 'advisor-arbitrate-form');
  const reason = el('input', 'advisor-arbitrate-reason');
  reason.type = 'text';
  reason.setAttribute('placeholder', 'Raison de l’arbitrage (une ligne)');
  const submit = button('obs-btn', 'Consigner');

  toggle.addEventListener('click', () => wrap.classList.toggle('armed'));
  submit.addEventListener('click', () => {
    const value = reason.value.trim();
    if (value) onArbitrate(value);
  });

  form.append(reason, submit);
  wrap.append(toggle, form);
  return wrap;
}
