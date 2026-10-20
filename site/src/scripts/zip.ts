// ZIP writer for the data export. Store only (method 0, no compression):
// Parquet files are already compressed, and the browser does the work fast.
// No ZIP64: each entry and the full archive must be smaller than 4 GiB.
// File names are UTF-8 (general purpose flag bit 11).
import { crc32 } from './crc32';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LIMIT = 0xffffffff;
const encoder = new TextEncoder();

/** MS-DOS time and date of `d` (local time, 2-second steps). */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Make one ZIP file that holds the entries without compression. */
export function zipStore(entries: ZipEntry[], when = new Date()): Uint8Array<ArrayBuffer> {
  const { time, date } = dosTime(when);
  const items = entries.map((e) => ({ name: encoder.encode(e.name), data: e.data, crc: crc32(e.data) }));
  const localSize = items.reduce((n, it) => n + 30 + it.name.length + it.data.length, 0);
  const centralSize = items.reduce((n, it) => n + 46 + it.name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > LIMIT || items.length > 0xffff) throw new Error('The ZIP file is too large (no ZIP64 support).');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(p, v >>> 0, true);
    p += 4;
  };

  // Local file header + data for each entry.
  const offsets: number[] = [];
  for (const it of items) {
    offsets.push(p);
    u32(0x04034b50);
    u16(10); // version needed: 1.0 (stored)
    u16(0x0800); // flag: UTF-8 names
    u16(0); // method: stored
    u16(time);
    u16(date);
    u32(it.crc);
    u32(it.data.length); // compressed size
    u32(it.data.length); // uncompressed size
    u16(it.name.length);
    u16(0); // extra field length
    out.set(it.name, p);
    p += it.name.length;
    out.set(it.data, p);
    p += it.data.length;
  }

  // Central directory.
  const centralStart = p;
  items.forEach((it, i) => {
    u32(0x02014b50);
    u16(0x031e); // made by: Unix, spec 3.0
    u16(10);
    u16(0x0800);
    u16(0);
    u16(time);
    u16(date);
    u32(it.crc);
    u32(it.data.length);
    u32(it.data.length);
    u16(it.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0o100644 << 16); // external attributes: regular file, rw-r--r--
    u32(offsets[i] as number);
    out.set(it.name, p);
    p += it.name.length;
  });

  // End of central directory record.
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(items.length);
  u16(items.length);
  u32(centralSize);
  u32(centralStart);
  u16(0); // comment length
  return out;
}
