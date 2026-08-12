/**
 * Budget de réponse (spec §2.1) : une carte qui répond 15 Ko recrée le
 * problème qu'elle prétend résoudre. Défaut ~2 Ko, pagination par offset,
 * toute coupe annotée `+N omitted` — structurel, pas optionnel.
 */

export interface BudgetOptions {
  offset?: number;
  limit?: number;
  budgetBytes?: number;
}

export interface BudgetSlice<T> {
  items: T[];
  total: number;
  omitted: number;
  note?: string;
}

const DEFAULT_BUDGET_BYTES = 2048;
/** Marge pour l'enveloppe JSON ({items,total,omitted,note}). */
const ENVELOPE_BYTES = 64;

export function budgetSlice<T>(all: T[], options: BudgetOptions): BudgetSlice<T> {
  const offset = options.offset ?? 0;
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const candidates = all.slice(offset);

  const items: T[] = [];
  let bytes = 0;
  for (const item of candidates) {
    if (options.limit !== undefined && items.length >= options.limit) break;
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
    // Jamais une réponse vide en silence : le premier élément passe toujours.
    if (items.length > 0 && bytes + itemBytes + ENVELOPE_BYTES > budgetBytes) break;
    items.push(item);
    bytes += itemBytes;
  }

  const omitted = candidates.length - items.length;
  const slice: BudgetSlice<T> = { items, total: all.length, omitted };
  if (omitted > 0) slice.note = `+${omitted} omitted`;
  return slice;
}
