#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EPS = 0.005;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function close(a, b, eps = EPS) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
}

function expectedFor(cell) {
  const specs = [
    { roughness: 0.45, coat: 0.1, keyWatts: 150, worldStrength: 0.3 },
    { roughness: 0.45, coat: 0.0, keyWatts: 150, worldStrength: 0.3 },
    { roughness: 0.25, coat: 0.1, keyWatts: 0, worldStrength: 0.3 },
    { roughness: 0.25, coat: 0.1, keyWatts: 150, worldStrength: 0.0 },
  ];
  return specs[cell.index - 1];
}

function validateStructure(row) {
  assert(row && typeof row === 'object', 'row must be an object');
  assert(typeof row.ok === 'boolean', 'skeleton row: missing boolean ok');
  assert(row.stage === 'measure', 'skeleton row: stage must be measure');
  assert(Array.isArray(row.cells) && row.cells.length >= 4, 'row must contain at least 4 cells');
  assert(row.cells.length === 4, 'reflection sweep must contain exactly 4 cells');
  for (const [i, cell] of row.cells.entries()) {
    assert(cell.index === i + 1, `cell ${i + 1}: bad index`);
    assert(cell.coveragePixels >= 100000, `cell ${i + 1}: contaminated/small mask coverage`);
    assert(cell.maskMeanRBSpread < 0.12, `cell ${i + 1}: contaminated mask R-B spread`);
    assert(cell.strandsAfter === 50265, `cell ${i + 1}: strandsAfter mismatch`);
    assert(close(cell.radius, 0.0003, 1e-9), `cell ${i + 1}: radius mismatch`);
    assert(cell.amount === 4, `cell ${i + 1}: Amount mismatch`);
    const exp = expectedFor(cell);
    assert(exp, `cell ${i + 1}: unexpected cell`);
    const rb = cell.surfaceReadBack || {};
    for (const [key, value] of Object.entries({
      melanin: 0.95, redness: 0.5, roughness: exp.roughness, radial: 0.2, coat: exp.coat,
    })) assert(close(rb[key], value, 1e-7), `cell ${i + 1}: ${key} read-back mismatch`);
    assert(close(cell.keyWatts, exp.keyWatts, 1e-7), `cell ${i + 1}: key nominal mismatch`);
    assert(close(cell.rimWatts, 40, 1e-7), `cell ${i + 1}: rim nominal mismatch`);
    assert(close(cell.fillWatts, 40, 1e-7), `cell ${i + 1}: fill nominal mismatch`);
    assert(close(cell.worldStrength, exp.worldStrength, 1e-7), `cell ${i + 1}: world mismatch`);
    assert(close(cell.lightReadBack?.keyEnergy, exp.keyWatts * cell.lightScale, 1e-5),
      `cell ${i + 1}: key energy read-back mismatch`);
    assert(close(cell.lightReadBack?.fillEnergy, 40 * cell.lightScale, 1e-5),
      `cell ${i + 1}: fill energy read-back mismatch`);
    assert(close(cell.lightReadBack?.rimEnergy, 40 * cell.lightScale, 1e-5),
      `cell ${i + 1}: rim energy read-back mismatch`);
    assert(close(cell.lightReadBack?.worldStrength, exp.worldStrength, 1e-7),
      `cell ${i + 1}: world read-back mismatch`);
    assert(cell.surfaceSocketNames?.Roughness === 'Roughness', `cell ${i + 1}: roughness socket mismatch`);
    assert(cell.surfaceSocketNames?.['Radial Roughness'] === 'Radial Roughness',
      `cell ${i + 1}: radial socket mismatch`);
    assert(cell.surfaceSocketNames?.Coat === 'Coat', `cell ${i + 1}: coat socket mismatch`);
  }
}

const py = String.raw`
import json, sys
import numpy as np
from PIL import Image
items=json.loads(sys.argv[1]); out=[]
for item in items:
    b=np.asarray(Image.open(item['beauty']).convert('RGB'),dtype=np.float64)/255.0
    i=np.asarray(Image.open(item['id']).convert('RGBA'),dtype=np.float64)/255.0
    m=i[...,3]>=0.9; n=int(m.sum())
    if n:
        lum=(0.2126*b[...,0]+0.7152*b[...,1]+0.0722*b[...,2])[m]
        p=np.percentile(lum,[10,50,90]); rgb=b[m]; ids=i[...,:3][m]
        d={'coveragePixels':n,'p10':float(p[0]),'p50':float(p[1]),'p90':float(p[2]),
           'mean':float(lum.mean()),'rbRatio':float(rgb[:,0].mean()/max(rgb[:,2].mean(),1e-9)),
           'maskMeanRBSpread':float(np.abs(ids[:,0]-ids[:,2]).mean())}
    else: d={'coveragePixels':0,'p10':0,'p50':0,'p90':0,'mean':0,'rbRatio':0,'maskMeanRBSpread':1}
    out.append(d)
print(json.dumps(out))
`;

