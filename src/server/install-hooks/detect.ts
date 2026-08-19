// Sonder la machine : un exécutable est-il dans le PATH, un dossier a-t-il du
// contenu ? Les adaptateurs composent leurs prédicats `detect` avec ces deux
// sondes génériques.
import fs from 'node:fs';
import path from 'node:path';

export function dirHasFiles(p: string): boolean {
  try { return fs.readdirSync(p).length > 0; } catch { return false; }
}

export function inPath(name: string): boolean {
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      try { if (fs.existsSync(path.join(dir, name + ext))) return true; } catch {}
    }
  }
  return false;
}
