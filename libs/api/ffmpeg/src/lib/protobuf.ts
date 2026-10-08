/** A decoded protobuf field: dotted path of field numbers → value. */
export interface PbField {
  path: string;
  type: 'varint' | 'f64' | 'f32' | 'bytes';
  value: bigint | number | Uint8Array;
}

const readVarint = (b: Uint8Array, start: number): [bigint, number] => {
  let result = 0n;
  let shift = 0n;
  let i = start;
  for (;;) {
    if (i >= b.length) throw new Error('truncated varint');
    const byte = b[i++] as number;
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [result, i];
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
};

/**
 * Schema-less protobuf decoder: nested messages are detected by trying to decode length-delimited
 * fields; fields are reported with their full path (e.g. "3.3.4.1.2").
 */
export const decodeProtobuf = (b: Uint8Array, prefix = '', depth = 0): PbField[] | null => {
  const out: PbField[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 0;
  try {
    while (i < b.length) {
      const [key, next] = readVarint(b, i);
      i = next;
      const field = Number(key >> 3n);
      const wire = Number(key & 7n);
      if (field === 0) return null;
      const path = `${prefix}${field}`;
      if (wire === 0) {
        const [v, n] = readVarint(b, i);
        i = n;
        out.push({ path, type: 'varint', value: v });
      } else if (wire === 1) {
        if (i + 8 > b.length) return null;
        out.push({ path, type: 'f64', value: view.getFloat64(i, true) });
        i += 8;
      } else if (wire === 5) {
        if (i + 4 > b.length) return null;
        out.push({ path, type: 'f32', value: view.getFloat32(i, true) });
        i += 4;
      } else if (wire === 2) {
        const [len, n] = readVarint(b, i);
        i = n;
        const end = i + Number(len);
        if (end > b.length) return null;
        const sub = b.subarray(i, end);
        i = end;
        const nested = depth < 10 && sub.length ? decodeProtobuf(sub, `${path}.`, depth + 1) : null;
        if (nested) out.push(...nested);
        else out.push({ path, type: 'bytes', value: sub });
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }
  return out;
};

/** Minimal encoder used by tests to build synthetic messages. */
export const encodeProtobuf = (
  fields: { field: number; value: number | bigint | string | Uint8Array; wire?: 'f64' | 'f32' }[],
): Uint8Array => {
  const parts: number[] = [];
  const varint = (v: bigint) => {
    let x = v;
    do {
      let byte = Number(x & 0x7fn);
      x >>= 7n;
      if (x) byte |= 0x80;
      parts.push(byte);
    } while (x);
  };
  for (const f of fields) {
    if (f.wire === 'f64' || f.wire === 'f32') {
      varint(BigInt((f.field << 3) | (f.wire === 'f64' ? 1 : 5)));
      const buf = new DataView(new ArrayBuffer(f.wire === 'f64' ? 8 : 4));
      if (f.wire === 'f64') buf.setFloat64(0, Number(f.value), true);
      else buf.setFloat32(0, Number(f.value), true);
      parts.push(...new Uint8Array(buf.buffer));
    } else if (typeof f.value === 'number' || typeof f.value === 'bigint') {
      varint(BigInt(f.field << 3));
      varint(BigInt(f.value));
    } else {
      const bytes = typeof f.value === 'string' ? new TextEncoder().encode(f.value) : f.value;
      varint(BigInt((f.field << 3) | 2));
      varint(BigInt(bytes.length));
      parts.push(...bytes);
    }
  }
  return Uint8Array.from(parts);
};
