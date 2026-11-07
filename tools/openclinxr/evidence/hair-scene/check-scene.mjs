#!/usr/bin/env node
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const canonicalPath = join(here, 'fingerprint-canonical.json');
const cli = join(here, 'hair_scene_cli.py');
const target = join(repo, 'tools/openclinxr/evidence/hair-search2/best-1024.png');

function canonical() {
  return JSON.parse(readFileSync(canonicalPath, 'utf8'));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validate_fingerprint(row) {
  const expected = canonical();
  const got = row?.fingerprint;
  if (!got) return {ok: false, error: 'row has no fingerprint'};
  const checks = [
    ['head vertex count', got.headVertexCount, expected.headVertexCount],
    ['editable curve count', got.editableGeometry?.curveCount,
      expected.editableGeometry?.curveCount],
    ['evaluated curve count', got.evaluatedGeometry?.curveCount,
      expected.evaluatedGeometry?.curveCount],
    ['modifier stack', got.modifierStack, expected.modifierStack],
    ['light count', got.lights?.length, expected.lights?.length],
  ];
  for (const [name, actual, wanted] of checks) {
    if (!same(actual, wanted)) {
      return {ok: false, error: `${name} differs: got ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`};
    }
  }
  return {ok: true};
}

function blender(out, extra = []) {
  const result = spawnSync('blender', ['--background', '--python', cli, '--',
    '--out', out, ...extra], {
    cwd: repo,
    env: {...process.env, MISE_TRUSTED_CONFIG_PATHS: repo},
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || '') + (result.stdout || ''));
  }
  const value = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
  if (!value.ok) throw new Error(value.error || 'Blender result reported ok:false');
  return value;
}

function imageComparison(actual, id) {
  const script = String.raw`
import json, sys
import numpy as np
from PIL import Image
a=np.asarray(Image.open(sys.argv[1]).convert('RGB'),dtype=np.float64)/255.0
b=np.asarray(Image.open(sys.argv[2]).convert('RGB'),dtype=np.float64)/255.0
mask=np.asarray(Image.open(sys.argv[3]).convert('RGBA'),dtype=np.uint8)[...,3]>=230
lum=.2126*a[...,0]+.7152*a[...,1]+.0722*a[...,2]
p=np.percentile(lum[mask],[10,50,90]) if mask.any() else [0,0,0]
print(json.dumps({'meanAbsPixelDiff':float(np.abs(a-b).mean()),'p10':float(p[0]),'p50':float(p[1]),'p90':float(p[2]),'maskPx':int(mask.sum())}))
`;
  const result = spawnSync('python3', ['-c', script, actual, target, id], {
    cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), `hair-scene-self-test-${process.pid}-`));
  const firstDir = join(root, 'first');
  const secondDir = join(root, 'second');
  try {
    const first = blender(firstDir, ['--views', 'front', '--size', '1024',
      '--samples', '64', '--geometry-test']);
    const second = blender(secondDir, ['--fingerprint-only']);
    if (!same(first.fingerprint, second.fingerprint)) {
      throw new Error('separate Blender processes produced different fingerprints');
    }
    const accepted = validate_fingerprint({fingerprint: first.fingerprint});
    if (!accepted.ok) throw new Error(accepted.error);
    const mutated = structuredClone(first.fingerprint);
    mutated.headVertexCount += 1;
    if (validate_fingerprint({fingerprint: mutated}).ok) {
      throw new Error('validate_fingerprint accepted a mutated head vertex count');
    }
    const comparison = imageComparison(first.renders.front.png,
      first.renders.front.id_png);
    const targetMetrics = {p50: 0.09237803921568627, maskPx: 226311};
    const assertions = {
      fingerprintsIdentical: true,
      mutatedFingerprintRejected: true,
      meanAbsPixelDiffPass: comparison.meanAbsPixelDiff < 1 / 255,
      p50Pass: Math.abs(comparison.p50 - targetMetrics.p50) <= 0.005,
      maskPxPass: Math.abs(comparison.maskPx - targetMetrics.maskPx) /
        targetMetrics.maskPx <= 0.01,
      editableRoundtripPass:
        first.geometryTest.identityRoundtripMaxErrorMm < 0.01,
      surfaceQueryPass: first.geometryTest.surfaceDistancesFinite &&
        first.geometryTest.surfaceNormalsFinite &&
        first.geometryTest.usesEvaluatedHeadBVHTree &&
        !first.geometryTest.vertexOnlyDistanceExposed,
    };
    const ok = Object.values(assertions).every(Boolean);
    const report = {ok, assertions, comparison,
      geometryTest: first.geometryTest, fingerprint: first.fingerprint};
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ok: false, error: String(error?.stack || error)}, null, 2) + '\n');
    process.exitCode = 1;
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const path = process.argv[2];
    if (!path) {
      process.stderr.write('usage: check-scene.mjs --self-test | <row-scene.json>\n');
      process.exitCode = 2;
    } else {
      const row = JSON.parse(readFileSync(resolve(path), 'utf8'));
      const result = validate_fingerprint(row);
      const ok = Boolean(row.ok) && result.ok;
      process.stdout.write(JSON.stringify({ok, fingerprint: result}, null, 2) + '\n');
      if (!ok) process.exitCode = 1;
    }
  }
}