function recompute(row, rowPath) {
  const base = path.dirname(path.resolve(rowPath));
  const items = row.cells.map(c => ({
    beauty: path.join(base, c.beautyPng), id: path.join(base, c.idPng),
  }));
  for (const item of items) {
    assert(fs.existsSync(item.beauty), `missing beauty PNG: ${item.beauty}`);
    assert(fs.existsSync(item.id), `missing ID PNG: ${item.id}`);
  }
  const proc = spawnSync('python3', ['-c', py, JSON.stringify(items)], { encoding: 'utf8' });
  assert(proc.status === 0, `metric recompute failed: ${proc.stderr || proc.stdout}`);
  return JSON.parse(proc.stdout);
}

function validateMetrics(row, metrics) {
  for (const [i, cell] of row.cells.entries()) {
    const got = metrics[i];
    assert(cell.coveragePixels === got.coveragePixels, `cell ${i + 1}: coveragePixels differs`);
    for (const key of ['p10', 'p50', 'p90', 'mean', 'rbRatio']) {
      assert(close(cell.coverageHairLuminance[key], got[key]), `cell ${i + 1}: ${key} differs by > ${EPS}`);
    }
    assert(close(cell.maskMeanRBSpread, got.maskMeanRBSpread),
      `cell ${i + 1}: mask R-B spread differs by > ${EPS}`);
    assert(close(cell.baselineP50Fraction, got.p50 / 0.19),
      `cell ${i + 1}: baseline p50 fraction mismatch`);
  }
  const gatedOk = row.cells.slice(0, 2).every(c => c.ok === true);
  assert(row.ok === gatedOk, 'row ok does not honestly reflect cells 1-2');
}

function selfTest() {
  const baseCell = i => ({
    index: i, coveragePixels: 100000, maskMeanRBSpread: 0,
    strandsAfter: 50265, radius: 0.0003, amount: 4, lightScale: 0.7711054127039704,
    rimWatts: 40, fillWatts: 40,
    surfaceSocketNames: { Roughness: 'Roughness', 'Radial Roughness': 'Radial Roughness', Coat: 'Coat' },
    ...(() => { const e = expectedFor({index:i}); return {
      keyWatts:e.keyWatts, worldStrength:e.worldStrength,
      surfaceReadBack:{melanin:0.95,redness:0.5,roughness:e.roughness,radial:0.2,coat:e.coat},
      lightReadBack:{keyEnergy:e.keyWatts*0.7711054127039704,fillEnergy:40*0.7711054127039704,
        rimEnergy:40*0.7711054127039704,worldStrength:e.worldStrength},
    }; })(),
  });
  const good = { ok: true, stage: 'measure', cells: [1,2,3,4].map(baseCell) };
  validateStructure(good);
  const reject = (mutate, needle) => {
    const row = structuredClone(good); mutate(row);
    let message = ''; try { validateStructure(row); } catch (e) { message = e.message; }
    assert(message.includes(needle), `self-test expected rejection containing ${needle}, got: ${message}`);
  };
  reject(r => { delete r.ok; }, 'skeleton row');
  reject(r => { r.cells.pop(); }, 'at least 4 cells');
  reject(r => { r.cells[0].maskMeanRBSpread = 0.12; }, 'contaminated mask');
  reject(r => { r.cells[0].coveragePixels = 99999; }, 'contaminated/small mask');
  reject(r => { r.cells[0].surfaceReadBack.roughness = 0.25; }, 'read-back mismatch');
  console.log('SELF-TEST PASS: skeleton, short row, contaminated mask, small mask, and read-back mismatch rejected');
}

try {
  if (process.argv[2] === '--self-test') selfTest();
  else {
    const rowPath = process.argv[2];
    assert(rowPath, 'usage: check-image-refl.mjs <row-refl.json> | --self-test');
    const row = JSON.parse(fs.readFileSync(rowPath, 'utf8'));
    validateStructure(row);
    validateMetrics(row, recompute(row, rowPath));
    for (const c of row.cells) {
      console.log(`cell ${c.index}: p50 fraction of 0.19 = ${c.baselineP50Fraction.toFixed(4)} ok=${c.ok}`);
    }
    console.log(`PASS: ${rowPath} is internally consistent; scientific ok=${row.ok}`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
}
