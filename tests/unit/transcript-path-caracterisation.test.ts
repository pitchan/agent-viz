// Où getTranscriptPath trouve le transcript de la session : sur la première ligne seule, par
// l'adaptateur de son _source. Seul un événement de sous-agent Codex en tête renvoie à la ligne
// suivante, car il porte le transcript d'un sous-agent : ces cas sont préfixés « [sous-agent codex] ».

import { expect, test, vi } from 'vitest';
import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';

import { getTranscriptPath } from '../../src/server/transcript.ts';

const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890';
const PREFIXE = SESSION.slice(0, 8);
const PRINCIPAL = 'C:/transcripts/rollout-principal.jsonl';
const SOUS_AGENT = 'C:/transcripts/rollout-sous-agent.jsonl';
const AUTRE = 'C:/transcripts/rollout-autre.jsonl';
const AGENT = 'agent-0001';

// `lit` : l'adaptateur rend `transcript_path` quand c'est une chaîne (claude, codex, antigravity ;
// source absente ou null → claude). copilot et une source inconnue rendent toujours null.
interface Source { nom: string; champ: (cas: string) => Record<string, unknown>; lit: boolean; inconnue: boolean }

const SOURCES: Source[] = [
  { nom: 'claude', champ: () => ({ _source: 'claude' }), lit: true, inconnue: false },
  { nom: 'codex', champ: () => ({ _source: 'codex' }), lit: true, inconnue: false },
  { nom: 'antigravity', champ: () => ({ _source: 'antigravity' }), lit: true, inconnue: false },
  { nom: 'copilot', champ: () => ({ _source: 'copilot' }), lit: false, inconnue: false },
  { nom: 'source absente', champ: () => ({}), lit: true, inconnue: false },
  { nom: 'source null', champ: () => ({ _source: null }), lit: true, inconnue: false },
  // getAdapter ne trace une source inconnue qu'une fois par nom : un nom neuf par cas.
  { nom: 'source inconnue', champ: cas => ({ _source: `inconnue-${cas}` }), lit: false, inconnue: true },
];

type Champs = Record<string, unknown>;

function evt(champs: Champs, nom: string, transcript?: string, agentId?: string | null): string {
  const e: Record<string, unknown> = { ...champs, hook_event_name: nom, session_id: SESSION };
  if (agentId !== undefined) e.agent_id = agentId;
  if (transcript !== undefined) e.transcript_path = transcript;
  return JSON.stringify(e);
}

const principal = (c: Champs) => evt(c, 'UserPromptSubmit', PRINCIPAL);
const lignes = (...l: string[]) => l.map(x => x + '\n').join('');

// Trace de master pour une première ligne vide/blanche, ou illisible.
const TRACE_VIDE = `[transcript] ${PREFIXE}: empty session file — cannot extract transcript_path`;
const traceIllisible = (n: number) =>
  `[transcript] ${PREFIXE}: unreadable first line (${n} chars) — cannot extract transcript_path`;
const traceInconnue = (nom: unknown) =>
  `[transcript-adapters] unknown agentSource "${String(nom)}" — its transcript is not read. Add an adapter under src/server/transcript-adapters/.`;

const ILLISIBLE = '{pas du json';

interface Forme {
  nom: string;
  contenu: (c: Champs) => string | null;   // null : pas de fichier
  // Le transcript rendu quand l'adaptateur lit (claude, codex, antigravity, absente, null).
  rendu: string | null;
  // La première ligne est décodée en JSON : l'adaptateur est alors choisi, et une source inconnue tracée.
  decodee: boolean;
  trace: unknown[];
  // Le transcript rendu pour codex quand il diffère : un événement de sous-agent n'en donne aucun.
  codex?: string | null;
}

const GROS = 'x'.repeat(3 * 1024 * 1024);
const TRES_GROS = 'x'.repeat(9 * 1024 * 1024);

