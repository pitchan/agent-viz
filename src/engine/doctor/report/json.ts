/** Sérialisation déterministe (clés triées récursivement) pour des rapports diffables. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === 'object' && v !== null) {
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) out[k] = sortKeys(rec[k]);
    return out;
  }
  return v;
}
