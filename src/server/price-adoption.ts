'use strict';
// Adopter un tarif de la page d'Anthropic : le prix est celui que la vigie a relevé,
// jamais celui qu'un appelant fournirait. Le fichier est écrit avant que le barème change :
// un redémarrage retrouve toujours ce que l'onglet a montré.

import type { AdoptedPrice, AdoptedPrices, ModelPrices } from '../engine/core/pricing.ts';
import type { KnownDrift } from './pricing.ts';

interface AdoptionDeps {
  forgetDrift: (model: string) => void;
  read: () => Promise<AdoptedPrices>;
  write: (adopted: AdoptedPrices) => Promise<void>;
  apply: (adopted: AdoptedPrices) => void;
  now: () => Date;
}

/** Une dérive dont la fenêtre de contexte est connue : sans elle, la jauge de la pastille serait fausse. */
type ApplicableDrift = KnownDrift & { maxInput: number };
const isApplicable = (d: KnownDrift): d is ApplicableDrift => d.maxInput !== null;

interface Adopted { model: string; kind: KnownDrift['kind']; from: string | null; prices: ModelPrices }

function createPriceAdoption(deps: AdoptionDeps) {
  return {
    async adopt(drift: ApplicableDrift): Promise<Adopted> {
      const { model } = drift;
      const nouveau = drift.kind === 'modele-nouveau';
      const entry: AdoptedPrice = {
        prices: { ...drift.official },
        maxInput: drift.maxInput,
        from: nouveau ? null : drift.firstSeenAt,
        replaces: nouveau || drift.embedded === null ? null : { ...drift.embedded },
        adoptedAt: deps.now().toISOString(),
        source: 'anthropic',
      };
      const before = await deps.read();
      const next: AdoptedPrices = { ...before, [model]: [...(before[model] ?? []), entry] };
      await deps.write(next);
      deps.apply(next);
      deps.forgetDrift(model);
      return { model, kind: drift.kind, from: entry.from, prices: entry.prices };
    },
  };
}

export { createPriceAdoption, isApplicable };
export type { Adopted, AdoptionDeps, ApplicableDrift };
