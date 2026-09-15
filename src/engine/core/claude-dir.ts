import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Le nom de la variable d'environnement qui désigne le dossier de
 * configuration de Claude Code — **son nom à lui**, pas un nom inventé ici.
 * Le produit observe Claude Code ; il en adopte donc le vocabulaire.
 */
export const CLAUDE_DIR_ENV = 'CLAUDE_CONFIG_DIR';

export type ResolveClaudeDirOptions = {
  /** Chemin donné explicitement, par exemple par `--claude-dir`. Prioritaire. */
  explicit?: string | undefined;
  /** Environnement à consulter. Injectable pour les tests. */
  env?: Record<string, string | undefined>;
  /** Répertoire personnel. Injectable pour les tests. */
  home?: string;
};

/**
 * LA résolution du dossier de configuration, à un seul endroit : l'Observatoire du serveur et
 * le doctor du moteur l'importent tous deux. Un nom de variable par moitié du produit ne
 * déplacerait que cette moitié, et deux vues liraient deux jeux de sessions sans avertir.
 *
 * `NETGAIN_CLAUDE_DIR` n'est pas lue, même en repli : un second nom vivrait pour toujours
 * afin de couvrir un utilisateur qui n'existe pas.
 *
 * UNE VARIABLE VIDE EST UNE VARIABLE NON POSÉE. Lue avec `??`, une variable vide faisait
 * scanner la chaîne vide et annoncer « 0 session(s) découverte(s) » : une cécité totale,
 * silencieuse, qui se lit comme « vous n'avez pas de sessions ».
 *
 * Pure et synchrone : aucune E/S, aucun accès au disque. Elle ne vérifie pas que
 * le dossier existe — ce n'est pas sa décision, et un dossier absent se signale
 * là où il est lu, avec le contexte de la lecture.
 */
export function resolveClaudeDir(options: ResolveClaudeDirOptions = {}): string {
  const { explicit, env = process.env, home } = options;
  if (explicit !== undefined && explicit !== '') return explicit;
  const fromEnv = env[CLAUDE_DIR_ENV];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return path.join(home ?? homedir(), '.claude');
}

/**
 * Le chemin de `.claude.json` — l'inventaire MCP que lit la carte R2 de
 * l'Observatoire. La MÊME variable le déplace, mais **pas de la même façon**, et
 * c'est tout l'intérêt de le résoudre ici plutôt qu'au point d'appel.
 *
 * Établi PAR EXÉCUTION sur Claude Code 2.1.226, les deux branches, dans un home
 * entièrement jetable :
 *   - `CLAUDE_CONFIG_DIR` posée     → `$CLAUDE_CONFIG_DIR/.claude.json`
 *   - `CLAUDE_CONFIG_DIR` non posée → `~/.claude.json`
 * Recoupé sur la machine réelle : `~/.claude.json` existe, `~/.claude/.claude.json`
 * n'existe pas.
 *
 * LE PIÈGE, et la raison d'une fonction séparée : `join(resolveClaudeDir(), …)`
 * paraît évident et se trompe dans le cas par défaut — il donnerait
 * `~/.claude/.claude.json`, un fichier qui n'existe nulle part. Le dossier et le
 * fichier ne sont frères qu'en l'absence de variable ; posée, elle les réunit.
 */
export function resolveClaudeJsonPath(options: ResolveClaudeDirOptions = {}): string {
  const { env = process.env, home } = options;
  const fromEnv = env[CLAUDE_DIR_ENV];
  if (fromEnv !== undefined && fromEnv !== '') return path.join(fromEnv, '.claude.json');
  return path.join(home ?? homedir(), '.claude.json');
}
