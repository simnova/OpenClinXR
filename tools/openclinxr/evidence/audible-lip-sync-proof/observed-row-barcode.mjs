/** Compact bottom barcode for observed-row identity. Not a clock, PTS, or sync claim. */
export const ROW_BARCODE_VERSION = 1;
export const ROW_BARCODE_MAGIC = 0xa11f;
export const ROW_BARCODE_CELL_PX = 8;
export const ROW_BARCODE_STRIP_PX = 48;
export const ROW_BARCODE_VIEWPORT = 1024;
export const ROW_BARCODE_BIT_COUNT = 112;

function requireUint(value, bits, label) {
  if (!Number.isInteger(value) || value < 0 || value > (2 ** bits) - 1) throw new Error("row-barcode-overflow:" + label);
  return value;
}

function generation16(generation) {
  if (typeof generation !== "string" || generation.length === 0) throw new Error("row-barcode-overflow:generation");
  const token = generation.split(":").at(-1);
  if (!token || !/^[0-9]+$/.test(token)) throw new Error("row-barcode-overflow:generation");
  return requireUint(Number(token), 16, "generation");
}

function pushBits(bits, value, width) {
  for (let i = width - 1; i >= 0; i -= 1) bits.push(Math.floor(value / (2 ** i)) % 2);
}

function readBits(bits, offset, width) {
  let value = 0;
  for (let i = 0; i < width; i += 1) value = value * 2 + (bits[offset + i] ? 1 : 0);
  return value;
}

function crc16(bits, end) {
  let crc = 0xffff;
  for (let i = 0; i < end; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | (bits[i + b] ? 1 : 0);
    crc ^= byte;
    for (let b = 0; b < 8; b += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

export function encodeObservedRowMarker(row) {
  const callbackSerial = requireUint(row?.callbackSerial, 32, "callbackSerial");
  const nodeSerial = requireUint(row?.nodeSerial, 16, "nodeSerial");
  const generation = row?.generation;
  const genN = generation16(generation);
  const bits = [];
  pushBits(bits, ROW_BARCODE_MAGIC, 16);
  pushBits(bits, ROW_BARCODE_VERSION, 8);
  pushBits(bits, 0, 8);
  pushBits(bits, callbackSerial, 32);
  pushBits(bits, genN, 16);
  pushBits(bits, nodeSerial, 16);
  if (bits.length !== 96) throw new Error("row-barcode-layout");
  const checksum = crc16(bits, 96);
  pushBits(bits, checksum, 16);
  if (bits.length !== ROW_BARCODE_BIT_COUNT) throw new Error("row-barcode-layout");
  const width = bits.length * ROW_BARCODE_CELL_PX;
  if (width > ROW_BARCODE_VIEWPORT) throw new Error("row-barcode-overflow:width");
  const x0 = Math.floor((ROW_BARCODE_VIEWPORT - width) / 2);
  const y0 = ROW_BARCODE_VIEWPORT - ROW_BARCODE_STRIP_PX;
  return {
    bits,
    version: ROW_BARCODE_VERSION,
    checksum,
    generation,
    generationN: genN,
    callbackSerial,
    nodeSerial,
    layout: { cellPx: ROW_BARCODE_CELL_PX, stripPx: ROW_BARCODE_STRIP_PX, bitCount: bits.length, x0, y0, viewport: ROW_BARCODE_VIEWPORT },
  };
}

export function decodeObservedRowBits(bits) {
  if (!Array.isArray(bits) || bits.length !== ROW_BARCODE_BIT_COUNT) throw new Error("row-barcode-missing");
  if (bits.some((b) => b !== 0 && b !== 1)) throw new Error("row-barcode-corrupt");
  const magic = readBits(bits, 0, 16);
  const version = readBits(bits, 16, 8);
  if (magic !== ROW_BARCODE_MAGIC || version !== ROW_BARCODE_VERSION) throw new Error("row-barcode-corrupt");
  const callbackSerial = readBits(bits, 32, 32);
  const generationN = readBits(bits, 64, 16);
  const nodeSerial = readBits(bits, 80, 16);
  const checksum = readBits(bits, 96, 16);
  if (checksum !== crc16(bits, 96)) throw new Error("row-barcode-corrupt");
  return { callbackSerial, generationN, nodeSerial, version, checksum };
}

export function sampleBarcodeBitsFromRgba(rgba, width, height, layout = encodeObservedRowMarker({ callbackSerial: 0, generation: "0:0:0", nodeSerial: 0 }).layout) {
  if (!rgba || width !== layout.viewport || height !== layout.viewport) throw new Error("row-barcode-missing");
  const bits = [];
  const cy = layout.y0 + Math.floor(layout.stripPx / 2);
  for (let i = 0; i < layout.bitCount; i += 1) {
    const cx = layout.x0 + i * layout.cellPx + Math.floor(layout.cellPx / 2);
    const o = (cy * width + cx) * 4;
    if (o + 2 >= rgba.length) throw new Error("row-barcode-missing");
    const luma = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3;
    bits.push(luma >= 128 ? 1 : 0);
  }
  return bits;
}

export function decodeObservedRowMarkerFromRgba(rgba, width, height, layout) {
  return decodeObservedRowBits(sampleBarcodeBitsFromRgba(rgba, width, height, layout));
}

/** Map a decoded nonce to the unique raw row. Suffix collision is refusal, not identity. */
export function resolveObservedRowFromMarker(decoded, rows) {
  if (!decoded || !Array.isArray(rows)) throw new Error("row-barcode-missing");
  const matches = [];
  const seen = new Set();
  for (const row of rows) {
    if (row?.callbackSerial !== decoded.callbackSerial || row?.nodeSerial !== decoded.nodeSerial) continue;
    let genN;
    try { genN = generation16(row.generation); } catch { continue; }
    if (genN !== decoded.generationN) continue;
    if (seen.has(row.generation)) continue;
    seen.add(row.generation);
    matches.push(row);
  }
  if (matches.length !== 1) throw new Error("row-barcode-missing");
  return matches[0];
}
