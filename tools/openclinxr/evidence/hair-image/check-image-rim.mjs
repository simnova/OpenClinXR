#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const numeric = (v) => typeof v === 'number' && Number.isFinite(v);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const badErrorWords = /skeleton|placeholder|not yet run|TODO/i;
const allowedStages = new Set(['rig', 'sockets', 'sweep', 'idpass', 'select', 'render', 'measure']);

const imageMeasurePy = String.raw`
import json, sys
import numpy as np
from PIL import Image
b = np.asarray(Image.open(sys.argv[1]).convert('RGB'), dtype=np.float64) / 255.0
a = np.asarray(Image.open(sys.argv[2]).convert('RGBA'), dtype=np.float64)[..., 3] / 255.0
if b.shape[:2] != a.shape: raise RuntimeError('beauty and ID dimensions differ')
m = a >= 0.9
y = 0.2126*b[...,0] + 0.7152*b[...,1] + 0.0722*b[...,2]
v = y[m]
if not v.size: raise RuntimeError('ID pass has no alpha>=0.9 pixels')
p = np.percentile(v, [10, 50, 90])
print(json.dumps({'coveragePixels': int(m.sum()), 'p10': float(p[0]), 'p50': float(p[1]), 'p90': float(p[2])}))
`;

const targetMeasurePy = String.raw`
import json, sys
import numpy as np
from PIL import Image
b = np.asarray(Image.open(sys.argv[1]).convert('RGB'), dtype=np.float64) / 255.0
m = np.asarray(Image.open(sys.argv[2]).convert('L'), dtype=np.float64) / 255.0
if b.shape[:2] != m.shape: raise RuntimeError('target and mask dimensions differ')
y = 0.2126*b[...,0] + 0.7152*b[...,1] + 0.0722*b[...,2]
v = y[m >= 0.9]
if not v.size: raise RuntimeError('target mask has no pixels >=0.9')
p = np.percentile(v, [10, 50, 90])
print(json.dumps({'p10': float(p[0]), 'p50': float(p[1]), 'p90': float(p[2])}))
`;

function pythonJson(program, args) {
  const result = spawnSync('python3', ['-c', program, ...args], {
    cwd: process.cwd(), env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: process.cwd() }, encoding: 'utf8'
  });
  assert(result.status === 0, result.stderr || result.stdout || 'image measurement failed');
  return JSON.parse(result.stdout);
}

function qualifies(cell) {
  const l = cell.coverageHairLuminance;
  return l.p50 <= 0.22 && l.p90 <= 0.55 && l.p10 >= 0.08 && l.p10 <= 0.16;
}

function validateCell(cell, index, base, { skipFiles = false } = {}) {
  for (const key of ['rimWatts', 'rimReadBackWatts', 'radius', 'readBack', 'strandsAfter',
    'volume', 'faceMeanLuminance', 'backgroundLuminance', 'coveragePixels']) {
    assert(numeric(cell?.[key]), `cell ${index} ${key} must be numeric`);
  }
  for (const key of ['p10', 'p50', 'p90']) {
    assert(numeric(cell?.coverageHairLuminance?.[key]), `cell ${index} coverageHairLuminance.${key} must be numeric`);
  }
  assert(close(cell.rimReadBackWatts, cell.rimWatts, 1e-6), `cell ${index} rim scene read-back mismatch`);
  assert(close(cell.radius, 0.0003, 1e-12) && close(cell.readBack, 0.0003, 1e-7), `cell ${index} radius is not pinned`);
  assert(cell.strandsAfter === 50265, `cell ${index} strandsAfter must equal 50265`);
  assert(Math.abs(cell.volume - 0.224) <= 0.01, `cell ${index} volume ${cell.volume} is not within 0.01 of 0.224`);
  assert(cell.faceMeanLuminance >= 0.55 && cell.faceMeanLuminance <= 0.70, `cell ${index} faceMeanLuminance out of range`);
  assert(cell.backgroundLuminance >= 0.45 && cell.backgroundLuminance <= 0.55, `cell ${index} backgroundLuminance out of range`);
  assert(cell.coveragePixels >= 20000, `cell ${index} coverage pixels below 20000`);
  assert(cell.feasible === qualifies(cell), `cell ${index} feasible disagrees with thresholds`);
  assert(typeof cell.beautyPng === 'string' && typeof cell.idPng === 'string', `cell ${index} PNG paths missing`);
  if (!skipFiles) {
    const measured = pythonJson(imageMeasurePy, [path.join(base, cell.beautyPng), path.join(base, cell.idPng)]);
    assert(measured.coveragePixels === cell.coveragePixels, `cell ${index} coverage differs from PNGs`);
    for (const key of ['p10', 'p50', 'p90']) {
      assert(close(measured[key], cell.coverageHairLuminance[key]), `cell ${index} ${key} differs from PNGs`);
    }
  }
}

