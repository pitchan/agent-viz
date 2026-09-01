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
}
interface CliUninstallResult {
  results: Array<{ file: string; scope: Scope; removed: number; exists: boolean }>;
  error?: string;
}
interface CliInstallResult {
  target: { file: string; scope: Scope };
  command: { command: string; mode: string };
  action: string;
  missing: string[];
  updated: string[];
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
      }
    }
    // Une erreur ne doit jamais se lire comme « rien à retirer » (décision D3) :
    // le total peut rester à 0 alors qu'un agent n'a pas pu être traité du tout.
    if (total === 0 && !failed) console.log('Aucun hook agent-viz trouvé.');
    return;
  }

  // install — une seule boucle : le registre garantit la même forme pour tout
  // agent enregistré, y compris un 3e. La branche `error` valait jusqu'ici pour
  // copilot seulement, et rien ne la produisait ; le registre la produit
  // désormais pour n'importe quel agent (cf. registry.ts).
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
    if (r.action === 'noop') {
      console.log(`[${agent}] ✓ déjà installé et à jour.`);
      continue;
    }
    if (r.missing.length > 0) console.log(`[${agent}] ✓ Ajouté sur : ${r.missing.join(', ')}`);
    if (r.updated.length > 0) console.log(`[${agent}] ✓ Rafraîchi sur : ${r.updated.join(', ')}`);
  }
  // Une erreur-valeur ne doit pas perdre le signal d'échec (décision D3).
  if (refused) process.exit(1);
}
