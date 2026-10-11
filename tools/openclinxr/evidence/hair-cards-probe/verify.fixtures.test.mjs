#!/usr/bin/env node
// Plain-node fixture test: runs verify.mjs as child process over every fixture.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const V = join(root, 'tools/openclinxr/evidence/hair-cards-probe/verify.mjs');
const F = join(root, 'tools/openclinxr/evidence/hair-cards-probe/fixtures');
const node = process.execPath;
let fails = 0;
function run(args) {
  try {
    const out = execFileSync(node, [V, ...args], { encoding: 'utf8', cwd: root });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}
function check(name, cond) {
  if (!cond) { console.error('MISMATCH: ' + name); fails++; }
  else console.log('ok: ' + name);
}
function expectFailOnly(file, extra, clause) {
  const r = run([join(F, file), ...extra]);
  const ids = [...r.out.matchAll(/FAIL (\S+):/g)].map(m => m[1]);
  check(`${file} exits 1`, r.code === 1);
  check(`${file} only ${clause} (got [${ids}])`, ids.length >= 1 && ids.every(i => i === clause));
}

// generate fixtures first
execFileSync(node, [join(F, 'make-fixtures.mjs')], { cwd: root, stdio: 'inherit' });

check('good.json passes --arms C', run([join(F, 'good.json'), '--arms', 'C']).code === 0);
check('good-all.json passes', run([join(F, 'good-all.json')]).code === 0);
expectFailOnly('bad-tri-high.json', ['--arms', 'C'], 'tri-window');
expectFailOnly('bad-sha-mismatch.json', ['--arms', 'C'], 'sha-matches');
expectFailOnly('bad-no-children.json', [], 'children-added');
expectFailOnly('bad-empty-error.json', [], 'error-on-failure');
expectFailOnly('bad-body-mismatch.json', [], 'body-same');
expectFailOnly('bad-eevee.json', ['--arms', 'C', '--require-lab'], 'lab-provenance');
{
  const forb = JSON.parse(readFileSync(join(F, 'bad-forbidden.json'), 'utf8'));
  const s = forb.arms.C.glbSha256;
  expectFailOnly('bad-forbidden.json', ['--arms', 'C', '--forbid-sha', s], 'forbidden-sha');
}
check('nonexistent exits 2', run([join(F, 'nope-missing.json')]).code === 2);
check('neg-good passes --allow-negative', run([join(F, 'neg-good.json'), '--arms', 'C', '--allow-negative']).code === 0);
check('ok-good.json passes --arms C --allow-negative', run([join(F, 'ok-good.json'), '--arms', 'C', '--allow-negative']).code === 0);
expectFailOnly('bad-tri-derived.json', ['--arms', 'C', '--allow-negative'], 'tri-derived');
expectFailOnly('bad-guides-low.json', ['--arms', 'C', '--allow-negative'], 'guide-count');
expectFailOnly('bad-glb-big.json', ['--arms', 'C', '--allow-negative'], 'size');
expectFailOnly('bad-neg-nonerror.json', ['--arms', 'C', '--allow-negative'], 'negative-honest');
expectFailOnly('neg-no-stage.json', ['--arms', 'C', '--allow-negative'], 'negative-stage');
expectFailOnly('neg-short-error.json', ['--arms', 'C', '--allow-negative'], 'negative-error');
expectFailOnly('ok-no-png.json', ['--arms', 'C', '--allow-negative'], 'png-present');
check('ok:false empty-error still fails without flag', run([join(F, 'bad-empty-error.json')]).code === 1);
// deletion probe: good.json with every field deleted one at a time never exits 0 silently
{
  const g = JSON.parse(readFileSync(join(F, 'good.json'), 'utf8'));
  const tmp = join(tmpdir(), 'hair-probe-del.json');
  const topFields = Object.keys(g);
  for (const f of topFields) {
    const c = JSON.parse(JSON.stringify(g)); delete c[f];
    writeFileSync(tmp, JSON.stringify(c));
    const r = run([tmp, '--arms', 'C']);
    check(`del top ${f} not 0 (got ${r.code})`, r.code !== 0);
  }
  const armFields = Object.keys(g.arms.C);
  for (const f of armFields) {
    const c = JSON.parse(JSON.stringify(g)); delete c.arms.C[f];
    writeFileSync(tmp, JSON.stringify(c));
    const r = run([tmp, '--arms', 'C']);
    check(`del arm ${f} not 0 (got ${r.code})`, r.code !== 0);
  }
}
if (fails) { console.error(`${fails} mismatches`); process.exit(1); }
console.log('all fixture checks passed');
