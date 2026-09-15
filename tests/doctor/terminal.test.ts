import { describe, expect, test } from 'vitest';
import { emptyChurnCauses, emptyPauseBuckets, emptyPrefixBreakdown } from '../../src/engine/doctor/aggregators/context.js';
import {
  renderCacheWritesByMonth,
  renderChurnCauses,
  renderCounterfactual1h,
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

  test('les marqueurs diagnostiqués (cache_miss_reason) ont chacun leur étiquette', () => {
    const b = emptyPrefixBreakdown();
    b.markers.systemChanged = { events: 1, tokens: 40000 };
    b.markers.toolsChanged = { events: 2, tokens: 30000 };
    b.markers.messagesChanged = { events: 1, tokens: 20000 };
    const s = renderPrefixBreakdown(b);
    expect(s).toContain(`bloc système modifié ×1 (${n(40000)} tk)`);
    expect(s).toContain(`bloc d’outils modifié ×2 (${n(30000)} tk)`);
    expect(s).toContain(`historique modifié ×1 (${n(20000)} tk)`);
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

  test('dominant → étiquette laboratoire + les 3 gestes', () => {
    const causes = emptyChurnCauses();
    causes.prefixChange = { events: 5, tokens: 200000 };
    causes.expiration = { events: 1, tokens: 40000 };
    const lines = renderPrefixAdvice(causes, emptyPrefixBreakdown());
    expect(lines).not.toBeNull();
    const s = lines!.join('\n');
    expect(s).toContain('conseil');
    expect(s).toContain('mesurés en laboratoire');
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
