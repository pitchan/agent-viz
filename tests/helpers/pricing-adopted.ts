// Un tarif appliqué tel que l'onglet le reçoit : les tests qui ne regardent pas
// les prix n'ont que le modèle et la nature à choisir.
import type { PricingAdoptedPayload } from '../../src/web/viz-pricing-adopted-alert.ts';

export const adoptedOf = (model: string, kind: PricingAdoptedPayload['kind']): PricingAdoptedPayload => ({
  model, kind,
  prices: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 },
});
