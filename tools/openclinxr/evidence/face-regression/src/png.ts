/**
 * Minimal 8-bit RGB PNG encoder (filter 0) for the face-regression sheets.
 *
 * Deliberately local and dependency-free: the sheets must be written from the
 * same evidence tools without pulling `sharp` (knip ignoreDependencies lists
 * it) or forking the capture tool's encoder. Crops are written at native
 * pixel size, never resampled.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode 8-bit RGB pixels (`rgb.length === w*h*3`) as a PNG buffer. */
export function encodePngRgb(w: number, h: number, rgb: Uint8Array): Buffer {
  if (rgb.length !== w * h * 3) {
    throw new Error(`encodePngRgb: rgb length ${rgb.length} != ${w * h * 3}`);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw);
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array(idat)), pngChunk("IEND", new Uint8Array(0))]);
}
