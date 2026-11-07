#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const die = (message) => { throw new Error(message); };
const close = (a, b, label) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.005) {
    die(`${label} mismatch: row=${a} recomputed=${b}`);
  }
};

function validateRow(row, requireFiles = true, base = '.') {
  if (!row || typeof row !== 'object') die('skeleton row: not an object');
  if (!Array.isArray(row.cells) || row.cells.length < 4) die('fewer than 4 cells');
  if (!row.selected || !Number.isInteger(row.selected.cell)) die('skeleton row: no selected cell');
  for (const cell of row.cells) {
    for (const key of ['fillWatts', 'fillReadBackWatts', 'melanin', 'melaninReadBack',
      'redness', 'rednessReadBack', 'coveragePixels', 'coverageHairLuminance',
      'redBlueRatio', 'meanRedBlueSpread', 'faceLR', 'volume', 'strandsAfter']) {
      if (!(key in cell)) die(`skeleton row: cell ${cell.cell ?? '?'} missing ${key}`);
    }
    close(cell.fillWatts, cell.fillReadBackWatts, `cell ${cell.cell} fill read-back`);
    close(cell.melanin, cell.melaninReadBack, `cell ${cell.cell} melanin read-back`);
    close(cell.redness, cell.rednessReadBack, `cell ${cell.cell} redness read-back`);
    if (cell.coveragePixels < 100000) die(`cell ${cell.cell} contaminated/undersized mask`);
    if (cell.meanRedBlueSpread >= 0.20) die(`cell ${cell.cell} contaminated mask spread`);
  }
  if (requireFiles) {
    for (const name of ['sweep-fill.png', 'front-fill.png', 'mask-overlay-fill.png', 'hair-id-fill.png']) {
      if (!fs.existsSync(path.join(base, name))) die(`missing artifact ${name}`);
    }
  }
}

function syntheticRow() {
  const cell = (n) => ({ cell: n, fillWatts: 80, fillReadBackWatts: 80,
    melanin: .95, melaninReadBack: .95, redness: .5, rednessReadBack: .5,
    coveragePixels: 120000, coverageHairLuminance: { p10: .04, p50: .1, p90: .2 },
    redBlueRatio: 1.3, meanRedBlueSpread: .1, faceLR: .8, volume: .224,
    strandsAfter: 50265 });
  const cells = [1, 2, 3, 4].map(cell);
  return { ok: true, cells, selected: cells[0] };
}

function expectReject(mutator, label) {
  const row = syntheticRow();
  mutator(row);
  try { validateRow(row, false); } catch { return; }
  die(`self-test did not reject ${label}`);
}

if (process.argv.includes('--self-test')) {
  validateRow(syntheticRow(), false);
  expectReject((r) => { delete r.selected; r.cells = []; }, 'skeleton row');
  expectReject((r) => { r.cells[0].meanRedBlueSpread = .21; }, 'contaminated mask');
  expectReject((r) => { r.cells.pop(); }, 'fewer than four cells');
  expectReject((r) => { r.cells[0].fillReadBackWatts = 79; }, 'read-back mismatch');
  console.log('check-image-fill self-test: ok');
  process.exit(0);
}

const rowArg = process.argv[2];
if (!rowArg) die('usage: check-image-fill.mjs [--self-test|row-fill.json]');
const rowPath = path.resolve(rowArg);
const base = path.dirname(rowPath);
const row = JSON.parse(fs.readFileSync(rowPath, 'utf8'));
validateRow(row, true, base);

const py = String.raw`
import json, sys
import numpy as np
from PIL import Image
beauty=np.asarray(Image.open(sys.argv[1]).convert('RGB'),dtype=np.float64)/255.0
alpha=np.asarray(Image.open(sys.argv[2]).convert('RGBA'),dtype=np.float64)[...,3]/255.0
mask=alpha>=0.9
rgb=beauty[mask]
lum=(.2126*beauty[...,0]+.7152*beauty[...,1]+.0722*beauty[...,2])
vals=np.percentile(lum[mask],[10,50,90])
ys,xs=np.nonzero(mask); h,w=mask.shape; top=int(ys.min()); eye=int(h*.45)
chin=max(eye+1,min(h,int(eye+.9*(eye-top)))); mid=w//2; le=[]; re=[]
for y in range(eye,chin):
  lx=np.nonzero(mask[y,:mid])[0]; rx=np.nonzero(mask[y,mid:])[0]
  if len(lx) and len(rx): le.append(int(lx.max())); re.append(int(mid+rx.min()))
x0=int(np.median(le))+1; x1=int(np.median(re)); xm=(x0+x1)//2
l=float(lum[eye:chin,x0:xm].mean()); r=float(lum[eye:chin,xm:x1].mean())
print(json.dumps({'coveragePixels':int(mask.sum()),'p10':float(vals[0]),'p50':float(vals[1]),
'p90':float(vals[2]),'redBlueRatio':float(rgb[:,0].mean()/max(rgb[:,2].mean(),1e-9)),
'meanRedBlueSpread':float(np.abs(rgb[:,0]-rgb[:,2]).mean()),'faceLR':min(l,r)/max(l,r,1e-9)}))
`;
const proc = spawnSync('python3', ['-c', py, path.join(base, row.front), path.join(base, row.idPng)],
  { encoding: 'utf8', env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: process.cwd() } });
if (proc.status !== 0) die(`metric recompute failed: ${proc.stderr || proc.stdout}`);
const got = JSON.parse(proc.stdout);
const selected = row.selected;
close(selected.coveragePixels, got.coveragePixels, 'coveragePixels');
for (const k of ['p10', 'p50', 'p90']) close(selected.coverageHairLuminance[k], got[k], k);
for (const k of ['redBlueRatio', 'meanRedBlueSpread', 'faceLR']) close(selected[k], got[k], k);
console.log(`check-image-fill: ok (${row.ok ? 'all bars pass' : 'honest failure row'})`);
