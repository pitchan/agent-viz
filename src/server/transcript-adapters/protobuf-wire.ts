// Lecteur protobuf sans schéma : numéro de champ et valeur brute, rien de plus.
// Antigravity ne publie pas le schéma de sa base ; le sens des champs est posé par l'appelant.

export interface WireField {
  no: number;
  /** Entier (type 0). Absent quand la valeur dépasse ce qu'un `number` représente exactement. */
  varint?: number;
  /** Bloc à longueur préfixée (type 2) : chaîne, octets ou sous-message. */
  bytes?: Uint8Array;
}

const FIXED_WIDTH: Record<number, number> = { 1: 8, 5: 4 };

// Rend `null` au premier octet inattendu : un bloc à moitié compris ne donne aucun chiffre.
export function readFields(buf: Uint8Array): WireField[] | null {
  const fields: WireField[] = [];
  let i = 0;
  while (i < buf.length) {
    const key = readVarint(buf, i);
    if (!key || key.value === null) return null;
    i = key.next;
    const no = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (no === 0) return null;
    if (wire === 0) {
      const v = readVarint(buf, i);
      if (!v) return null;
      i = v.next;
      fields.push(v.value === null ? { no } : { no, varint: v.value });
    } else if (wire === 2) {
      const len = readVarint(buf, i);
      if (!len || len.value === null || len.next + len.value > buf.length) return null;
      fields.push({ no, bytes: buf.subarray(len.next, len.next + len.value) });
      i = len.next + len.value;
    } else {
      const width = FIXED_WIDTH[wire];
      if (width === undefined || i + width > buf.length) return null;
      fields.push({ no });
      i += width;
    }
  }
  return fields;
}

function readVarint(buf: Uint8Array, start: number): { value: number | null; next: number } | null {
  let value = 0n;
  let shift = 0n;
  for (let i = start; i < buf.length && i < start + 10; i++) {
    const byte = buf[i] ?? 0;
    value |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) {
      return { value: value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null, next: i + 1 };
    }
  }
  return null;
}
