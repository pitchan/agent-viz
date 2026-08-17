# agent-viz

Real-time visualizer for [Claude Code](https://docs.claude.com/en/docs/claude-code) and [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) sessions. Streams hook events into a live web dashboard with per-agent badges, multi-agent topology, token usage, and tool-call timeline.

## Install & start (recommended)

Two commands and you're done:

```bash
npm install -g @vcueto/agent-viz
agent-viz
```

That second command does **everything in one go**:

- registers the Claude Code hooks (first run only — idempotent),
- starts the dashboard on http://localhost:3333,
- returns control to your terminal (the server runs in background).

Open http://localhost:3333, run Claude Code in any other terminal, watch events appear live. To stop:

```bash
agent-viz stop
```

## Other ways to run it

### Try it once without installing

```bash
npx @vcueto/agent-viz
```

Same behavior as the global install, **but slower in practice**: each Claude Code hook firing pays an npx cold-start cost (~300–800 ms) because the binary is resolved from a temp cache. For daily use, prefer the global install above (~40–80 ms per hook firing).

### Per-project install

```bash
npm install --save-dev @vcueto/agent-viz
npx agent-viz
```

Adds `agent-viz` as a dev dependency. The hook command embedded in `settings.json` points at the local `node_modules/.bin/agent-viz` (fast, no npx overhead). Scope defaults to `<root>/.claude/settings.local.json` (gitignored).

## Daily usage

| Goal | Command |
|---|---|
| Start the dashboard | `agent-viz` |
| Stop it | `agent-viz stop` |
| See if it's running | `agent-viz status` |
| Run attached (Ctrl+C to quit) | `agent-viz start --foreground` |
| Use a different port | `agent-viz start --port 4000` |
| Open browser automatically | `agent-viz start --open` |
| Skip auto hook install | `agent-viz start --no-install-hooks` |

## Observatoire (analyse et conseils)

Deux pages s'ajoutent à la vue temps réel, accessibles depuis la barre d'outils.

- **Conseils** — les actions prioritaires, chacune adossée à un chiffre mesuré sur vos propres sessions : quel projet reconstruit son préfixe de cache en cours de route, quel serveur MCP est chargé partout mais jamais appelé, quelle commande imprime beaucoup et souvent, quels fichiers sont relus par plusieurs agents, quelles sessions sont compactées plusieurs fois, quels sous-agents partent sur des tâches trop courtes, quelles sessions laissent des modifications non vérifiées — des fichiers modifiés après la dernière commande de test, de build, de lint ou de typecheck, et les jetons émis après cette dernière preuve. Aucune économie n'est projetée : ce sont des coûts constatés sur la période.
- **Sessions analysées** — le tableau des sessions mesurées (coût, jetons nets, durée, modèle dominant) avec le détail chiffré session par session.

La fenêtre d'analyse se choisit dans l'en-tête (7, 30 ou 90 jours, 30 par défaut) et chaque carte affiche la période sur laquelle elle a été constatée. Les sessions machines (`claude -p`, scripts) sont scannées et badgées, mais jamais comptées dans les conseils ni dans les totaux par défaut ; un interrupteur les affiche à la demande, et le résumé annonce toujours l'assiette retenue (sessions humaines, machines exclues, indéterminées exclues). La base se migre seule à l'ouverture : une colonne nouvelle déclenche un re-scan complet au premier lancement, en tâche de fond, sans bloquer la vue temps réel.

Trois points à savoir :

- **Deux blocs, jamais un classement commun.** Certaines règles chiffrent de vrais jetons, d'autres partent d'octets convertis (≈ 4 octets par jeton). Les deux n'ont pas la même précision : la page les présente séparément et n'affiche **aucun total**, parce qu'une même session alimente plusieurs règles et serait comptée deux fois.
- **Une seule source de prix.** La table de tarifs embarquée dans le moteur tarife tout le produit — vue temps réel comprise — et chaque page nomme sa provenance. Elle porte les tarifs datés : un message est facturé au prix en vigueur le jour où il a été envoyé. Une table publique en ligne sert uniquement de vigie : elle est comparée chaque jour à la table embarquée et signale une dérive, sans jamais fixer un prix. Une session dont le modèle n'a pas de tarif connu est marquée « partiel », jamais arrondie à zéro en silence.
- **Des métadonnées, et trois exceptions nommées.** L'essentiel de ce qui est conservé, ce sont des compteurs, des tailles et des noms d'outils : aucun contenu de fichier ni de sortie d'outil n'entre dans la base. Trois choses y entrent quand même, et il vaut mieux le savoir : les **chemins** des fichiers modifiés après la dernière vérification (20 au plus par session) ; le **texte de deux commandes** de vérification par session, la première et la dernière — 200 caractères au plus, et les affectations du type `NPM_TOKEN=…` retirées avant écriture ; et un **extrait des questions** que vous avez posées, quand elles ressemblent à une question de navigation dans le code. Tout cela reste chez vous : la base est un fichier local, elle n'est envoyée nulle part.

La base `~/.agent-viz/observatory.db` est un **dérivé jetable** : les transcripts restent la source de vérité, et la supprimer ne perd que les statuts « j'applique / ignorer » que vous avez posés sur les recommandations — elle se reconstruit au scan suivant (au démarrage, puis toutes les heures). Le bouton « Purger la base » de la page Conseils fait ce geste sans toucher au fichier : il vide la base (après confirmation) puis relance un scan complet.

L'analyse repose sur le moteur netgain, qui **fait partie d'agent-viz** : même dépôt (dossier `src/engine/`), même paquet, même version, même installation. Il n'y a rien à brancher ni à installer à côté. Si le moteur venait à manquer — installation abîmée —, les deux pages affichent l'erreur exacte et **la vue temps réel continue de fonctionner normalement**.

## Multi-agent support

agent-viz captures events from **both Claude Code and GitHub Copilot CLI** simultaneously. On first run, it auto-detects which CLI agents are installed locally and registers the appropriate hooks for each. Sessions are tagged in the dashboard with a colored pill badge (cyan for Claude, violet for Copilot).

To force a target explicitly:

```bash
agent-viz install-hooks --target=claude     # Claude only
agent-viz install-hooks --target=copilot    # Copilot only
agent-viz install-hooks --target=both       # both even if not detected
```

Detection: an agent is considered installed if its CLI binary is on your `PATH`, or if its config home (`~/.claude/` for Claude, `~/.copilot/` for Copilot) exists with at least one file inside.

## Hook management

The first time you run `agent-viz`, it auto-registers hooks for each detected agent. **The default scope is user-level (global)** — the hook then fires from every directory, so a session launched anywhere is captured:

| Agent | Default location (user scope) |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Copilot CLI | `~/.copilot/hooks/agent-viz.json` |

Project scopes are opt-in. You only need the commands below in three situations:

**1. You want to scope the hook to one repo (and share it with your team).** Commit it at project scope:

```bash
agent-viz install-hooks --project   # writes <root>/.claude/settings.json (committed)
agent-viz install-hooks --local     # writes the gitignored per-repo variant
```

**2. You're already on user scope and want to confirm it.**

```bash
agent-viz install-hooks --user      # writes ~/.claude/settings.json (this is the default)
```

**3. You want to check or remove the hooks.**

```bash
agent-viz install-hooks --check     # read-only audit: which events are wired up?
agent-viz uninstall-hooks           # remove from all scopes
agent-viz uninstall-hooks --user    # remove from user scope only
```

When writing to `settings.local.json`, agent-viz appends the file to your `.gitignore` (only if a `.gitignore` already exists, never creates one).

## Coexistence with other hooks

agent-viz **never replaces or removes hooks you didn't add**. Claude Code runs every hook registered for an event in parallel, so any custom hook you already had (logger, security check, etc.) keeps working alongside agent-viz.

When you install, agent-viz reports any sibling hooks already registered on the same events:

```
✓ Hooks installed → ~/.claude/settings.json
  added on: PreToolUse, PostToolUse, Stop, SessionStart
  coexisting hooks (run in parallel, untouched):
    - PreToolUse: 1 other(s)
```

If an existing agent-viz hook entry has a stale command — e.g. an absolute path that no longer exists after a reinstall, or a pinned npx version that's now older than the installed package — `agent-viz install-hooks` rewrites the command in place rather than leaving it broken. Hand-edited custom wrappers (commands that don't follow the standard `node "<path>" hook` or `npx ... agent-viz... hook` shape) are left untouched.

