import path from 'node:path';
import type { AdoptedPrice, AdoptedPrices, ModelPrices } from './pricing.ts';

/** Le fichier des prix adoptés, à côté de la base de l'observatoire. */
export function adoptedPricesPath(home: string): string {
  return path.join(home, '.agent-viz', 'prices.json');
}

export type ReadText = (file: string, encoding: 'utf8') => Promise<string>;

// Absent = aucune adoption encore faite, un état normal. Toute autre panne,
// et tout contenu hors forme, remonte : un prix ne se devine pas.
export async function readAdoptedPrices(file: string, readFile: ReadText): Promise<AdoptedPrices> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} : JSON invalide (${err instanceof Error ? err.message : String(err)})`);
  }
  return parseAdoptedPrices(json, file);
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function pricesOf(v: unknown): ModelPrices | null {
  if (!isObj(v)) return null;
  const { input, output, cacheCreate, cacheRead } = v;
  if (!isRate(input) || !isRate(output) || !isRate(cacheCreate) || !isRate(cacheRead)) return null;
  return { input, output, cacheCreate, cacheRead };
}

function entryOf(v: unknown, where: string): AdoptedPrice {
  const fail = (why: string): never => { throw new Error(`${where} : ${why}`); };
  if (!isObj(v)) return fail('entrée qui n’est pas un objet');
  const prices = pricesOf(v.prices) ?? fail('prices : quatre tarifs finis ≥ 0 attendus');
  const maxInput = v.maxInput;
  if (typeof maxInput !== 'number' || !Number.isInteger(maxInput) || maxInput <= 0) return fail('maxInput : entier > 0 attendu');
  const from = v.from;
  if (from !== null && !isIso(from)) return fail('from : null ou date ISO attendu');
  const replaces = v.replaces === null ? null : (pricesOf(v.replaces) ?? fail('replaces : null ou quatre tarifs attendus'));
  if ((from === null) !== (replaces === null)) fail('from et replaces sont tous deux null (modèle nouveau) ou tous deux renseignés');
  const adoptedAt = v.adoptedAt;
  if (!isIso(adoptedAt)) return fail('adoptedAt : date ISO attendue');
  if (v.source !== 'anthropic') fail('source : « anthropic » attendue');
  return { prices, maxInput, from, replaces, adoptedAt, source: 'anthropic' };
}

export function parseAdoptedPrices(json: unknown, origin: string): AdoptedPrices {
  if (!isObj(json)) throw new Error(`${origin} : un objet { modèle: [entrées] } est attendu`);
  const out: Record<string, AdoptedPrice[]> = {};
  for (const [model, list] of Object.entries(json)) {
    if (FORBIDDEN_KEYS.has(model)) throw new Error(`${origin} : clé réservée ${model}`);
    if (!Array.isArray(list)) throw new Error(`${origin} : ${model} : liste d’entrées attendue`);
    out[model] = list.map((e: unknown, i) => entryOf(e, `${origin} : ${model}[${i}]`));
  }
  return out;
}
