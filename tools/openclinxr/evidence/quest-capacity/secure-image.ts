import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
function crc32(data: Buffer): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, value: Buffer): Buffer { const name = Buffer.from(type); const result = Buffer.alloc(12 + value.length); result.writeUInt32BE(value.length); name.copy(result, 4); value.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([name, value])), 8 + value.length); return result; }
function image(side: number): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(side); header.writeUInt32BE(side, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(side * (side * 4 + 1));
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) { const index = y * (side * 4 + 1) + 1 + x * 4; pixels[index] = x % 256; pixels[index + 1] = y % 256; pixels[index + 2] = (x ^ y) % 256; pixels[index + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
export const IMAGE_FIXTURES = new Map([128, 256, 512].map((side) => { const bytes = image(side); return [side, { bytes, sha256: createHash("sha256").update(bytes).digest("hex") }] as const; }));
