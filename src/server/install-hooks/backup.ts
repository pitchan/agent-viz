// Un fichier de hooks porte aussi ce que l'utilisateur y a mis lui-même : avant
// de le réécrire ou de le supprimer, agent-viz en garde les octets tels quels,
// dans un dossier par fichier source, pour qu'il puisse revenir en arrière.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type BackupFs = Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'copyFileSync' | 'readdirSync' | 'unlinkSync'>;

export interface BackupDeps {
  root?: string;
  io?: BackupFs;
  now?: () => number;
}

export const BACKUPS_KEPT = 30;

// La purge ne compte que les noms que ce module fabrique : un fichier posé
// là par quelqu'un d'autre n'est ni compté ni supprimé.
const COPY_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z/;

export function backupHookFile(
  file: string,
  { root = path.join(os.homedir(), '.agent-viz', 'backups'), io = fs, now = Date.now }: BackupDeps = {},
): string | null {
  // existsSync et non un ENOENT rattrapé : copyFileSync rend le même code
  // quand c'est le dossier des copies qui manque.
  if (!io.existsSync(file)) return null;
  const dir = path.join(root, file.replace(/[^A-Za-z0-9._-]/g, '-'));
  const copy = path.join(dir, new Date(now()).toISOString().replace(/:/g, '-') + path.extname(file));
  try {
    io.mkdirSync(dir, { recursive: true });
    io.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
    const copies = io.readdirSync(dir).filter(name => COPY_NAME.test(name)).sort();
    for (const old of copies.slice(0, -BACKUPS_KEPT)) io.unlinkSync(path.join(dir, old));
  } catch (err) {
    // L'erreur fs nomme la copie ou son dossier, jamais le fichier de hooks :
    // le message dit lequel, et qu'il n'a pas été touché.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`backup of ${file} failed, file left unchanged: ${message}`, { cause: err });
  }
  return copy;
}
