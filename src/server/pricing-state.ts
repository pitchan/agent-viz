'use strict';
// Le barème du serveur : un seul détenteur, lu par la pastille, la carte de prix
// et l'observatoire, remplacé d'un bloc quand un prix est adopté.

import { createPricing } from '../engine/core/pricing.ts';
import type { AdoptedPrices, Pricing } from '../engine/core/pricing.ts';

let current: Pricing = createPricing({});

function currentPricing(): Pricing { return current; }
function applyAdoptedPrices(adopted: AdoptedPrices): void { current = createPricing(adopted); }

export { currentPricing, applyAdoptedPrices };
