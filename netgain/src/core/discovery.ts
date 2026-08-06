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
 * et leurs sous-agents <slug>/<sessionId>/subagents/agent-*.jsonl.
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
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const metaNames = new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.meta.json')).map((e) => e.name));
  const refs: SubagentRef[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith('agent-') || !e.name.endsWith('.jsonl')) continue;
    const agentId = e.name.slice('agent-'.length, -'.jsonl'.length);
    const metaName = `agent-${agentId}.meta.json`;
    refs.push({
      agentId,
      jsonlPath: path.join(dir, e.name),
      metaPath: metaNames.has(metaName) ? path.join(dir, metaName) : null,
    });
  }
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