`agent-viz install-hooks --check` now reports both missing and stale entries:

```
  [x] UserPromptSubmit
  [~] PreToolUse        (stale, +1 other)
  [ ] PostToolUse
```

To start completely clean:

```bash
agent-viz uninstall-hooks   # removes all agent-viz hooks across scopes
agent-viz install-hooks     # re-add a fresh entry
```

## Uninstalling

Two steps, **in order** — npm 7+ no longer runs lifecycle scripts on uninstall ([official docs](https://docs.npmjs.com/misc/scripts#a-note-on-a-lack-of-npm-uninstall-scripts)), so you have to clean up the hooks before removing the package:

```bash
agent-viz uninstall-hooks    # remove agent-viz hooks from all scopes
npm uninstall -g @vcueto/agent-viz   # then remove the package
```

If you skipped step 1 (or uninstalled an older version), Claude Code will start logging `Cannot find module` errors at every hook firing. Recover with:

```bash
# Easiest — npx fetches a fresh agent-viz just to run the cleanup:
npx --yes @vcueto/agent-viz@latest uninstall-hooks

# Or hand-edit ~/.claude/settings.json and remove every hook entry whose
# `command` mentions "agent-viz".
```

If you reinstall agent-viz to a different path later (e.g. moved your dev clone), `agent-viz install-hooks` rewrites the stale absolute paths in place — no need to uninstall first.

## Captured events

`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`. Events land as JSONL in `${tmpdir}/agent-events/<session_id>.jsonl` and are streamed to the dashboard via Server-Sent Events. Each event carries a `_source: "claude" | "copilot"` field set by the hook command's `--source` flag.

## Configuration

Environment variables (all optional):

| Var | Default | Effect |
|---|---|---|
| `PORT` | `3333` | Port the dashboard listens on. |
| `VIZ_PURGE_AGE_H` | `24` | Delete sessions older than N hours. |
| `VIZ_KEEP_MAX` | `20` | Keep at most N most recent sessions. |
| `VIZ_COMPACT_KB` | `500` | Compact files larger than N KB (keeps last 100 events + summary). |

The server purges old sessions on boot and every hour.

## Requirements

- Node.js ≥ 24
- Claude Code installed and configured

## Development

One repository, **one package**: `@vcueto/agent-viz`. The analysis engine is not a separate
package — its TypeScript source lives in `src/engine/` and its build output, `dist/engine/`,
ships inside the published tarball. Since the 2026-08 tree merge there is a single `src/`:
`src/server/` (the daemon, ESM since step 3 of the migration), `src/engine/` (the engine,
TypeScript ESM) and `src/web/` (the browser bundle, served as-is).

The root package is ESM (`{"type":"module"}`), so `src/engine/` needs no subtree marker of
its own: no `package.json` twin to keep versioned, none written by the build.

```bash
git clone https://github.com/pitchan/agent-viz.git
cd agent-viz
npm install
npm run build                # the engine is TypeScript; dist/ is not committed
npm start                    # dashboard on http://localhost:3333
```

Tests: `npm test` (a single `vitest run` over one `tests/` tree — 1404 tests in 123 files,
product and engine together; the 78 `node:test`-based files run through a bridge,
`test-support/bridge/`) and `npm run test:node` (the same 865 `node:test` cases, run natively
under `node --test`, kept as the reference the bridge is checked against). After changing
engine source, rebuild it (`npm run build`) — the product loads the compiled `dist/engine/`.
Publishing runs both test commands and the build first (`prepublishOnly`).

Test files are named after the module system they use: `.test.cjs` (40, CommonJS),
`.test.mjs` (38, ESM) and `.test.ts` (45, vitest API). Since the root package is ESM, a
`.js` test file *is* an ES module — the extension is what tells the runtime, so it has to be
right. Both runners load `test-support/env-guard.mjs` first: it redirects `HOME`,
`USERPROFILE`, `TEMP` and `TMP` to a throwaway sandbox and forces a dead port, so a test can
never write to your real `~/.claude/settings.json` or reopen your observatory database.

## License

MIT — see [LICENSE](./LICENSE).
