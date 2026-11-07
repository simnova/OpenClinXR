#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const fail = (message) => { throw new Error(message); };
const close = (a, b, tolerance = 0.005) => Math.abs(Number(a) - Number(b)) <= tolerance;

function decodePng(file) {
  const data = fs.readFileSync(file);
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`invalid PNG: ${file}`);
  let pos = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const chunks = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.subarray(pos + 4, pos + 8).toString('ascii');
    const body = data.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') chunks.push(body);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || interlace !== 0) fail(`unsupported PNG encoding: ${file}`);
  const channels = ({0: 1, 2: 3, 4: 2, 6: 4})[colorType];
  if (!channels) fail(`unsupported PNG color type ${colorType}: ${file}`);
  const packed = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[source++];
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source++];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y ? pixels[row + x - stride] : 0;
      const upperLeft = y && x >= channels ? pixels[row + x - stride - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upperLeft);
      else fail(`unsupported PNG filter ${filter}: ${file}`);
      pixels[row + x] = value & 255;
    }
  }
  return {width, height, channels, colorType, pixels};
}

function rgbaAt(image, index) {
  const offset = index * image.channels;
  if (image.colorType === 6) return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3]];
  if (image.colorType === 2) return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], 255];
  if (image.colorType === 4) return [image.pixels[offset], image.pixels[offset], image.pixels[offset], image.pixels[offset + 1]];
  return [image.pixels[offset], image.pixels[offset], image.pixels[offset], 255];
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index), hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function recompute(beautyFile, idFile) {
  const beauty = decodePng(beautyFile);
  const id = decodePng(idFile);
  if (beauty.width !== id.width || beauty.height !== id.height) fail('beauty/ID dimensions differ');
  const luminance = [];
  let r = 0, g = 0, b = 0;
  const count = beauty.width * beauty.height;
  for (let i = 0; i < count; i += 1) {
    if (rgbaAt(id, i)[3] < 230) continue;
    const pixel = rgbaAt(beauty, i);
    const rf = pixel[0] / 255, gf = pixel[1] / 255, bf = pixel[2] / 255;
    r += rf; g += gf; b += bf;
    luminance.push(0.2126 * rf + 0.7152 * gf + 0.0722 * bf);
  }
  luminance.sort((a, b0) => a - b0);
  const n = luminance.length;
  return {
    coveragePixels: n,
    p10: percentile(luminance, 0.10),
    p50: percentile(luminance, 0.50),
    p90: percentile(luminance, 0.90),
    meanRBRatio: n ? (r / n) / Math.max(b / n, 1e-9) : 0,
    meanRBSpread: n ? (r - b) / n : 0,
  };
}

function sameRequested(requested, readBack) {
  if (!requested || !readBack) return false;
  return Object.entries(requested).every(([key, value]) => {
    const got = readBack[key];
    if (Array.isArray(value)) return Array.isArray(got) && value.length === got.length && value.every((v, i) => close(v, got[i], 1e-6));
    return typeof value === 'number' ? close(value, got, 1e-6) : value === got;
  });
}

function structuralErrors(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return ['row is not an object'];
  if (!Array.isArray(row.shaderSocketNames) || !row.shaderSocketNames.includes('Melanin') || !row.shaderSocketNames.includes('Absorption Coefficient')) errors.push('shader socket introspection missing');
  if (!Array.isArray(row.parametrizationEnumValues) || !row.parametrizationEnumValues.includes('MELANIN') || !row.parametrizationEnumValues.includes('ABSORPTION')) errors.push('parametrization enum introspection missing');
  if (!Array.isArray(row.cells) || row.cells.length < 4) errors.push('row has fewer than 4 cells');
  for (const [index, cell] of (row.cells || []).entries()) {
    if (!sameRequested(cell.requested, cell.readBack)) errors.push(`cell ${index + 1} requested/read-back mismatch`);
    if (!cell.coverageHairLuminance || !cell.coverageHairColor) errors.push(`cell ${index + 1} is a skeleton`);
    if (Number(cell.coveragePixels) < 100000) errors.push(`cell ${index + 1} mask pixels < 100000`);
    if (Number(cell.coverageHairColor?.meanRBSpread) >= 0.12) errors.push(`cell ${index + 1} mean R-B spread >= 0.12`);
  }
  if (!row.selected || !row.front || !row.idPng || !row.maskOverlay) errors.push('selection artifacts missing');
  return errors;
}

