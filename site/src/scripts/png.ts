// PNG helpers: add iTXt text chunks (UTF-8) to a PNG file, and convert between
// data URLs and bytes. No library: the PNG chunk format is simple.
// Chunk = length (4 bytes, big endian) + type (4 bytes) + data + CRC-32 of type and data.
import { crc32 } from './crc32';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const encoder = new TextEncoder();

export interface TextEntry {
  /** PNG keyword, for example "Title" or "Description". Latin-1, 1 to 79 characters. */
  keyword: string;
  /** Text in UTF-8. */
  text: string;
}

function isPng(png: Uint8Array): boolean {
  return png.length > 8 + 12 && SIGNATURE.every((b, i) => png[i] === b);
}

/** One iTXt chunk: keyword, 0, compression flag 0, method 0, empty language, 0, empty translated keyword, 0, text. */
function iTxtChunk({ keyword, text }: TextEntry): Uint8Array {
  if (!/^[\x20-\x7e\xa1-\xff]{1,79}$/.test(keyword)) throw new Error(`Bad PNG keyword: ${keyword}`);
  const key = Uint8Array.from(keyword, (ch) => ch.charCodeAt(0));
  const body = encoder.encode(text);
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key, 0);
  // The 5 bytes after the keyword are all 0 (separator, flag, method, two empty strings).
  data.set(body, key.length + 5);

  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Offset of the IEND chunk, or -1. */
function iendOffset(png: Uint8Array): number {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!);
    if (type === 'IEND') return pos;
    pos += 12 + len;
  }
  return -1;
}

/** Return a copy of `png` with one iTXt chunk per entry, put before the IEND chunk. */
export function addTextChunks(png: Uint8Array, entries: TextEntry[]): Uint8Array {
  if (!isPng(png)) throw new Error('The data is not a PNG file.');
  const at = iendOffset(png);
  if (at < 0) throw new Error('The PNG file has no IEND chunk.');
  const chunks = entries.filter((e) => e.text !== '').map(iTxtChunk);
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + size);
  out.set(png.subarray(0, at), 0);
  let pos = at;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(png.subarray(at), pos);
  return out;
}

export function dataUrlToBytes(url: string): Uint8Array {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) {
    throw new Error('Expected a base64 data URL.');
  }
  const bin = atob(url.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return `data:${mime};base64,${btoa(bin)}`;
}
