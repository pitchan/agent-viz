'use strict';
// Boundary to the netgain analysis engine: the observatory receives `engine` as
// a value, so rules and orchestration stay testable with a stand-in.
//
// The engine is not a separate package: its source lives in `src/engine/` and its
// build output ships inside this very package (see `files` in package.json), so
// any install that has the product has the engine.
//
// The imports below are static: a missing compiled engine file stops this module
// from loading, so no caller ever holds an absent engine.

import { discoverSessions, parseSince } from '../../engine/core/index.ts';
import type { PriceTable, SessionRef } from '../../engine/core/index.ts';
import { scanSession, netTokens } from '../../engine/doctor/index.ts';
import type { SessionReport } from '../../engine/doctor/index.ts';
import { PRODUCT_VERSION } from '../../engine/version.ts';
import { currentPricing } from '../pricing-state.ts';

export interface Engine {
  discoverSessions: typeof discoverSessions;
  parseSince: typeof parseSince;
  // Le barème est celui du serveur au moment de l'appel : une adoption vaut pour le scan suivant.
  scanSession: (ref: SessionRef, maxPrompts: number) => Promise<SessionReport>;
  netTokens: typeof netTokens;
  priceTable: () => PriceTable;
  // The product's own version: the engine ships inside it and has none of its own.
  version: string;
}

export const engine: Engine = {
  discoverSessions, parseSince, netTokens,
  scanSession: (ref, maxPrompts) => scanSession(ref, maxPrompts, currentPricing()),
  priceTable: () => currentPricing().priceTable(),
  version: PRODUCT_VERSION,
};
