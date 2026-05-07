# Brainstorm — Rendre agent-viz irrésistible (sans dégrader le rendu / perf)

**Statut** : tri Vincent v1 effectué — 8 idées retenues (sur 12), à designer
**Auteur** : Claude (sur demande de Vincent)
**Date** : 2026-05-07
**Contexte** : v0.2.3 — déjà bien optimisée (sprite cache, batched particles, world-bounds culling, rAF adaptatif, frame-skip > 25 ms). Toute proposition doit respecter ce budget perf.

## Décisions de tri (2026-05-07)

| Axe | Décision Vincent |
|---|---|
| **A — Délice** | Garder **#1 Live narrator** + **#2 Watch mode** (ce dernier "à bien penser"). Couper #3 / #4 / #5. |
| **B — Insight** | **Tout retenu** (#6 Anomaly halos, #7 Loop detector, #8 Burn rate, #9 Efficiency grade) — on l'implémente. |
| **C — Partage** | **Tout retenu** (#10 Time-scrub, #11 Permalink HTML, #12 GIF/MP4) — intéressant. |

Soit **8 idées retenues** sur 12. Les coupées sont déplacées en bas dans "Parqué".

## Cadre

Trois axes de "irrésistible" :

- **Délice** — on a envie de la regarder
- **Insight** — elle révèle quelque chose qu'on ignorait
- **Partage** — on a envie de la montrer à un collègue

## Idées retenues

### Axe A — Délice (2 retenues)

1. **Live narrator** ✅
   Caption 1-ligne sous topbar, FR/EN, calculée client-side depuis l'état (pas de LLM). Ex : *"Reading 3 files in auth/, just ran Bash, last error 14s ago"*. Heuristique pure sur `state.nodes` + buckets de tools récents. **Coût perf : nul** (recalcul throttled à 1 Hz). Différencie instantanément.

2. **Cinematic "Watch mode"** ⚠️ *à bien penser*
   Touche W : masque feed/toolbar, expand canvas full-bleed, auto-fit permanent. Pour 2e écran ou démo. Coût nul tant que pas activé.
   **Points à trancher demain** :
   - Quel est le *vrai* déclencheur d'usage ? 2e écran solo / démo client / live stream / présentation d'équipe ?
   - Faut-il une variante "ambiance" (legends/stats minimaux subtils en bas) ou full-clean (juste le graph) ?
   - Sortie : Esc, ou re-pression de W ? Comportement si la fenêtre perd le focus ?
   - Doit-il forcer auto-fit ON (même si l'utilisateur l'avait coupé) le temps du mode, et restaurer en sortie ?
   - Le live narrator (#1) reste-t-il visible en watch mode ou est-il aussi masqué ? (mon vote : visible — c'est précisément ce qu'on regarde de loin)

### Axe B — Insight (4 retenues, à implémenter)

3. **Anomaly halos** ✅
   Tools qui dépassent 5× la médiane de leur type (rolling window, ~50 derniers de chaque type) → halo ambre subtil sur le nœud. Errors → shake + glow décroissant. Pill "warnings" globale dans le topbar. Stats roulantes en O(1) par event, stockées dans un module dédié `viz-stats.js` (pas dans `state`).

4. **Loop detector** ✅
   Clé `(toolName + hash(input))` répétée ≥ 3× dans une fenêtre 30s → badge "loop?" sur le dernier nœud. Coût mémoire négligeable (Map de tailles bornée). Le hash est calculé une fois au `PreToolUse`, jamais relu en frame.

5. **Burn rate + projection** ✅
   Extend `budget-pill` existant : `$/min` instantané + projection cumulative (`proj. $X.YY at current rate`). Daily total persisté dans localStorage avec rotation à minuit local. La logique de couleur (`is-warn` / `is-crit`) déjà présente dans `viz.css` est réutilisée.

6. **Token efficiency grade** ✅
   Note A→F par session : pondère cache hit rate + output:input ratio. Visible sur la session card et en hover du budget pill. Gamification douce. Calcul à la volée à partir des compteurs déjà présents dans `state.tokens` — aucune nouvelle source de données.

### Axe C — Partage (3 retenues)

7. **Time-scrub / replay bar** ✅
   Barre fine en bas du canvas, histogramme densité d'events. Drag = scrub, espace = play/pause, →/← step. La topologie se rejoue. **Coût perf : 0 hors mode scrub** (le live tick reste prioritaire). En mode scrub on freeze le live et on replay depuis le JSONL stocké dans `${tmpdir}/agent-events/<sid>.jsonl`.

8. **Self-contained permalink HTML** ✅
   Bouton "Export" → fichier `.html` unique qui embarque (a) l'état sérialisé `state.nodes` + `state.timelineEntries`, (b) une copie minifiée des `viz-*.js` nécessaires au rendu offline, (c) le replay bar. À drop dans Slack/PR/email. Zéro serveur. Réutilise 100% du code de rendu existant.

9. **GIF/MP4 export** ✅
   `MediaRecorder` sur `canvas.captureStream()` → WebM. Optionnellement transcodage GIF côté Worker (lourd, à mettre derrière un toggle). Bouton "Record" dans la toolbar. État d'enregistrement bien visible (point rouge clignotant) pour éviter de capturer involontairement.

## Roadmap proposée

| Release | Contenu | Justification |
|---|---|---|
| **v0.3** | #1 Live narrator + #5 Burn rate + #6 Efficiency grade | Tout côté client, faible risque, valeur visible *immédiatement* à chaque session. |
| **v0.4** | #3 Anomaly halos + #4 Loop detector | Demande un module stats roulantes propre + drawer overlays. Une fois en place, terreau pour d'autres signaux futurs. |
| **v0.5** | #7 Time-scrub + #8 Permalink HTML | À designer ensemble (scrub *est* le moteur du replay du permalink — un seul moteur de replay). |
| **v0.6** | #9 GIF/MP4 + #2 Watch mode | Watch mode passe en dernier *exprès* : il bénéficie de tout le reste (narrator visible, anomaly halos visibles, etc.) → c'est l'apothéose visuelle. |

Cette séquence respecte deux principes :
- **Effort croissant** : on commence par les XS/S, on finit par les M.
- **Composition** : chaque release réutilise du code de la précédente. Notamment, scrub + permalink + GIF partagent le même *moteur de replay*.

## Garde-fous perf (à respecter dans tout ce qui suit)

- Pas de DOM animé pendant que le canvas tick (compétition GPU).
- Toute logique récurrente passe par `markDirty()` et lit `vis.avgFrameMs` pour adapter sa cadence.
- Les nouveaux drawers respectent le pattern existant (`drawXxxNode(ctx, n, vn)` pur, pas d'allocation par frame).
- Les buffers (timeline, event log) restent capés (`TIMELINE_CAP = 500` est déjà bien).
- Ne pas pousser de nouvel état dans `state` si ça peut vivre dans un module isolé (cf. `viz-stats.js` proposé pour #3/#4).
- L'export GIF (#9) tourne dans un Worker pour ne pas bloquer le main thread — jamais sur le canvas en cours d'enregistrement.

## Parqué (coupé ou non retenu)

| Idée | Raison de parking |
|---|---|
| **Depth-of-field temporel** (ex-#3 axe A) | Coupé par Vincent. Effet pas indispensable, peut concurrencer le glow existant. |
| **Audio opt-in** (ex-#4 axe A) | Coupé par Vincent. Niche, distrayant pour usage pro. |
| **Mini-map / radar** (ex-#5 axe A) | Coupé par Vincent. Auto-fit + Watch mode couvrent le besoin de vue d'ensemble. |
| LLM-generated summaries | Latence + coût + non-déterministe. Le narrator heuristique (#1) fait 90% du job pour 0%. |
| Mode 3D | Séduisant en démo, tue la perf au-delà de 30 nœuds, gain réel marginal. |
| Live spectator (URL partagée temps réel) | Casse-tête sécu pour v1. Reporter à v0.7+ si demande réelle. |
| Force-directed physics permanent | Le layout actuel suffit. Solver permanent = CPU coûteux pour gain marginal. |
| Heatmap globale | Conflit visuel avec particles + glow existants. |
| Plugin marketplace de "themes" | Surdimensionné pour v1. À envisager après stabilisation produit. |

## Questions ouvertes pour demain

1. **Watch mode** : trancher les 5 sous-questions du point #2 ci-dessus.
2. **Public visé prioritaire** : devs solo / équipes / streamers ? Influence le poids relatif Watch mode vs Permalink vs GIF.
3. **Budget temps** : un weekend, une semaine, ou plusieurs mini-releases étalées ? Conditionne le rythme de la roadmap.
4. **Comparaison de sessions** : si on garde l'idée pour plus tard, c'est l'extension naturelle après #7 (scrub deux sessions en parallèle).
5. **Le narrator parle FR ou EN ?** Le reste de l'UI est en EN — par cohérence, EN. À confirmer.

## Prochaine étape

Activer le visual companion, designer le **#1 Live narrator** en premier (mockuper la zone, choisir la grammaire de phrases), puis enchaîner sur **#5/#6** (extensions de la budget pill). Ensuite on entre en spec design + plan d'implémentation sur la batch v0.3.
