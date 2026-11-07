#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const badErrorWords = /skeleton|placeholder|not yet run|TODO/i;
const allowedStages = new Set(['rig', 'sockets', 'sweep', 'idpass', 'select', 'render', 'measure']);
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function recompute(cell) {
  return cell.crownScalpFraction < 0.08 && cell.faceSkinRatio >= 0.5 &&
    cell.volume <= 0.36 && cell.coveragePixels >= 20000;
}

function validateCell(cell, index) {
  for (const key of ['radius', 'readBack', 'strandsAfter', 'volume', 'crownScalpFraction',
    'faceSkinRatio', 'coveragePixels']) {
    assert(numeric(cell?.[key]), `cell ${index} ${key} must be numeric`);
  }
  for (const key of ['mean', 'p10', 'p50', 'p90']) {
    assert(numeric(cell?.coverageHairLuminance?.[key]), `cell ${index} coverageHairLuminance.${key} must be numeric`);
  }
  assert(typeof cell.feasible === 'boolean', `cell ${index} feasible must be boolean`);
  assert(Math.abs(cell.readBack - cell.radius) <= 1e-6, `cell ${index} readBack mismatch`);
  assert(cell.feasible === recompute(cell), `cell ${index} feasible disagrees with rule`);
}

function selectedByRule(cells) {
  const feasible = cells.filter(recompute);
  if (!feasible.length) return null;
  return feasible.toSorted((a, b) =>
    Math.abs(a.volume - 0.294) - Math.abs(b.volume - 0.294) || a.radius - b.radius)[0];
}

function validate(row, rowPath, { skipFiles = false } = {}) {
  assert(row && typeof row === 'object' && !Array.isArray(row), 'row must be an object');
  assert(typeof row.ok === 'boolean', 'row.ok must be boolean');
  assert(allowedStages.has(row.stage), 'invalid stage');
  assert(typeof row.blenderVersion === 'string' && /^5\.1\.1(?:\b|$)/.test(row.blenderVersion),
    'blenderVersion must report Blender 5.1.1');
  if (!row.ok) {
    assert(typeof row.error === 'string' && row.error.length >= 20, 'failure error must be at least 20 chars');
    assert(/Traceback|Error/.test(row.error), 'failure error must include Traceback or Error');
    assert(!badErrorWords.test(row.error), 'failure error contains placeholder language');
    if (row.stage === 'select') {
      assert(Array.isArray(row.cells) && row.cells.length === 3, 'select failure requires 3 cells');
      row.cells.forEach(validateCell);
      assert(row.cells.every((cell) => !recompute(cell)), 'select failure cells must all be infeasible');
    }
    return;
  }
  assert(row.stage === 'measure', 'successful row stage must be measure');
  assert(row.error === '', 'successful row error must be empty');
  assert(row.lightCount === 3, 'lightCount must equal 3');
  assert(numeric(row.exposureStops), 'exposureStops must be numeric');
  assert(Array.isArray(row.cells) && row.cells.length === 3, 'successful row requires exactly 3 cells');
  row.cells.forEach(validateCell);
  const expected = selectedByRule(row.cells);
  assert(expected, 'successful row has no feasible cell');
  assert(row.selected && numeric(row.selected.radius), 'selected cell missing');
  assert(Math.abs(row.selected.radius - expected.radius) <= 1e-12, 'selected cell is not the rule minimiser');
  const selected = row.cells.find((cell) => Math.abs(cell.radius - row.selected.radius) <= 1e-12);
  assert(selected, 'selected cell is not in cells');
  assert(selected.coveragePixels >= 20000, 'selected coveragePixels below 20000');
  assert(row.front === 'front-thick.png', 'front must be front-thick.png');
  assert(row.idPng === 'hair-id-thick.png', 'idPng must be hair-id-thick.png');
  if (!skipFiles) {
    const base = path.dirname(path.resolve(rowPath));
    const front = path.join(base, row.front);
    const idPng = path.join(base, row.idPng);
    const sweep = path.join(base, 'sweep-thick.png');
    assert(fs.statSync(front).size >= 300000, 'front-thick.png must be at least 300000 bytes');
    assert(fs.statSync(idPng).size > 0, 'hair-id-thick.png missing or empty');
    assert(fs.statSync(sweep).size > 0, 'sweep-thick.png missing or empty');
    const env = { ...process.env, MISE_TRUSTED_CONFIG_PATHS: process.cwd() };
    const measured = spawnSync('python3', [path.join(here, 'measure.py'), front], {
      cwd: process.cwd(), env, encoding: 'utf8'
    });
    assert(measured.status === 0, `measure.py failed: ${measured.stderr || measured.stdout}`);
    const metrics = JSON.parse(measured.stdout);
    assert(numeric(metrics.volume), 'measure.py volume missing');
    assert(Math.abs(metrics.volume - selected.volume) <= 0.05,
      `final volume ${metrics.volume} differs from selected ${selected.volume}`);
  }
}

function cell(radius, volume, overrides = {}) {
  return {
    radius, readBack: radius, strandsAfter: 50265, volume,
    crownScalpFraction: 0.04, faceSkinRatio: 0.7, coveragePixels: 30000,
    coverageHairLuminance: { mean: 0.2, p10: 0.1, p50: 0.2, p90: 0.3 },
    feasible: true, ...overrides
  };
}

function selfTest() {
  const cells = [cell(0.00015, 0.24), cell(0.0002, 0.293), cell(0.0003, 0.32)];
  const good = { ok: true, stage: 'measure', error: '', blenderVersion: '5.1.1', lightCount: 3,
    exposureStops: -0.375, cells, selected: cells[1], front: 'front-thick.png', idPng: 'hair-id-thick.png' };
  validate(good, '', { skipFiles: true });
  const mustFail = [
    ['selected not minimiser', { ...good, selected: cells[0] }],
    ['2 cells', { ...good, cells: cells.slice(0, 2), selected: cells[1] }],
    ['readBack mismatch', { ...good, cells: [cell(0.00015, 0.24, { readBack: 0.9 }), cells[1], cells[2]] }],
    ['skeleton row', { ok: false, stage: 'sweep', error: 'Error: skeleton row has not run Blender', blenderVersion: '5.1.1' }],
    ['placeholder-error row', { ok: false, stage: 'render', error: 'Error: placeholder render awaiting work', blenderVersion: '5.1.1' }],
  ];
  for (const [name, candidate] of mustFail) {
    let failed = false;
    try { validate(candidate, '', { skipFiles: true }); } catch { failed = true; }
    assert(failed, `self-test fixture unexpectedly passed: ${name}`);
  }
  console.log('PASS self-test: good accepted; 5 invalid fixtures rejected');
}

try {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const rowPath = process.argv[2] || path.join(here, 'row-thick.json');
    validate(JSON.parse(fs.readFileSync(rowPath, 'utf8')), rowPath);
    console.log(`PASS ${rowPath}`);
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
