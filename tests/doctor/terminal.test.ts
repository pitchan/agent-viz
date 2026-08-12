import { describe, expect, test } from 'vitest';
import { emptyChurnCauses, emptyPauseBuckets, emptyPrefixBreakdown } from '../../src/engine/doctor/aggregators/context.js';
import {
  computeLivedGain,
  renderCacheWritesByMonth,
  renderChurnCauses,
  renderCounterfactual1h,
  renderAgentBehavior,
  renderLivedGain,
  renderPauseBuckets,
  renderPrefixAdvice,
  renderPrefixBreakdown,
  renderReadsLine,
} from '../../src/engine/doctor/report/terminal.js';

const n = (x: number): string => x.toLocaleString('fr-FR');

describe('renderChurnCauses — ligne « causes » sous CONTEXTE', () => {
  test('n’affiche que les cases non vides, en français, dans un ordre fixe', () => {
    const s = renderChurnCauses({
      growth: { events: 2, tokens: 60000 },
      compaction: { events: 0, tokens: 0 },
      expiration: { events: 1, tokens: 50000 },
      prefixChange: { events: 0, tokens: 0 },
      unknown: { events: 0, tokens: 0 },
    });
    expect(s).not.toBeNull();
    expect(s).toContain(`pause > durée de vie du cache ×1 (${n(50000)} tk)`);
    expect(s).toContain(`fausse alerte (simple croissance) ×2 (${n(60000)} tk)`);
    expect(s).not.toContain('compactage');
    expect(s).not.toContain('indéterminé');
    // L'expiration (actionnable) s'affiche avant la fausse alerte.
    expect(s!.indexOf('pause')).toBeLessThan(s!.indexOf('fausse alerte'));
  });

  test('tout à zéro → null (pas de ligne)', () => {
    const zero = { events: 0, tokens: 0 };
    expect(
      renderChurnCauses({ growth: zero, compaction: zero, expiration: zero, prefixChange: zero, unknown: zero }),
    ).toBeNull();
  });
});

describe('renderPauseBuckets — ligne « pauses » sous les causes', () => {
  test('affiche les tranches non vides, groupées par durée de vie en vigueur', () => {
    const buckets = emptyPauseBuckets();
    buckets.ttl5m.b5to15m = { events: 3, tokens: 120000 };
    buckets.ttl5m.bOver3h = { events: 1, tokens: 50000 };
    buckets.ttl1h.b1to3h = { events: 2, tokens: 70000 };
    const s = renderPauseBuckets(buckets);
    expect(s).not.toBeNull();
    expect(s).toContain('pauses');
    expect(s).toContain(`5–15 min ×3 (${n(120000)} tk)`);
    expect(s).toContain(`> 3 h ×1 (${n(50000)} tk)`);
    expect(s).toContain('durée de vie 5 min');
    expect(s).toContain('durée de vie 1 h');
    expect(s).toContain(`1–3 h ×2 (${n(70000)} tk)`);
    expect(s).not.toContain('15–60 min');
  });

  test('tout à zéro → null', () => {
    expect(renderPauseBuckets(emptyPauseBuckets())).toBeNull();
  });
});

describe('renderPrefixBreakdown — sous-ligne du « début de contexte modifié »', () => {
  test('affiche les marqueurs puis la profondeur, cases non vides seulement, dans un ordre fixe', () => {
    const b = emptyPrefixBreakdown();
    b.markers.modelSwitch = { events: 1, tokens: 50000 };
    b.markers.noMarker = { events: 2, tokens: 80000 };
    b.depth.facade = { events: 2, tokens: 100000 };
    b.depth.tail = { events: 1, tokens: 30000 };
    const s = renderPrefixBreakdown(b);
    expect(s).not.toBeNull();
    expect(s).toContain('préfixe modifié');
    expect(s).toContain(`modèle changé ×1 (${n(50000)} tk)`);
    expect(s).toContain(`sans marqueur ×2 (${n(80000)} tk)`);
    expect(s).not.toContain('outils apparus');
    expect(s).toContain(`façade (≤ 10 % relu) ×2 (${n(100000)} tk)`);
    expect(s).toContain(`queue (> 90 % relu) ×1 (${n(30000)} tk)`);
    expect(s).not.toContain('10–50 % relu');
    // Les marqueurs (l'attribution) s'affichent avant la profondeur (l'indice de localisation).
    expect(s!.indexOf('modèle changé')).toBeLessThan(s!.indexOf('façade'));
  });

  test('tout à zéro → null (pas de ligne)', () => {
    expect(renderPrefixBreakdown(emptyPrefixBreakdown())).toBeNull();
  });
});

