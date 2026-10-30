// Codex range chaque fil dans <racine>/AAAA/MM/JJ/rollout-<heure>-<fil>.jsonl, au jour local de
// sa création. Le transcript d'un sous-agent se cherche donc sous la racine de son lanceur.

import fs from 'node:fs';
import path from 'node:path';

// Le fil est créé quelques dizaines de millisecondes avant que son lancement soit écrit : autour
// de minuit, son dossier est celui de la veille.
const CREATION_MARGIN_MS = 60_000;

function localDay(ms: number): string {
  const d = new Date(ms);
  return path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
}

/** Le transcript du fil `threadId`, lancé à `startedAt` ; `null` quand il n'est pas sur le disque. */
export function codexChildTranscript(launcherTranscript: string, threadId: string, startedAt: string): string | null {
  const root = path.resolve(path.dirname(launcherTranscript), '..', '..', '..');
  const at = Date.parse(startedAt);
  const suffix = `-${threadId}.jsonl`;
  for (const day of new Set([localDay(at), localDay(at - CREATION_MARGIN_MS)])) {
    const dir = path.join(root, day);
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; } // jour sans aucun fil
    const name = names.find(n => n.endsWith(suffix));
    if (name) return path.join(dir, name);
  }
  return null;
}
