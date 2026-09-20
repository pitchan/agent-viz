// Le contrat de la table des remedes : chaque motif ALERTANT a une
// entree EXPLICITE — un remede complet, ou `null` qui dit « absence deliberee ».
// C'est ce qui distingue un motif sans remede honnete d'un oubli de developpement.
import { expect, test } from 'vitest';
import { REMEDES, remedyFor } from '../../src/web/observatory/remedies.ts';
import { PATTERNS } from '../../src/engine/watchdog/invocation-patterns.ts';
import type { Alert } from '../../src/engine/watchdog/detector.ts';

const alertants = PATTERNS.filter(p => p.workstationSetting).map(p => p.id).sort();

test('la table couvre exactement les motifs alertants — ni trou, ni fantome', () => {
  expect(Object.keys(REMEDES).sort()).toEqual(alertants);
});

test('tout remede non-null porte une consigne francaise et un extrait a coller', () => {
  for (const [id, remede] of Object.entries(REMEDES)) {
    if (remede === null) continue;
    expect(remede.consigne && remede.consigne.length > 20, `${id} : consigne vide`).toBeTruthy();
    expect(remede.extrait && remede.extrait.includes('\n'), `${id} : extrait vide ou d une ligne`).toBeTruthy();
    expect(remede.extrait, `${id} : extrait inacheve`).not.toMatch(/TODO|TBD/);
  }
});

test('le filet vaut null : sa cause n est pas caracterisee', () => {
  expect(REMEDES['inv-bash-unbalanced-quote']).toBe(null);
});

test('remedyFor ne repond que pour un appel mal forme a motif remediable', () => {
  const remede = remedyFor({ type: 'badInvocation', patternId: 'inv-bash-windows-path-unquoted' });
  expect(remede && remede.consigne).toBeTruthy();
  expect(remedyFor({ type: 'badInvocation', patternId: 'inv-bash-unbalanced-quote' })).toBe(null);
  expect(remedyFor({ type: 'badInvocation', patternId: 'inv-motif-de-demain' })).toBe(null);
  expect(remedyFor({ type: 'loop', toolName: 'Bash' } as unknown as Pick<Alert, 'type' | 'patternId'>), 'pas de remede generique invente pour les types sans motif').toBe(null);
});
