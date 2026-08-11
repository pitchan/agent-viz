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
 * LA résolution du dossier de configuration, à un seul endroit — constat C5 de
 * `docs/audit-qualite-code.md`.
 *
 * Ce qui était en cause n'est pas un doublon de code mais un doublon de
 * VOCABULAIRE : `CLAUDE_CONFIG_DIR` côté produit (serveur, page Observatoire),
 * `NETGAIN_CLAUDE_DIR` côté moteur, dans un seul paquet npm portant deux `bin`.
 * Poser l'une ne déplaçait que la moitié correspondante — deux vues du même
 * produit sur deux jeux de sessions, sans qu'aucun message n'avertisse.
 *
 * `NETGAIN_CLAUDE_DIR` est SUPPRIMÉE, pas repliée : elle n'était annoncée que
 * dans le texte d'aide de `netgain --help` (`netgain/README.md` n'est même pas
 * dans le champ `files` du paquet), et le produit n'est installé nulle part
 * ailleurs. Un repli aurait fait vivre un second nom pour toujours afin de
 * couvrir un utilisateur qui n'existe pas.
 *
 * UNE VARIABLE VIDE EST UNE VARIABLE NON POSÉE. Ce point n'est pas un détail de
 * style : les deux moitiés en divergeaient déjà, et cette divergence-là ne
 * figure pas dans le rapport d'audit — elle a été trouvée en exécutant. Le
 * moteur employait `??` (nullish), donc avec `NETGAIN_CLAUDE_DIR=""` il
 * scannait la chaîne vide et annonçait « 0 session(s) découverte(s) sous  » :
 * une cécité totale, silencieuse, qui se lit comme « vous n'avez pas de
 * sessions ». Le serveur employait `||` et retombait correctement sur le home.
 * C'est le sens du serveur qui est retenu, des deux côtés.
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