const FORMES: Forme[] = [
  { nom: 'première ligne du fil principal', contenu: c => lignes(principal(c), principal(c)),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'PreToolUse de sous-agent en tête puis événement principal',
    contenu: c => lignes(evt(c, 'PreToolUse', SOUS_AGENT, AGENT), principal(c)),
    rendu: SOUS_AGENT, decodee: true, trace: [], codex: PRINCIPAL },
  { nom: 'SubagentStart en tête puis événement principal',
    contenu: c => lignes(evt(c, 'SubagentStart', SOUS_AGENT, AGENT), principal(c)),
    rendu: SOUS_AGENT, decodee: true, trace: [], codex: PRINCIPAL },
  // Notre hook écrit la fin d'un sous-agent avec le transcript de l'événement qui l'a déclenchée,
  // qui peut être celui d'un autre sous-agent.
  { nom: 'SubagentStop seul en tête (porte le transcript du parent)',
    contenu: c => lignes(evt(c, 'SubagentStop', PRINCIPAL, AGENT)),
    rendu: PRINCIPAL, decodee: true, trace: [], codex: null },
  { nom: 'SubagentStop en tête puis événement principal',
    contenu: c => lignes(evt(c, 'SubagentStop', PRINCIPAL, AGENT), principal(c)),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'événements de sous-agent uniquement',
    contenu: c => lignes(evt(c, 'PreToolUse', SOUS_AGENT, AGENT), evt(c, 'PostToolUse', SOUS_AGENT, AGENT)),
    rendu: SOUS_AGENT, decodee: true, trace: [], codex: null },
  { nom: 'ligne vide en tête', contenu: c => '\n' + lignes(principal(c)),
    rendu: null, decodee: false, trace: [TRACE_VIDE] },
  { nom: 'ligne blanche en tête', contenu: c => '  \t \n' + lignes(principal(c)),
    rendu: null, decodee: false, trace: [TRACE_VIDE] },
  { nom: 'ligne illisible en tête', contenu: c => lignes(ILLISIBLE, principal(c)),
    rendu: null, decodee: false, trace: [traceIllisible(ILLISIBLE.length)] },
  { nom: 'ligne illisible plus loin', contenu: c => lignes(principal(c), ILLISIBLE),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'fichier vide', contenu: () => '', rendu: null, decodee: false, trace: [TRACE_VIDE] },
  { nom: 'BOM en tête', contenu: c => '\uFEFF' + lignes(principal(c)),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'fin de ligne CRLF', contenu: c => principal(c) + '\r\n' + principal(c) + '\r\n',
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'première ligne sans transcript_path puis ligne avec',
    contenu: c => lignes(evt(c, 'SessionStart'), principal(c)),
    rendu: null, decodee: true, trace: [] },
  { nom: 'agent_id null en tête', contenu: c => lignes(evt(c, 'PreToolUse', PRINCIPAL, null), evt(c, 'UserPromptSubmit', AUTRE)),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'agent_id chaîne vide en tête', contenu: c => lignes(evt(c, 'PreToolUse', PRINCIPAL, ''), evt(c, 'UserPromptSubmit', AUTRE)),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'événement de sous-agent sans transcript_path en tête puis principal',
    contenu: c => lignes(evt(c, 'PreToolUse', undefined, AGENT), principal(c)),
    rendu: null, decodee: true, trace: [] },
  { nom: 'première ligne de 3 Mio, lue en entier',
    contenu: c => lignes(JSON.stringify({ ...c, hook_event_name: 'UserPromptSubmit', prompt: GROS, transcript_path: PRINCIPAL }), principal(c)),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  { nom: 'première ligne de 9 Mio, coupée à la limite de 8 Mio',
    contenu: c => lignes(JSON.stringify({ ...c, hook_event_name: 'UserPromptSubmit', prompt: TRES_GROS, transcript_path: PRINCIPAL }), principal(c)),
    rendu: null, decodee: false, trace: [expect.stringMatching(/^\[transcript\] \w+: unreadable first line \(\d+ chars\)/)] },
  { nom: 'fichier sans saut de ligne final', contenu: c => principal(c),
    rendu: PRINCIPAL, decodee: true, trace: [] },
  // JSON valide mais pas un objet : aucun _source lisible → adaptateur claude, qui rend null.
  { nom: 'première ligne JSON non objet', contenu: c => lignes('42', principal(c)),
    rendu: null, decodee: false, trace: [] },
  { nom: 'fichier absent', contenu: () => null, rendu: null, decodee: false,
    trace: [`[transcript] ${PREFIXE}: getTranscriptPath failed — ENOENT`] },
];

async function lancer(forme: Forme, source: Source, cas: string) {
  const champs = source.champ(cas);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-carac-'));
  const fichier = path.join(dir, `${SESSION}.jsonl`);
  try {
    const contenu = forme.contenu(champs);
    if (contenu !== null) await fsp.writeFile(fichier, contenu);
    const espion = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rendu = await getTranscriptPath(fichier);
    const traces = espion.mock.calls.map(appel => appel.map(String).join(' '));
    return { rendu, traces, champs };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

for (const [numero, forme] of FORMES.entries()) {
  for (const source of SOURCES) {
    const propreACodex = source.nom === 'codex' && forme.codex !== undefined;
    const nom = `${propreACodex ? '[sous-agent codex] ' : ''}${source.nom} — ${forme.nom}`;
    test(nom, async () => {
      // Arrange
      const attendu = propreACodex ? forme.codex : (source.lit ? forme.rendu : null);
      // Act
      const { rendu, traces, champs } = await lancer(forme, source, String(numero));
      // Assert
      expect(rendu).toBe(attendu);
      const tracesAttendues = [...forme.trace];
      if (forme.decodee && source.inconnue) tracesAttendues.push(traceInconnue(champs._source));
      if (forme.nom === 'fichier absent') {
        expect(traces).toHaveLength(1);
        expect(traces[0]?.startsWith(String(tracesAttendues[0]))).toBe(true);
      } else {
        expect(traces).toEqual(tracesAttendues);
      }
    });
  }
}