describe('renderPrefixAdvice — conseils quand le préfixe modifié domine les causes réelles', () => {
  test('prefixChange à zéro → null (rien à conseiller)', () => {
    expect(renderPrefixAdvice(emptyChurnCauses(), emptyPrefixBreakdown())).toBeNull();
  });

  test('non dominant (expiration plus grosse) → null', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 2, tokens: 50000 };
    causes.expiration = { events: 3, tokens: 80000 };
    expect(renderPrefixAdvice(causes, emptyPrefixBreakdown())).toBeNull();
  });

  test('dominant → étiquette labo + les 3 gestes du verdict v0.8.0', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 5, tokens: 200000 };
    causes.expiration = { events: 1, tokens: 40000 };
    const lines = renderPrefixAdvice(causes, emptyPrefixBreakdown());
    expect(lines).not.toBeNull();
    const s = lines!.join('\n');
    expect(s).toContain('conseil');
    expect(s).toContain('labo v0.8.0');
    expect(s).toContain('pas déduits de ces journaux');
    expect(s).toContain('ne pas changer de modèle en cours de session');
    expect(s).toContain('bascules de modèle silencieuses');
    expect(s).toContain('reprises rapides');
    expect(s).toContain('rebâtie à la reprise');
  });

  test('égalité avec une cause réelle → s’affiche (dominance large, ≥)', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 1, tokens: 50000 };
    causes.compaction = { events: 1, tokens: 50000 };
    expect(renderPrefixAdvice(causes, emptyPrefixBreakdown())).not.toBeNull();
  });

  test('modelSwitch vu dans CES journaux → le compte est ajouté à la ligne modèle', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 3, tokens: 150000 };
    const b = emptyPrefixBreakdown();
    b.markers.modelSwitch = { events: 2, tokens: 103000 };
    const s = renderPrefixAdvice(causes, b)!.join('\n');
    expect(s).toContain(`vu ici ×2 (${n(103000)} tk)`);
  });

  test('sans modelSwitch local, pas de « vu ici » (aucun chiffre inventé)', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 3, tokens: 150000 };
    const s = renderPrefixAdvice(causes, emptyPrefixBreakdown())!.join('\n');
    expect(s).not.toContain('vu ici');
  });

  test('growth (fausse alerte) plus gros n’empêche pas le conseil — exclu du gate', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 1, tokens: 50000 };
    causes.growth = { events: 10, tokens: 900000 };
    causes.unknown = { events: 4, tokens: 400000 };
    expect(renderPrefixAdvice(causes, emptyPrefixBreakdown())).not.toBeNull();
  });
});

describe('renderCacheWritesByMonth — migration de l’hôte vers le cache 1 h', () => {
  test('agrège par mois et affiche la part du 1 h', () => {
    const s = renderCacheWritesByMonth([
      { startedAt: '2026-06-03T08:00:00.000Z', cacheWrites: { tokens5m: 100000, tokens1h: 0, tokensUnknown: 0 } },
      { startedAt: '2026-07-01T09:00:00.000Z', cacheWrites: { tokens5m: 50000, tokens1h: 50000, tokensUnknown: 0 } },
      { startedAt: '2026-07-12T09:00:00.000Z', cacheWrites: { tokens5m: 0, tokens1h: 100000, tokensUnknown: 0 } },
    ]);
    expect(s).not.toBeNull();
    expect(s).toContain('2026-06 → 1 h 0 %');
    expect(s).toContain('2026-07 → 1 h 75 %');
  });

  test('les écritures sans détail de durée de vie sont affichées à part, jamais devinées', () => {
    const s = renderCacheWritesByMonth([
      { startedAt: '2026-07-01T09:00:00.000Z', cacheWrites: { tokens5m: 10000, tokens1h: 0, tokensUnknown: 7000 } },
    ]);
    expect(s).toContain(`détail absent : ${n(7000)} tk`);
  });

  test('aucune écriture → null', () => {
    expect(renderCacheWritesByMonth([{ startedAt: null, cacheWrites: { tokens5m: 0, tokens1h: 0, tokensUnknown: 0 } }])).toBeNull();
  });
});

