// CRC-32 (ISO 3309, polynomial 0xEDB88320), as PNG chunks and ZIP entries use it.
// png.ts uses it for the iTXt chunks. The ZIP writer of the data export can use it too.

let table: Uint32Array | null = null;

function makeTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

/**
 * CRC-32 of `bytes`. To calculate the CRC of data in parts, give the result
 * of the previous part as `crc`.
 */
export function crc32(bytes: Uint8Array, crc = 0): number {
  const t = (table ??= makeTable());
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  return ~c >>> 0;
}
