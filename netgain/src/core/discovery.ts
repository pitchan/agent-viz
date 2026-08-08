import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface SubagentRef {
  agentId: string;
  jsonlPath: string;
  metaPath: string | null;
}

export interface SessionRef {
  sessionId: string;
  projectSlug: string;
  mainPath: string;
  subagents: SubagentRef[];
  mtime: Date;
  sizeBytes: number;
}

export interface DiscoveryFilters {
  project?: string;
  since?: Date;
  last?: number;
}

/**
 * Énumère les sessions sous <claudeDir>/projects/<slug>/<sessionId>.jsonl
 * et leurs sous-agents, à TOUTE profondeur sous <slug>/<sessionId>/subagents/ :
 * les agents de workflow vivent sous subagents/workflows/wf_<id>/ et étaient
 * invisibles à un balayage à plat — 3,4 % des jetons nets, sans erreur levée.
 * Lecture seule ; tout dossier illisible est ignoré sans throw.
 */
export async function discoverSessions(claudeDir: string, filters: DiscoveryFilters): Promise<SessionRef[]> {
  const projectsDir = path.join(claudeDir, 'projects');
  let slugs: string[];
  try {
    slugs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const sessions: SessionRef[] = [];
  for (const slug of slugs) {
    if (filters.project !== undefined && !slug.toLowerCase().includes(filters.project.toLowerCase())) continue;
    const projDir = path.join(projectsDir, slug);
    let entries;
    try {
      entries = await readdir(projDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const mainPath = path.join(projDir, entry.name);
      const sessionId = entry.name.slice(0, -'.jsonl'.length);
      let st;
      try {
        st = await stat(mainPath);
      } catch {
        continue;
      }
      if (filters.since !== undefined && st.mtime < filters.since) continue;
      sessions.push({
        sessionId,
        projectSlug: slug,
        mainPath,
        subagents: await discoverSubagents(path.join(projDir, sessionId, 'subagents')),
        mtime: st.mtime,
        sizeBytes: st.size,
      });
    }
  }

  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return filters.last !== undefined ? sessions.slice(0, filters.last) : sessions;
}

async function discoverSubagents(dir: string): Promise<SubagentRef[]> {
  // Descente volontairement agnostique de la mise en page : tout sous-dossier de subagents/
  // est descendu, pas seulement workflows/ — résiste au prochain changement de layout.
  // Marche en pile plutôt qu'un readdir({recursive:true}) unique : un readdir récursif
  // rejette la promesse entière au premier dossier illisible (EPERM/ENOENT en session live),
  // et la session perdrait TOUS ses sous-agents, pas seulement ceux du dossier fautif.
  const files: { parentPath: string; name: string }[] = [];
  const queue = [dir];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue; // dossier illisible : on perd CE dossier, pas les autres
    }
    for (const e of entries) {
      // isDirectory() (et non isSymbolicLink()) : un lien/jonction ne redescend pas,
      // même comportement de non-suivi des symlinks qu'offrait { recursive: true }.
      if (e.isDirectory()) queue.push(path.join(cur, e.name));
      else if (e.isFile()) files.push({ parentPath: cur, name: e.name });
    }
  }
  // Clé sur le CHEMIN complet, pas sur le nom : deux dossiers de workflow peuvent porter
  // le même nom de meta, et le nom seul les confondrait.
  const metaPaths = new Set(
    files.filter((f) => f.name.endsWith('.meta.json')).map((f) => path.join(f.parentPath, f.name)),
  );
  const refs: SubagentRef[] = [];
  for (const f of files) {
    if (!f.name.startsWith('agent-') || !f.name.endsWith('.jsonl')) continue;
    const agentId = f.name.slice('agent-'.length, -'.jsonl'.length);
    const metaPath = path.join(f.parentPath, `agent-${agentId}.meta.json`);
    refs.push({
      agentId,
      jsonlPath: path.join(f.parentPath, f.name),
      metaPath: metaPaths.has(metaPath) ? metaPath : null,
    });
  }
  // L'ordre d'une marche en pile dépend de l'ordre des sous-dossiers, pas garanti d'une
  // plateforme à l'autre : sans ce tri, les rapports et les tests deviennent dépendants
  // du système de fichiers.
  refs.sort((a, b) => (a.jsonlPath < b.jsonlPath ? -1 : a.jsonlPath > b.jsonlPath ? 1 : 0));
  return refs;
}

/** Interprète --since : date ISO ou forme relative « <N>d ». */
export function parseSince(raw: string, now: Date): Date {
  const rel = /^(\d+)d$/.exec(raw);
  if (rel !== null) return new Date(now.getTime() - Number(rel[1]) * 24 * 3600 * 1000);
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw new Error(`--since attend une date ISO ou « <N>d », reçu « ${raw} »`);
  return new Date(t);
}