function expectedSelection(cells) {
  const feasible = cells.filter(qualifies);
  return feasible.length
    ? feasible.toSorted((a, b) => b.rimWatts - a.rimWatts)[0]
    : cells.toSorted((a, b) => a.coverageHairLuminance.p50 - b.coverageHairLuminance.p50)[0];
}

function validate(row, rowPath, { skipFiles = false } = {}) {
  assert(row && typeof row === 'object' && !Array.isArray(row), 'row must be an object');
  assert(typeof row.ok === 'boolean', 'row.ok must be boolean');
  assert(allowedStages.has(row.stage), 'invalid stage');
  assert(typeof row.blenderVersion === 'string' && /^5\.1\.1(?:\b|$)/.test(row.blenderVersion), 'blenderVersion must report 5.1.1');
  assert(Array.isArray(row.cells) && row.cells.length === 4, 'row requires exactly 4 cells');
  const base = path.dirname(path.resolve(rowPath || path.join(here, 'row-rim.json')));
  row.cells.forEach((cell, i) => validateCell(cell, i, base, { skipFiles }));
  assert([80, 40, 20, 0].every((w) => row.cells.some((cell) => close(cell.rimWatts, w))), 'rim sweep must contain 80, 40, 20, 0 W');
  assert(row.lightCount === 3, 'lightCount must equal 3');
  const selected = expectedSelection(row.cells);
  assert(row.selected && close(row.selected.rimWatts, selected.rimWatts), 'selected cell violates selection rule');
  if (!row.ok) {
    assert(typeof row.error === 'string' && row.error.length >= 20, 'failure error must be at least 20 chars');
    assert(/Traceback|Error/.test(row.error), 'failure error must include Traceback or Error');
    assert(!badErrorWords.test(row.error), 'failure error contains skeleton language');
    return;
  }
  assert(row.stage === 'measure' && row.error === '', 'successful row must finish measure without error');
  for (const key of ['p10', 'p50', 'p90']) assert(numeric(row.referenceTriple?.[key]), `referenceTriple.${key} missing`);
  assert(row.front === 'front-rim.png' && row.idPng === 'hair-id-rim.png', 'selected output names differ');
  if (!skipFiles) {
    for (const name of ['front-rim.png', 'hair-id-rim.png', 'sweep-rim.png']) assert(fs.statSync(path.join(base, name)).size > 0, `${name} missing or empty`);
    const target = path.join(process.cwd(), '.openclinxr/scratch/target-views/target-front.png');
    const mask = path.join(process.cwd(), '.openclinxr/scratch/target-views/mask-front.png');
    const triple = pythonJson(targetMeasurePy, [target, mask]);
    for (const key of ['p10', 'p50', 'p90']) assert(close(triple[key], row.referenceTriple[key]), `referenceTriple.${key} differs from target PNG`);
  }
}

function fixtureCell(watts, p50 = 0.2) {
  return { rimWatts: watts, rimReadBackWatts: watts, radius: 0.0003, readBack: 0.0003,
    strandsAfter: 50265, volume: 0.224, faceMeanLuminance: 0.62, backgroundLuminance: 0.5,
    coveragePixels: 30000, coverageHairLuminance: { p10: 0.12, p50, p90: 0.5 },
    beautyPng: `rim-${watts}.png`, idPng: `hair-id-rim-${watts}.png`, feasible: true };
}

function selfTest() {
  const cells = [fixtureCell(80), fixtureCell(40), fixtureCell(20), fixtureCell(0)];
  const good = { ok: true, stage: 'measure', error: '', blenderVersion: '5.1.1', lightCount: 3,
    cells, selected: cells[0], referenceTriple: { p10: 0.05, p50: 0.12, p90: 0.3 },
    front: 'front-rim.png', idPng: 'hair-id-rim.png' };
  validate(good, '', { skipFiles: true });
  const invalid = [
    ['skeleton', { ...good, ok: false, error: 'Error: skeleton row has not run Blender' }],
    ['fewer than 4 cells', { ...good, cells: cells.slice(0, 3) }]
  ];
  for (const [name, candidate] of invalid) {
    let rejected = false;
    try { validate(candidate, '', { skipFiles: true }); } catch { rejected = true; }
    assert(rejected, `self-test did not reject ${name}`);
  }
  const pngTruth = { p10: 0.12, p50: 0.2, p90: 0.5 };
  const altered = { ...pngTruth, p50: 0.19 };
  let mismatchRejected = false;
  try { for (const key of ['p10', 'p50', 'p90']) assert(close(pngTruth[key], altered[key]), `fixture ${key} differs from PNGs`); } catch { mismatchRejected = true; }
  assert(mismatchRejected, 'self-test did not reject percentile mismatch');
  console.log('PASS self-test: skeleton, PNG-percentile mismatch, and short sweep rejected');
}

try {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const rowPath = process.argv[2] || path.join(here, 'row-rim.json');
    validate(JSON.parse(fs.readFileSync(rowPath, 'utf8')), rowPath);
    console.log(`PASS ${rowPath}`);
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
