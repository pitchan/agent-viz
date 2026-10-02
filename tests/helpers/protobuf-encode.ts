// Encodeur protobuf minimal pour fabriquer des blocs de test : les vrais blocs d'Antigravity
// portent des identifiants de session, ils ne sont pas versés au dépôt.

function varint(n: number): number[] {
  const out: number[] = [];
  let v = BigInt(n);
  do {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    out.push(v > 0n ? b | 0x80 : b);
  } while (v > 0n);
  return out;
}

export function pbVarint(no: number, value: number): Uint8Array {
  return Uint8Array.from([...varint(no << 3), ...varint(value)]);
}

export function pbBytes(no: number, payload: Uint8Array | string): Uint8Array {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  return Uint8Array.from([...varint((no << 3) | 2), ...varint(bytes.length), ...bytes]);
}

export function pbMessage(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap(p => [...p]));
}
