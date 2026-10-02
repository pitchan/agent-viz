// Décode une ligne `gen_metadata` de la base d'Antigravity : un appel au modèle, ses jetons.
// Le format n'est pas documenté. Chaque contrôle ci-dessous refuse le bloc plutôt que de
// rendre un chiffre dont le sens aurait changé avec une mise à jour d'agy.

import { readFields } from './protobuf-wire.ts';
import type { WireField } from './protobuf-wire.ts';
import type { RawUsage } from '../../engine/core/events.ts';

export type GenMetadata =
  | { ok: true; id: string; model: string; usage: RawUsage }
  | { ok: false; reason: string };

// Numéros relevés sur des sessions réelles (agy 1.2.13), sous `.1` puis sous `.1.4`.
const CALL = 1;
const USAGE = 4;
const MODEL = 19;
const INPUT = 2;
const OUTPUT = 3;
const CACHE_READ = 5;
const CALL_ID = 7;
const THINKING = 9;
const VISIBLE = 10;
// Un numéro hors de cet ensemble signale un format que personne n'a mesuré.
const KNOWN_USAGE_FIELDS = new Set([1, INPUT, OUTPUT, CACHE_READ, 6, CALL_ID, 8, THINKING, VISIBLE, 11]);

const utf8 = new TextDecoder('utf-8', { fatal: true });

function text(field: WireField | undefined): string | null {
  if (!field?.bytes) return null;
  try { return utf8.decode(field.bytes); } catch { return null; }
}

function single(fields: WireField[], no: number): WireField | undefined | null {
  const hits = fields.filter(f => f.no === no);
  return hits.length > 1 ? null : hits[0];
}

function subMessage(fields: WireField[], no: number): WireField[] | null {
  const field = single(fields, no);
  return field?.bytes ? readFields(field.bytes) : null;
}

export function decodeGenMetadata(blob: Uint8Array): GenMetadata {
  const top = readFields(blob);
  const call = top && subMessage(top, CALL);
  const usage = call && subMessage(call, USAGE);
  if (!call || !usage) return { ok: false, reason: 'bloc illisible' };

  const unknown = usage.find(f => !KNOWN_USAGE_FIELDS.has(f.no));
  if (unknown) return { ok: false, reason: `champ inconnu .1.4.${unknown.no}` };
  const numbers = usage.map(f => f.no);
  if (new Set(numbers).size !== numbers.length) return { ok: false, reason: 'champ répété sous .1.4' };

  // Un entier absent vaut zéro en protobuf ; un entier trop grand pour être lu n'en est pas un.
  const count = (no: number): number | null => {
    const field = usage.find(f => f.no === no);
    if (!field) return 0;
    return field.varint ?? null;
  };
  const input = count(INPUT);
  const output = count(OUTPUT);
  const cacheRead = count(CACHE_READ);
  const thinking = count(THINKING);
  const visible = count(VISIBLE);
  if (input === null || output === null || cacheRead === null || thinking === null || visible === null) {
    return { ok: false, reason: 'compteur illisible sous .1.4' };
  }
  if (input + cacheRead === 0) return { ok: false, reason: 'entrée nulle' };
  if (output !== thinking + visible) {
    return { ok: false, reason: `sortie ${output} ≠ réflexion ${thinking} + réponse ${visible}` };
  }

  const model = text(single(call, MODEL) ?? undefined);
  if (!model) return { ok: false, reason: 'modèle absent' };
  const id = text(usage.find(f => f.no === CALL_ID));
  if (!id) return { ok: false, reason: "identifiant d'appel absent" };

  return {
    ok: true,
    id,
    model,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead },
  };
}
