#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function check(row) {
  assert(row && typeof row === 'object', 'skeleton row rejected');
  assert(typeof row.ok === 'boolean' && ['PASS', 'MISS'].includes(row.claim), 'skeleton row rejected');
  assert(String(row.distanceMethod || '').includes('BVH true signed'), 'vertex-only distance rejected');
  assert(!String(row.distanceMethod).toLowerCase().includes('nearest vertex'), 'vertex-only distance rejected');
  assert(Array.isArray(row.cells) && row.cells.length === 6, 'row must contain exactly P0-P5');
  const ids = row.cells.map((cell) => cell.id);
  assert(ids.join(',') === 'P0,P1,P2,P3,P4,P5', 'row must contain ordered P0-P5 including P5');
  assert(typeof row.p5Explanation === 'string' && row.p5Explanation.includes('Attach Hair Curves to Surface'),
    'P5 missing attachment-precondition explanation');
  assert(row.renderSettings?.hairOnlyMasks === true, 'hair-only render masks required');
  assert(row.surfaceUvMap && row.scalpMask?.vertexGroup, 'surface UV map or scalp mask provenance missing');
  for (const cell of row.cells) {
    assert(cell.id && cell.label && typeof cell.ok === 'boolean', 'skeleton row rejected');
    assert(cell.settings && cell.nodeInputs && cell.socketReadBack && cell.metrics, `${cell.id}: skeleton cell rejected`);
    if (!cell.ok) {
      assert(typeof cell.error === 'string' && cell.error.trim(), `${cell.id}: failed cell lacks verbatim error`);
      continue;
    }
    const metrics = cell.metrics;
    assert(Number.isInteger(metrics.evaluatedCurveCount), `${cell.id}: evaluated curve count missing`);
    assert(metrics.pointsPerCurveHistogram && typeof metrics.pointsPerCurveHistogram === 'object',
      `${cell.id}: point-count histogram missing`);
    assert(Number.isInteger(metrics.rootFartherThan2mmCount), `${cell.id}: root distance count missing`);
    assert(Number.isInteger(metrics.rootsOutsideMaskedRegionCount), `${cell.id}: outside-mask count missing`);
    assert(String(metrics.distanceMethod).includes('BVH true signed'), `${cell.id}: vertex-only distance rejected`);
    assert(cell.renders?.crown_top?.id_png && cell.renders?.front?.id_png, `${cell.id}: renders missing`);
  }
  const p3 = row.cells.find((cell) => cell.id === 'P3');
  if (row.claim === 'PASS') {
    assert(row.ok === true, 'PASS claim requires ok:true');
    assert(p3.ok, 'PASS claim requires successful P3');
    assert(Object.keys(p3.metrics.pointsPerCurveHistogram).length === 1 &&
      p3.metrics.pointsPerCurveHistogram['24'] === p3.metrics.evaluatedCurveCount,
    'pass claim has a mixed point-count histogram');
    assert(Object.values(row.passBars || {}).every(Boolean), 'PASS claim has a missed pass bar');
  } else {
    assert(row.ok === false, 'MISS claim requires ok:false');
  }
  return true;
}

function fixture() {
  const cells = Array.from({ length: 6 }, (_, index) => ({
    id: `P${index}`,
    label: 'fixture',
    ok: true,
    error: '',
    settings: {},
    nodeInputs: {},
    socketReadBack: {},
    metrics: {
      evaluatedCurveCount: index === 0 ? 5 : 1200,
      pointsPerCurveHistogram: { 24: index === 0 ? 5 : 1200 },
      rootFartherThan2mmCount: 0,
      rootsOutsideMaskedRegionCount: 0,
      distanceMethod: 'hair_scene.surface_distance; BVH true signed nearest-surface distance',
    },
    renders: { crown_top: { id_png: 'top.png' }, front: { id_png: 'front.png' } },
  }));
  return {
    ok: true,
    claim: 'PASS',
    distanceMethod: 'hair_scene.surface_distance; BVH true signed nearest-surface distance',
    cells,
    p5Explanation: 'P5 omitted Attach Hair Curves to Surface.',
    renderSettings: { hairOnlyMasks: true },
    surfaceUvMap: 'UVMap',
    scalpMask: { vertexGroup: 'mask' },
    passBars: { all: true },
  };
}

function expectReject(mutator, label) {
  const value = structuredClone(fixture());
  mutator(value);
  let rejected = false;
  try { check(value); } catch { rejected = true; }
  assert(rejected, `self-test did not reject ${label}`);
}

if (process.argv.includes('--self-test')) {
  expectReject((row) => { delete row.claim; }, 'skeleton row');
  expectReject((row) => { row.cells = row.cells.filter((cell) => cell.id !== 'P5'); }, 'row without P5');
  expectReject((row) => { row.cells[3].metrics.pointsPerCurveHistogram = { 1: 2, 24: 1198 }; },
    'pass claim with mixed point-count histogram');
  expectReject((row) => { row.distanceMethod = 'nearest vertex distance'; }, 'vertex-only distance');
  console.log('check-interp self-test: PASS');
  process.exit(0);
}

const input = process.argv[2];
assert(input, 'usage: check-interp.mjs <row-interp.json> | --self-test');
const row = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
check(row);
console.log(`check-interp: PASS (${row.claim}; ok=${row.ok}; cells=${row.cells.length})`);