describe('renderReadsLine — ventilation des lectures Read', () => {
  test('affiche le total puis chaque case non vide avec sa part des octets', () => {
    const s = renderReadsLine({
      totalResults: 100,
      totalBytes: 1000000,
      cases: {
        firstRead: { count: 60, bytes: 600000 },
        identicalReread: { count: 25, bytes: 250000 },
        modifiedReread: { count: 10, bytes: 100000 },
        crossAgentDuplicate: { count: 4, bytes: 40000 },
        error: { count: 1, bytes: 10000 },
      },
    });
    expect(s).not.toBeNull();
    expect(s).toContain('Read ×100');
    expect(s).toContain('relectures identiques ×25');
    expect(s).toContain('25 %');
    expect(s).toContain('après modification ×10');
    expect(s).toContain('doublons inter-agents ×4');
    expect(s).toContain('erreurs ×1');
  });

  test('les cases vides ne s’affichent pas ; aucun Read → null', () => {
    const zero = { count: 0, bytes: 0 };
    const s = renderReadsLine({
      totalResults: 3,
      totalBytes: 9000,
      cases: { firstRead: { count: 3, bytes: 9000 }, identicalReread: zero, modifiedReread: zero, crossAgentDuplicate: zero, error: zero },
    });
    expect(s).not.toContain('doublons');
    expect(s).not.toContain('erreurs');
    expect(
      renderReadsLine({ totalResults: 0, totalBytes: 0, cases: { firstRead: zero, identicalReread: zero, modifiedReread: zero, crossAgentDuplicate: zero, error: zero } }),
    ).toBeNull();
  });
});

describe('renderCounterfactual1h — rentabilité du cache 1 h (contrefactuel étiqueté)', () => {
  test('R petit devant W → pas rentable, les deux nombres affichés', () => {
    // R = 100 000 (récupérable), écritures 5 min = 500 000 → W = 400 000 ; gain 115 000 < coût 300 000.
    const s = renderCounterfactual1h({ recoverableTokens: 100000, tokens5m: 500000 });
    expect(s).not.toBeNull();
    expect(s).toContain(`gain ${n(115000)} tk`);
    expect(s).toContain(`coût ${n(300000)} tk`);
    expect(s).toContain('pas rentable');
    expect(s).toContain('premier ordre');
  });

  test('R dominant → rentable', () => {
    // R = 400 000, écritures 5 min = 500 000 → W = 100 000 ; gain 460 000 > coût 75 000.
    const s = renderCounterfactual1h({ recoverableTokens: 400000, tokens5m: 500000 });
    expect(s).toContain('→ rentable');
    expect(s).not.toContain('pas rentable');
  });

  test('aucune écriture 5 min ni expiration récupérable → null', () => {
    expect(renderCounterfactual1h({ recoverableTokens: 0, tokens5m: 0 })).toBeNull();
  });
});

describe('computeLivedGain — projection J6, fourchette jamais un chiffre sec', () => {
  test('aucun tour tiré → fourchette −6 %…−1,4 % (la taxe seule), verdict skip', () => {
    const p = computeLivedGain(0, 1_000_000);
    expect(p).not.toBeNull();
    expect(p!.sharePct).toBe(0);
    expect(p!.lowPct).toBeCloseTo(-6, 6);
    expect(p!.highPct).toBeCloseTo(-1.4, 6);
    expect(p!.verdict).toBe('skip');
  });

  test('moitié de la dépense dans les tours tirés → +21 %…+23,3 %, verdict install', () => {
    const p = computeLivedGain(500_000, 1_000_000);
    expect(p!.sharePct).toBe(50);
    expect(p!.lowPct).toBeCloseTo(21, 6);
    expect(p!.highPct).toBeCloseTo(23.3, 6);
    expect(p!.verdict).toBe('install');
  });

  test('fourchette à cheval sur zéro → verdict uncertain', () => {
    // s = 5 % : basse = 0,05×48 − 0,95×6 = −3,3 ; haute = 0,05×48 − 0,95×1,4 = +1,07.
    const p = computeLivedGain(50_000, 1_000_000);
    expect(p!.lowPct).toBeLessThan(0);
    expect(p!.highPct).toBeGreaterThan(0);
    expect(p!.verdict).toBe('uncertain');
  });

  test('dépense nulle → null (rien à projeter)', () => {
    expect(computeLivedGain(0, 0)).toBeNull();
  });
});

