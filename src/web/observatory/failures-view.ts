// failures-view.ts — l'onglet « Pannes » : les plus frequentes, puis un accordeon
// par outil et par cause. Rendu et gestes locaux seulement : l'acquittement sort
// d'ici comme une intention (`onAckGroup`), advisor-view l'envoie au serveur.

import { causeLabel, episodeLabel, projectLabel, type AlertGroup } from './failures-format.ts';
import { layoutPannes, causeName, causeTool, toolDisplayName, gravity, type PannesLayout } from './failures-tools.ts';
import { remedyFor, type Remedy } from './remedies.ts';
import type { Alert } from '../../engine/watchdog/detector.ts';

function el(tag: string, className?: string | null, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Date et heure : une panne d'il y a trois jours et une d'il y a trois minutes
// se lisent dans la meme liste, une heure seule les confondrait.
function stamp(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SANS_COMMANDE = 'commande non consignée (alerte ancienne)';

// La commande d'un episode. Vide chez badInvocation = une alerte consignee sans
// `subject` : le dire vaut mieux qu'un trou, qui se lirait comme un bug du bloc.
function commandes(alert: Alert): string[] {
  if (alert.type === 'stuck') {
    return alert.tools
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
function commandNode(cmd: string) {
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

function episodeNode(alert: Alert) {
  const ep = el('div', alert.acknowledged ? 'failure-episode is-acked' : 'failure-episode');
  const faits = episodeLabel(alert);
  ep.appendChild(el('div', 'failure-head',
    `${stamp(alert.createdAt)}  ${projectLabel(alert.cwd)}${faits ? `  ·  ${faits}` : ''}`));
  for (const cmd of commandes(alert)) ep.appendChild(commandNode(cmd));
  return ep;
}

function remedeNode(remede: NonNullable<Remedy>) {
  const bloc = el('div', 'failure-remede');
  bloc.appendChild(el('div', 'remede-consigne', remede.consigne));
  bloc.appendChild(el('pre', 'remede-extrait', remede.extrait));
  const copier = el('button', 'obs-btn remede-copier', 'Copier') as HTMLButtonElement;
  copier.type = 'button';
  const zone = el('span', 'remede-copie', '');
  zone.setAttribute('aria-live', 'polite');
  copier.addEventListener('click', () => {
    // Le typage DOM declare `writeText` toujours present ; en pratique absent
    // hors contexte securise ou navigateur ancien, d'ou la garde — que tsc
    // juge donc a tort toujours vraie.
    // @ts-expect-error TS2774
    const ecrire = globalThis.navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(remede.extrait)
      : Promise.reject(new Error('presse-papier indisponible'));
    ecrire.then(() => { zone.textContent = 'copié'; })
      .catch(() => { zone.textContent = 'copie impossible — sélectionnez le texte ci-dessus'; });
  });
  bloc.append(copier, zone);
  return bloc;
}

// Le chiffre de gravite : combien de fois la panne est apparue sur la periode.
function sevNode(n: number, level = gravity(n)) {
  return el('span', `failure-sev sev-${level}`, `${n}×`);
}

const dayMonth = (ms: number) => stamp(ms).slice(0, 5);

// `withTool` : dans « Vues une seule fois », aucun groupe d'outil ne nomme l'outil.
function groupNode(group: AlertGroup, onAckGroup: AckGroup | undefined, withTool = false) {
  const det = el('details', group.unacked ? 'failure-group' : 'failure-group is-acked');
  const resume = el('summary', 'failure-group-head');
  const noms = el('span', 'failure-names');
  noms.append(el('span', 'failure-cause', causeName(group)), el('span', 'failure-cause-tech', causeLabel(group)));
  const outil = withTool ? `${toolDisplayName(causeTool(group))} · ` : '';
  resume.append(sevNode(group.episodes.length), noms,
    el('span', 'failure-group-meta', `${outil}dernière ${stamp(group.lastAt)}`));
  det.appendChild(resume);

  for (const alert of group.episodes) det.appendChild(episodeNode(alert));

  // Meme invariant qu'a la construction du groupe : au moins un episode.
  const remede = remedyFor(group.episodes[0]!);
  if (remede) det.appendChild(remedeNode(remede));

  if (group.unacked && onAckGroup) {
    const btn = el('button', 'obs-btn obs-btn--primary failure-ack', `Tout acquitter (${group.unacked})`) as HTMLButtonElement;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      onAckGroup(group.episodes);
    });
    det.appendChild(btn);
  }
  return det;
}

type AckGroup = (episodes: Alert[]) => void;

export interface RenderFailuresOptions {
  // Les lignes du journal écartées à l'entrée parce qu'hors forme : elles ne
  // sont dans aucun compte du bloc, et le bloc dit combien il en a laissé.
  rejetees?: number;
  onAckGroup?: AckGroup;
}

// Le bouton vit dans l'en-tete repliable : sans preventDefault, le clic
// replierait aussi le groupe.
function toolAckNode(causes: AlertGroup[], onAckGroup: AckGroup) {
  const unacked = causes.reduce((n, g) => n + g.unacked, 0);
  const btn = el('button', 'obs-btn failure-tool-ack', `Tout acquitter (${unacked})`) as HTMLButtonElement;
  btn.type = 'button';
  btn.addEventListener('click', e => {
    e.preventDefault();
    btn.disabled = true;
    onAckGroup(causes.flatMap(g => g.episodes));
  });
  return btn;
}

interface ToolBlock { label: string; meta: string; sev: HTMLElement; causes: AlertGroup[]; withTool: boolean }

function toolNode(block: ToolBlock, causeNodes: Map<AlertGroup, HTMLElement>, onAckGroup: AckGroup | undefined) {
  const det = el('details', block.withTool ? 'failure-tool is-once' : 'failure-tool');
  const resume = el('summary', 'failure-tool-head');
  const noms = el('span', 'failure-names');
  noms.append(el('span', 'failure-tool-name', block.label), el('span', 'failure-tool-meta', block.meta));
  resume.append(block.sev, noms);
  if (onAckGroup) resume.appendChild(toolAckNode(block.causes, onAckGroup));
  det.appendChild(resume);
  for (const g of block.causes) {
    const cause = groupNode(g, onAckGroup, block.withTool);
    causeNodes.set(g, cause);
    det.appendChild(cause);
  }
  return det;
}

const plural = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function toolBlocks({ tools, once }: PannesLayout): ToolBlock[] {
  const blocks = tools.map(t => ({
    label: t.label,
    meta: `${t.causes.length > 1 ? `${t.causes.length} sortes de pannes` : '1 sorte de panne'}`
      + ` · dernière le ${dayMonth(t.lastAt)}`,
    sev: sevNode(t.total),
    causes: t.causes,
    withTool: false,
  }));
  if (once.length) {
    blocks.push({
      label: 'Vues une seule fois',
      meta: `${plural(once.length, 'outil')} : ${once.map(g => toolDisplayName(causeTool(g))).join(', ')}`,
      // Chacune n'est apparue qu'une fois : le total n'en fait pas une panne grave.
      sev: sevNode(once.length, 'low'),
      causes: once,
      withTool: true,
    });
  }
  return blocks;
}

// Un clic sur une panne frequente l'ouvre a sa place dans la liste par outil.
function topNode(group: AlertGroup, target: () => { tool: HTMLElement; cause: HTMLElement }) {
  const card = el('div', 'failure-top');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  const texte = el('div', 'failure-names');
  texte.append(
    el('div', 'failure-top-name', causeName(group)),
    el('div', 'failure-top-meta', `${toolDisplayName(causeTool(group))} · dernière le ${dayMonth(group.lastAt)}`),
  );
  card.append(sevNode(group.episodes.length), texte);
  const ouvrir = () => {
    const { tool, cause } = target();
    (tool as HTMLDetailsElement).open = true;
    (cause as HTMLDetailsElement).open = true;
    cause.scrollIntoView({ block: 'nearest' });
  };
  card.addEventListener('click', ouvrir);
  card.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    ouvrir();
  });
  return card;
}

function ackedNode(acked: AlertGroup[]) {
  const det = el('details', 'failure-acked');
  det.appendChild(el('summary', 'failure-acked-head', `Déjà acquittées (${acked.length})`));
  for (const g of acked) det.appendChild(groupNode(g, undefined));
  return det;
}

export function renderFailures(node: HTMLElement, alerts: Alert[], { rejetees = 0, onAckGroup }: RenderFailuresOptions = {}) {
  node.textContent = '';
  if (rejetees > 0) {
    const s = rejetees > 1 ? 's' : '';
    node.appendChild(el('div', 'failures-illisibles',
      `${rejetees} ligne${s} du journal illisible${s}, non comptée${s}`));
  }
  // Le filtre des stuck se pose a l'affichage (layoutPannes -> panelAlerts) :
  // le journal continue de les consigner pour la pastille vivante.
  const layout = layoutPannes(alerts);
  if (layout.toTreatCount === 0 && layout.acked.length === 0) {
    node.appendChild(el('div', 'failures-empty',
      'Aucune panne sur la période. Ce bloc garde ce qui s’est produit même quand personne ne regardait.'));
    return;
  }

  const causeNodes = new Map<AlertGroup, HTMLElement>();
  const toolOf = new Map<AlertGroup, HTMLElement>();
  const outils = toolBlocks(layout).map(block => {
    const tool = toolNode(block, causeNodes, onAckGroup);
    for (const g of block.causes) toolOf.set(g, tool);
    return tool;
  });

  if (layout.top.length) {
    node.appendChild(el('div', 'failures-section-title', 'Les plus fréquentes'));
    const tops = el('div', 'failures-top');
    for (const g of layout.top) tops.appendChild(topNode(g, () => ({ tool: toolOf.get(g)!, cause: causeNodes.get(g)! })));
    node.appendChild(tops);
    node.appendChild(el('div', 'failures-section-title', 'Toutes les pannes, par outil'));
  }
  for (const tool of outils) node.appendChild(tool);
  if (layout.acked.length) node.appendChild(ackedNode(layout.acked));
}
