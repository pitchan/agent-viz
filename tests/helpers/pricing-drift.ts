// Une dérive de la vigie telle que l'onglet la reçoit : les tests qui ne regardent
// pas les prix n'ont que le modèle et la nature à choisir.
import type { Drift } from '../../src/server/pricing.ts';

export const driftOf = (model: string, kind: Drift['kind']): Pick<Drift, 'model' | 'kind' | 'litellm' | 'embedded'> => ({
  model, kind,
  litellm: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 },
  embedded: kind === 'tarif-different' ? { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 } : null,
});
