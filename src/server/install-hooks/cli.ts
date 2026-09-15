// ── CLI standalone (kept for backwards compatibility) ──
// L'entrée ligne de commande directe du module émis :
//   node dist/server/install-hooks.js [--user|--project|--local] [--check|--uninstall]
// La façade (install-hooks.ts) branche cliMain sur son bloc main.
import type { Scope } from './types.ts';
import { install, audit, uninstall } from './registry.ts';

// Ce que la CLI attend de `audit()`/`uninstall()`/`install()` — les mêmes
// registres que `dispatch` construit réellement (voir `AgentInstaller`),
// nommés ici pour l'affichage plutôt que laissés `unknown` : c'est la
// frontière propre à CE consommateur, pas une nouvelle promesse des fonctions
// haut niveau (qui restent `Record<string, unknown>`).
interface CliAuditResult {
  file: string;
  scope: Scope;
  audit: Array<{ event: string; installed: boolean; stale: boolean; others: number }>;
  error?: string;
}
interface CliUninstallResult {
  results: Array<{ file: string; scope: Scope; removed: number; exists: boolean; backup: string | null }>;
  error?: string;
}
interface CliInstallResult {
  target: { file: string; scope: Scope };
  command: { command: string; mode: string };
  action: string;
  missing: string[];
  updated: string[];
  backup: string | null;
  error?: string;
}

interface CliArgs {
  mode: 'install' | 'check' | 'uninstall';
  scope: Scope | undefined;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { mode: 'install', scope: undefined };
  for (const a of argv) {
    if (a === '--check') out.mode = 'check';
    else if (a === '--uninstall') out.mode = 'uninstall';
    else if (a === '--install') out.mode = 'install';
    else if (a === '--user') out.scope = 'user';
    else if (a === '--project') out.scope = 'project';
    else if (a === '--local') out.scope = 'local';
  }
  return out;
}

export function cliMain(argv: string[]): void {
  const { mode, scope } = parseCliArgs(argv);
  const cwd = process.cwd();

  if (mode === 'check') {
    const result = audit({ scope, cwd }) as Record<string, CliAuditResult>;
    let allGood = true;
    for (const [agent, a] of Object.entries(result)) {
      // `audit` passe par `dispatch`, qui traduit tout refus en `{ error }` :
      // un fichier de hooks illisible fait lever `readSettings`/`readCopilotFile`.
      // Sans cette garde, l'audit imprimait « settings : undefined » puis mourait
      // sur `a.audit is not iterable` — un vrai diagnostic remplacé par un faux.
      if (a.error) {
        console.log(`[${agent}] ! ${a.error}`);
        allGood = false;
        continue;
      }
      console.log(`[${agent}] settings : ${a.file}  (scope: ${a.scope})`);
      for (const { event, installed, stale, others } of a.audit) {
        const flag = installed ? (stale ? '~' : 'x') : ' ';
        const tags = [];
        if (stale) tags.push('stale');
        if (others > 0) tags.push(`+${others} other`);
        console.log(`[${agent}]   [${flag}] ${event}${tags.length ? '   (' + tags.join(', ') + ')' : ''}`);
        if (!installed || stale) allGood = false;
      }
    }
    process.exit(allGood ? 0 : 1);
  }

  if (mode === 'uninstall') {
    const result = uninstall({ scope, cwd }) as Record<string, CliUninstallResult>;
    let total = 0;
    let failed = false;
    for (const [agent, x] of Object.entries(result)) {
      if (x.error) {
        console.log(`[${agent}] ! ${x.error}`);
        failed = true;
        continue;
      }
      const results = x.results || [];
      for (const r of results) {
        total += r.removed;
        if (r.removed > 0) console.log(`[${agent}] ✓ retiré ${r.removed} de ${r.file} (${r.scope})`);
        else if (r.exists) console.log(`[${agent}]   rien à retirer dans ${r.file} (${r.scope})`);
        if (r.backup) console.log(`[${agent}]   backup: ${r.backup}`);
      }
    }
    // Une erreur ne doit jamais se lire comme « rien à retirer » : le total reste
    // à 0 quand un agent n'a pas pu être traité du tout.
    if (total === 0 && !failed) console.log('Aucun hook agent-viz trouvé.');
    // …et elle ne doit pas non plus se lire comme un succès dans un script : un
    // `uninstall-hooks` qui sort 0 en disant « hooks NON retirés » fait lire un succès
    // à une étape de CI alors que les hooks sont posés et se déclenchent toujours.
    if (failed) process.exit(1);
    return;
  }

  // install — une seule boucle : le registre garantit la même forme pour tout
  // agent enregistré, y compris un 3e, et produit la branche `error` pour
  // n'importe lequel (cf. registry.ts).
  const result = install({ scope, cwd }) as Record<string, CliInstallResult>;
  let refused = false;
  for (const [agent, r] of Object.entries(result)) {
    if (r.error) {
      console.log(`[${agent}] ! ${r.error}`);
      refused = true;
      continue;
    }
    console.log(`[${agent}] settings : ${r.target.file}  (scope: ${r.target.scope})`);
    console.log(`[${agent}] hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
    if (r.backup) console.log(`[${agent}] backup   : ${r.backup}`);
    if (r.action === 'noop') {
      console.log(`[${agent}] ✓ déjà installé et à jour.`);
      continue;
    }
    if (r.missing.length > 0) console.log(`[${agent}] ✓ Ajouté sur : ${r.missing.join(', ')}`);
    if (r.updated.length > 0) console.log(`[${agent}] ✓ Rafraîchi sur : ${r.updated.join(', ')}`);
  }
  // Une erreur-valeur ne doit pas perdre le signal d'échec : le code de sortie le porte.
  if (refused) process.exit(1);
}
