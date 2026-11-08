// overview-format.ts — le haut de la page Conseils : la phrase-bilan, les
// comptes des compteurs-onglets, l'onglet ouvert par defaut. Module pur.

import { returnBanner, type Recommendation } from './format.ts';
import { gravity } from './failures-tools.ts';

export type Tab = 'pannes' | 'conseils';

export interface BilanInput {
  // null : les pannes n'ont pas pu etre chargees — la phrase n'en dit rien.
  pannes: { toTreat: number; top: { name: string; tool: string; count: number } | null } | null;
  conseils: number;
  revenus: number;
}

const NOTHING = 'Aucune recommandation sur la période — rien à corriger.';

function pannesSentence(p: NonNullable<BilanInput['pannes']>) {
  if (p.toTreat === 0) return 'Aucune panne à traiter sur la période.';
  // Une panne « revient souvent » quand son chiffre est rouge.
  if (p.top && gravity(p.top.count) === 'high') {
    return `Une panne revient souvent : ${p.top.name} — ${p.top.tool} (${p.top.count} fois).`;
  }
  return `${p.toTreat} panne${p.toTreat > 1 ? 's' : ''} à traiter, aucune ne revient souvent.`;
}

export function bilanSentence({ pannes, conseils, revenus }: BilanInput) {
  if ((pannes === null || pannes.toTreat === 0) && conseils === 0 && revenus === 0) {
    return pannes === null ? '' : NOTHING;
  }
  const parts: string[] = [];
  if (pannes) parts.push(pannesSentence(pannes));
  if (conseils > 0) {
    parts.push(conseils > 1 ? `${conseils} conseils attendent ta réponse.` : '1 conseil attend ta réponse.');
  }
  if (revenus > 0) {
    parts.push(`${revenus} conseil${revenus > 1 ? 's revenus' : ' revenu'} : le problème a regrossi.`);
  }
  return parts.join(' ');
}

export function defaultTab(pannesToTreat: number): Tab {
  return pannesToTreat > 0 ? 'pannes' : 'conseils';
}

export function appearancesLabel(n: number) {
  if (n === 0) return '';
  return n > 1 ? `apparues ${n} fois` : 'apparue 1 fois';
}

// Les cartes qui attendent une reponse, tous blocs confondus : un compte de
// cartes, jamais une somme de couts (les blocs ne se comparent pas, R2). Une
// carte revenue compte la ou elle est rangee : c'est son bandeau qui la dit revenue.
export function conseilsCounts(groups: { all: Recommendation[] }[], stale: Recommendation[]) {
  const all = groups.flatMap(g => g.all);
  return { toTreat: all.length, returned: [...all, ...stale].filter(r => returnBanner(r) !== '').length };
}
