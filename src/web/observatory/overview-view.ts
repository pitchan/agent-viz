// overview-view.ts — le haut de la page Conseils : la phrase-bilan et les trois
// compteurs, qui servent d'onglets. Rendu seulement : les comptes viennent de
// failures-tools.ts et overview-format.ts, le choix d'onglet sort comme une intention.

import { causeName, causeTool, toolDisplayName, type PannesLayout } from './failures-tools.ts';
import { bilanSentence, appearancesLabel, type Tab } from './overview-format.ts';

export interface OverviewData {
  // null : les pannes n'ont pas pu etre chargees.
  layout: PannesLayout | null;
  conseils: { toTreat: number; returned: number };
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pannesBilan(layout: PannesLayout | null) {
  if (!layout) return null;
  const top = layout.top[0];
  return {
    toTreat: layout.toTreatCount,
    top: top ? { name: causeName(top), tool: toolDisplayName(causeTool(top)), count: top.episodes.length } : null,
  };
}

interface Counter { tab: Tab; n: string; label: string; activeFor: Tab | null }

function counters({ layout, conseils }: OverviewData): Counter[] {
  const sub = layout ? appearancesLabel(layout.appearances) : '';
  return [
    layout
      ? { tab: 'pannes', n: String(layout.toTreatCount), label: `pannes à traiter${sub ? ` · ${sub}` : ''}`, activeFor: 'pannes' }
      : { tab: 'pannes', n: '—', label: 'pannes indisponibles', activeFor: 'pannes' },
    { tab: 'conseils', n: String(conseils.toTreat), label: 'conseils à traiter', activeFor: 'conseils' },
    // Les cartes revenues vivent dans l'onglet Conseils : ce compteur y mene,
    // sans etre un onglet a lui seul.
    { tab: 'conseils', n: String(conseils.returned), label: 'conseils revenus', activeFor: null },
  ];
}

export function renderOverview(bilanNode: HTMLElement, tabsNode: HTMLElement, data: OverviewData,
  active: Tab, onSelect: (tab: Tab) => void) {
  bilanNode.textContent = bilanSentence({
    pannes: pannesBilan(data.layout),
    conseils: data.conseils.toTreat,
    revenus: data.conseils.returned,
  });

  tabsNode.textContent = '';
  for (const c of counters(data)) {
    const isActive = c.activeFor === active;
    const btn = el('button', `advisor-counter is-${c.tab}${c.activeFor ? '' : ' is-returned'}${isActive ? ' is-active' : ''}`);
    (btn as HTMLButtonElement).type = 'button';
    if (c.activeFor) {
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(isActive));
    }
    btn.append(el('span', 'advisor-counter-n', c.n), el('span', 'advisor-counter-label', c.label));
    btn.addEventListener('click', () => onSelect(c.tab));
    tabsNode.appendChild(btn);
  }
}
