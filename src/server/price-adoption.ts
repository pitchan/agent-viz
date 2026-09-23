'use strict';
// Adopter un tarif LiteLLM : le prix est celui que la vigie a relevé, jamais celui
// qu'un appelant fournirait. Le fichier est écrit avant que le barème change :
// un redémarrage retrouve toujours ce que l'onglet a montré.

import type { AdoptedPrice, AdoptedPrices } from '../engine/core/pricing.ts';
import type { KnownDrift } from './pricing.ts';

interface AdoptionDeps {
  driftFor: (model: string) => KnownDrift | null;
  forgetDrift: (model: string) => void;
  read: () => Promise<AdoptedPrices>;
  write: (adopted: AdoptedPrices) => Promise<void>;
  apply: (adopted: AdoptedPrices) => void;
  now: () => Date;
}

interface Adopted { model: string; kind: KnownDrift['kind']; from: string | null }

function createPriceAdoption(deps: AdoptionDeps) {
  return {
    async adopt(model: string): Promise<Adopted | null> {
      const drift = deps.driftFor(model);
      if (drift === null) return null;
      const nouveau = drift.kind === 'modele-nouveau';
      const entry: AdoptedPrice = {
        prices: { ...drift.litellm },
        maxInput: drift.maxInput,
        from: nouveau ? null : drift.firstSeenAt,
        replaces: nouveau || drift.embedded === null ? null : { ...drift.embedded },
        adoptedAt: deps.now().toISOString(),
        source: 'litellm',
      };
      const before = await deps.read();
      const next: AdoptedPrices = { ...before, [model]: [...(before[model] ?? []), entry] };
      await deps.write(next);
      deps.apply(next);
      deps.forgetDrift(model);
      return { model, kind: drift.kind, from: entry.from };
    },
  };
}

export { createPriceAdoption };
export type { Adopted, AdoptionDeps };