describe('renderLivedGain — section « gain vécu » par dépôt', () => {
  test('affiche part des questions, part de la dépense, fourchette et hypothèses', () => {
    const lines = renderLivedGain({
      turns: 120,
      triggeredTurns: 3,
      triggeredNetTokens: 12_300,
      totalNetTokens: 100_000,
      unattributedNetTokens: 234,
    });
    expect(lines).not.toBeNull();
    const s = lines!.join('\n');
    expect(s).toContain('gain vécu (projection J6, pas une mesure)');
    expect(s).toContain('questions qui tirent 3/120 (2,5 %)');
    expect(s).toContain(`dépense des tours tirés ${n(12300)} tk (12,3 % du net)`);
    expect(s).toContain('entre +0,6 % et +4,7 % du net → installer');
    expect(s).toContain('hypothèses : −48 % (J6) sur les seuls tours tirés (minorant)');
    expect(s).toContain('taxe de présence 1,4–6 % sur tout le reste');
    expect(s).toContain(`non-attribuable ${n(234)} tk compté dans le reste`);
    expect(s).toContain('sous-agent facturé à son tour de lancement');
  });

  test('fourchette négative → « sur ce profil, ne pas installer », écrit tel quel', () => {
    const lines = renderLivedGain({
      turns: 40,
      triggeredTurns: 0,
      triggeredNetTokens: 0,
      totalNetTokens: 500_000,
      unattributedNetTokens: 0,
    });
    const s = lines!.join('\n');
    expect(s).toContain('questions qui tirent 0/40 (0,0 %)');
    expect(s).toContain('entre −6,0 % et −1,4 % du net → sur ce profil, ne pas installer');
  });

  test('dépense nulle → null (pas de section)', () => {
    expect(
      renderLivedGain({ turns: 0, triggeredTurns: 0, triggeredNetTokens: 0, totalNetTokens: 0, unattributedNetTokens: 0 }),
    ).toBeNull();
  });
});

describe('renderAgentBehavior — section « comportement-agent » par dépôt', () => {
  test('composition des gestes, tours agent-seuls, fourchette élargie étiquetée hypothèse', () => {
    const lines = renderAgentBehavior({
      gestureEvents: 12,
      grep: 8,
      bash: 3,
      spawn: 1,
      agentOnlyTurns: 5,
      agentOnlyNetTokens: 10_000,
      triggeredNetTokens: 12_300,
      totalNetTokens: 100_000,
    });
    expect(lines).not.toBeNull();
    const s = lines!.join('\n');
    expect(s).toContain('comportement-agent : recherches d’imports faites à la main ×12');
    expect(s).toContain('motif d’import via Grep ×8');
    expect(s).toContain('via Bash ×3');
    expect(s).toContain('sous-agent missionné graphe ×1');
    expect(s).toContain(`dont tours SANS question de graphe : 5 tour(s) (${n(10000)} tk · 10,0 % du net)`);
    expect(s).toContain('fourchette élargie (hypothèse : un routeur au geste transfère le −48 % J6 — étage NON construit, pas une mesure)');
    // computeLivedGain(12 300 + 10 000, 100 000) : s = 22,3 % → +6,0 % / +9,6 %
    expect(s).toContain('entre +6,0 % et +9,6 % du net → installer');
  });

  test('gestes uniquement sur des tours déjà tirés au prompt → pas de fourchette (rien de neuf à projeter)', () => {
    const lines = renderAgentBehavior({
      gestureEvents: 2,
      grep: 2,
      bash: 0,
      spawn: 0,
      agentOnlyTurns: 0,
      agentOnlyNetTokens: 0,
      triggeredNetTokens: 12_300,
      totalNetTokens: 100_000,
    });
    const s = lines!.join('\n');
    expect(s).toContain('recherches d’imports faites à la main ×2');
    expect(s).toContain('motif d’import via Grep ×2');
    expect(s).not.toContain('via Bash');
    expect(s).not.toContain('fourchette élargie');
    expect(s).toContain('dont tours SANS question de graphe : 0 tour(s)');
  });

  test('aucun geste → null (pas de section)', () => {
    expect(
      renderAgentBehavior({
        gestureEvents: 0,
        grep: 0,
        bash: 0,
        spawn: 0,
        agentOnlyTurns: 0,
        agentOnlyNetTokens: 0,
        triggeredNetTokens: 0,
        totalNetTokens: 100_000,
      }),
    ).toBeNull();
  });
});
