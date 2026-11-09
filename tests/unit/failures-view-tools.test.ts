// L'onglet Pannes : les plus frequentes en tete, puis les pannes rangees par
// outil, chacune avec son chiffre de gravite et son nom lisible.
import { expect, test } from 'vitest';
import { fauxElement, parClasse, texte, installFauxDocument } from '../helpers/faux-dom.ts';
import { renderFailures } from '../../src/web/observatory/failures-view.ts';
import type { Alert } from '../../src/engine/watchdog/detector.ts';

installFauxDocument();

const JOUR = 86_400_000;
const T0 = new Date(2026, 9, 19, 21, 48).getTime();

const alerte = (sur: Record<string, any> = {}): Alert => ({
  id: 'x', type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt: T0,
  message: '', agentId: '', agentType: '', subject: 'git status', occurrences: [], tools: [],
  cwd: 'F:\\DEV\\agent-viz', standing: false, patternId: '', acknowledged: false, ...sur,
} as Alert);

const episodes = (n: number, dernier: number, sur: Record<string, any> = {}) =>
  Array.from({ length: n }, (_, i) => alerte({
    id: `${sur.type ?? 'loop'}-${sur.toolName ?? 'Bash'}-${i}`, createdAt: dernier - i * 1000, ...sur,
  }));

const reel = () => [
  ...episodes(6, T0, { type: 'loop', toolName: 'Bash' }),
  ...episodes(3, T0 - 10 * JOUR, { type: 'retryStorm', toolName: 'Bash' }),
  ...episodes(2, T0 - 13 * JOUR, { type: 'retryStorm', toolName: 'WebFetch' }),
  ...episodes(1, T0 - 1, { type: 'loop', toolName: 'mcp__ccd_turn__wrap_up' }),
  ...episodes(1, T0 - 13 * JOUR, { type: 'loop', toolName: 'Edit' }),
  ...episodes(2, T0 - 20 * JOUR, { type: 'loop', toolName: 'Grep', acknowledged: true }),
];

test('les plus frequentes montrent leur chiffre, leur nom lisible, leur outil et leur date', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderFailures(node, reel());
  // Assert
  const tops = parClasse(node, 'failure-top');
  expect(tops.map(t => texte(parClasse(t, 'failure-sev')[0]))).toEqual(['6×', '3×', '2×']);
  expect(texte(parClasse(tops[0], 'failure-top-name')[0])).toBe('Même appel répété à l’identique');
  expect(texte(parClasse(tops[0], 'failure-top-meta')[0])).toBe('Shell (Bash) · dernière le 19/10');
  expect(parClasse(tops[0], 'failure-sev')[0].classList.contains('sev-high')).toBe(true);
});

test('un groupe par outil, le plus apparu d abord, avec ses sortes de pannes et sa derniere date', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderFailures(node, reel());
  // Assert
  const outils = parClasse(node, 'failure-tool').filter(t => !t.classList.contains('is-once'));
  expect(outils.map(t => texte(parClasse(t, 'failure-tool-name')[0]))).toEqual(['Shell (Bash)', 'Lecture de page web']);
  expect(texte(parClasse(outils[0], 'failure-sev')[0])).toBe('9×');
  expect(texte(parClasse(outils[0], 'failure-tool-meta')[0])).toBe('2 sortes de pannes · dernière le 19/10');
  expect(outils[0].tagName, 'accordeon natif').toBe('DETAILS');
});

test('une panne porte son nom lisible, son nom technique en petit et son chiffre, sans badge « à traiter »', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderFailures(node, reel());
  // Assert
  const [bash] = parClasse(node, 'failure-tool');
  const [boucle] = parClasse(bash, 'failure-group');
  expect(texte(parClasse(boucle, 'failure-cause')[0])).toBe('Même appel répété à l’identique');
  expect(texte(parClasse(boucle, 'failure-cause-tech')[0])).toBe('Bash · même commande répétée');
  expect(texte(parClasse(boucle, 'failure-sev')[0])).toBe('6×');
  expect(parClasse(node, 'failure-a-traiter').length).toBe(0);
});

test('les outils vus une seule fois sont reunis, chaque panne y nomme son outil', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderFailures(node, reel());
  // Assert
  const [once] = parClasse(node, 'is-once');
  expect(texte(parClasse(once, 'failure-tool-name')[0])).toBe('Vues une seule fois');
  expect(texte(parClasse(once, 'failure-tool-meta')[0])).toBe('2 outils : wrap_up (serveur ccd_turn), Modification de fichier');
  expect(parClasse(once, 'failure-group-meta').map(texte)[0]).toMatch(/^wrap_up \(serveur ccd_turn\) · dernière /);
});

test('les pannes deja acquittees sont mises a part, repliees, avec leur compte', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderFailures(node, reel());
  // Assert
  const [acquittees] = parClasse(node, 'failure-acked');
  expect(acquittees.open).toBe(false);
  expect(texte(parClasse(acquittees, 'failure-acked-head')[0])).toBe('Déjà acquittées (1)');
  expect(parClasse(acquittees, 'failure-group').length).toBe(1);
});

test('« Tout acquitter » d un outil emet les episodes de toutes ses pannes', () => {
  // Arrange
  const node = fauxElement('div');
  const recus: Alert[][] = [];
  renderFailures(node, reel(), { onAckGroup: eps => { recus.push(eps); } });
  const [bouton] = parClasse(parClasse(node, 'failure-tool')[0], 'failure-tool-ack');
  // Act
  bouton.click();
  // Assert
  expect(texte(bouton)).toBe('Tout acquitter (9)');
  expect(recus[0]!.length).toBe(9);
  expect(bouton.disabled).toBe(true);
});

test('un clic sur une panne frequente ouvre son outil et la panne dans la liste', () => {
  // Arrange
  const node = fauxElement('div');
  renderFailures(node, reel());
  const [premiere] = parClasse(node, 'failure-top');
  // Act
  premiere.click();
  // Assert
  const [bash] = parClasse(node, 'failure-tool');
  const [boucle] = parClasse(bash, 'failure-group');
  expect([bash.open, boucle.open, boucle.scrolled]).toEqual([true, true, true]);
});

test('sans aucune panne a traiter, la section des plus frequentes n apparait pas', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderFailures(node, episodes(2, T0, { acknowledged: true }));
  // Assert
  expect(parClasse(node, 'failure-top').length).toBe(0);
  expect(parClasse(node, 'failures-section-title').length).toBe(0);
  expect(parClasse(node, 'failure-acked').length).toBe(1);
});

test('le chiffre de « Vues une seule fois » reste gris, meme quand la somme atteint le rouge', () => {
  // Arrange
  const outils = ['Read', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Grep'];
  const node = fauxElement('div');
  // Act
  renderFailures(node, outils.map(toolName => alerte({ id: toolName, toolName })));
  // Assert
  const [once] = parClasse(node, 'is-once');
  const [chiffre] = parClasse(once, 'failure-sev');
  expect(texte(chiffre)).toBe('6×');
  expect(chiffre.classList.contains('sev-low')).toBe(true);
});
