// decisions-view.ts — la section « Décisions rendues » (le journal)
// et le contrôle « Non merci » d'une carte active.
//
// Rendering only, comme failures-view.ts : le classement décide ce qui est au
// journal (serveur), le magasin recharge après chaque geste. Deux rails de
// clic, volontairement distincts : « Réactiver » porte data-status et passe
// par la délégation existante de la page ; « Consigner » est câblé ICI, avec
// sa raison — il ne porte PAS de data-status, sinon la délégation partirait
// au serveur sans raison.

import { decisionLine } from './format.ts';

// Le sous-ensemble d'une recommandation decidee que ce fichier lit ; le reste
// (statut, raison, date, base de coût) est l'affaire de decisionLine, dans
// format.ts — costBasis n'est lu que par elle, transporté ici sans y toucher.
interface DecidedRecommendation {
  id: number;
  title: string;
  costBasis?: string;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label?: string): HTMLButtonElement {
  const btn = el('button', className, label) as HTMLButtonElement;
  btn.type = 'button';
  return btn;
}

// La section repliée, ajoutée au bout de la liste des conseils. Le compte
// reste lisible section fermée, jamais silencieux ; aucune
// section quand il n'y a rien — un tiroir vide se lirait comme une panne.
// Le journal mêle les trois décisions (adopté, en veille, refusé) : une seule
// destination pour « où est passée ma carte ? », et un Réactiver partout.
export function renderDecisions(node: HTMLElement, decided: DecidedRecommendation[]): void {
  if (decided.length === 0) return;
  const section = el('details', 'advisor-decisions');
  section.appendChild(el('summary', 'advisor-decisions-summary',
    `Décisions rendues (${decided.length})`));
  for (const rec of decided) {
    const card = el('div', 'advisor-card');
    card.dataset.recId = String(rec.id);
    const btn = button('obs-btn', 'Réactiver');
    btn.dataset.status = 'new';
    card.append(
      el('div', 'advisor-card-title', rec.title),
      el('div', 'advisor-card-decision', decisionLine(rec)),
      btn,
    );
    section.appendChild(card);
  }
  node.appendChild(section);
}

// « Non merci » déplie un champ raison + « Consigner » ; la raison est
// exigée non blanche ici même — le serveur la refuse de toute façon (400),
// autant ne jamais l'envoyer.
export function refusalControls(onRefuse: (value: string) => void): HTMLElement {
  const wrap = el('div', 'advisor-refuse');
  const toggle = button('obs-btn', 'Non merci');
  const form = el('div', 'advisor-refuse-form');
  const reason = el('input', 'advisor-refuse-reason') as HTMLInputElement;
  reason.type = 'text';
  reason.setAttribute('placeholder', 'Pourquoi ? (une ligne)');
  const submit = button('obs-btn', 'Consigner');

  toggle.addEventListener('click', () => wrap.classList.toggle('armed'));
  submit.addEventListener('click', () => {
    const value = reason.value.trim();
    if (value) onRefuse(value);
  });

  form.append(reason, submit);
  wrap.append(toggle, form);
  return wrap;
}
