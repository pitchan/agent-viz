// Écrire en place ouvre d'abord le fichier en troncature : un arrêt à cet
// instant laisse un fichier de hooks vide, illisible comme JSON. Le contenu
// passe donc par un temporaire voisin, mis en place par un seul renommage.
import fs from 'node:fs';
import path from 'node:path';

export type AtomicWriteFs = Pick<typeof fs, 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync'>;

// Le temporaire ne finit pas en `.json` : Copilot charge tout `*.json` de ses
// dossiers de hooks.
export function writeJsonAtomic(file: string, value: unknown, io: AtomicWriteFs = fs): void {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  io.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  try {
    io.renameSync(tmp, file);
  } catch (err) {
    // Seule l'erreur du renommage repart, telle quelle : son message nomme déjà
    // le fichier, et le registre la rend en `{ error }`.
    try { io.unlinkSync(tmp); } catch { /* retrait au mieux */ }
    throw err;
  }
}