function validate(rowFile) {
  const row = JSON.parse(fs.readFileSync(rowFile, 'utf8'));
  const errors = structuralErrors(row);
  const base = path.dirname(rowFile);
  for (const [index, cell] of (row.cells || []).entries()) {
    const beauty = path.join(base, cell.beautyPng || '');
    const id = path.join(base, cell.idPng || '');
    if (!cell.beautyPng || !fs.existsSync(beauty)) { errors.push(`cell ${index + 1} beauty missing`); continue; }
    if (!cell.idPng || !fs.existsSync(id)) { errors.push(`cell ${index + 1} ID missing`); continue; }
    const actual = recompute(beauty, id);
    if (actual.coveragePixels !== Number(cell.coveragePixels)) errors.push(`cell ${index + 1} coverage mismatch`);
    for (const key of ['p10', 'p50', 'p90']) if (!close(actual[key], cell.coverageHairLuminance?.[key])) errors.push(`cell ${index + 1} ${key} mismatch`);
    for (const key of ['meanRBRatio', 'meanRBSpread']) if (!close(actual[key], cell.coverageHairColor?.[key])) errors.push(`cell ${index + 1} ${key} mismatch`);
  }
  for (const artifact of ['sweep-pigment.png', row.front, row.idPng, row.maskOverlay]) {
    if (!artifact || !fs.existsSync(path.join(base, artifact))) errors.push(`artifact missing: ${artifact}`);
  }
  if (errors.length) fail(errors.join('\n'));
  console.log(`PASS ${row.cells.length} pigment cells; selected=${row.selected.cell}; ok=${row.ok}`);
}

function selfTest() {
  const baseCell = {
    requested: {parametrization: 'MELANIN', melanin: 0.95},
    readBack: {parametrization: 'MELANIN', melanin: 0.95},
    coveragePixels: 120000,
    coverageHairLuminance: {p10: 0.04, p50: 0.08, p90: 0.16},
    coverageHairColor: {meanRBRatio: 1.5, meanRBSpread: 0.05},
  };
  const complete = {shaderSocketNames: ['Melanin', 'Absorption Coefficient'], parametrizationEnumValues: ['MELANIN', 'ABSORPTION'], cells: Array.from({length: 4}, () => structuredClone(baseCell)), selected: {cell: 1}, front: 'front-pigment.png', idPng: 'hair-id-pigment.png', maskOverlay: 'mask-overlay-pigment.png'};
  if (structuralErrors(complete).length) fail('self-test complete fixture rejected');
  const cases = [
    {...complete, cells: []},
    {...complete, cells: complete.cells.slice(0, 3)},
    {...complete, cells: complete.cells.map((c, i) => i ? c : {...c, coveragePixels: 99999})},
    {...complete, cells: complete.cells.map((c, i) => i ? c : {...c, coverageHairColor: {...c.coverageHairColor, meanRBSpread: 0.12}})},
    {...complete, cells: complete.cells.map((c, i) => i ? c : {...c, readBack: {...c.readBack, melanin: 0.9}})},
  ];
  if (cases.some((candidate) => structuralErrors(candidate).length === 0)) fail('self-test failed to reject invalid row');
  console.log('PASS self-test rejects skeleton, short, contaminated, and read-back-mismatched rows');
}

try {
  if (process.argv[2] === '--self-test') selfTest();
  else if (process.argv[2]) validate(path.resolve(process.argv[2]));
  else fail('usage: check-image-pigment.mjs --self-test | <row-pigment.json>');
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
}
