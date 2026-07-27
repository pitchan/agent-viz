'use strict';
// Cost attribution shared by every rule.
//
// netgain prices a session as a whole. A rule must only put a figure on its
// own share, and the only honest way is the session's blended rate — costUsd /
// netTokens — applied to tokens the rule can actually attribute. Both terms
// are measured, so nothing here is a projection.
//
// When netgain only measures bytes (tool output, reads), the conversion goes
// through a NAMED approximation rather than a hidden constant: the resulting
// recommendation carries COST_BASIS.APPROX_BYTES, and the ranking never mixes
// the two bases in one ordered list.

const BYTES_PER_TOKEN = 4;

const COST_BASIS = Object.freeze({
  MEASURED_TOKENS: 'jetons-mesures',
  APPROX_BYTES: 'octets-approx-4o-par-jeton',
});

function usdPerToken(session) {
  if (!session.netTokens) return 0;
  return session.costUsd / session.netTokens;
}

function usdForTokens(session, tokens) {
  return usdPerToken(session) * tokens;
}

function usdForBytes(session, bytes) {
  return usdForTokens(session, bytes / BYTES_PER_TOKEN);
}

// pairs: [[session, tokens], ...]. Each session is priced at its OWN rate: a
// $/token rate is only meaningful inside one session's model mix, so there is
// deliberately no "total tokens × global rate" shortcut here.
function sumUsd(pairs) {
  return pairs.reduce((acc, [session, tokens]) => acc + usdForTokens(session, tokens), 0);
}

module.exports = { BYTES_PER_TOKEN, COST_BASIS, usdPerToken, usdForTokens, usdForBytes, sumUsd };
