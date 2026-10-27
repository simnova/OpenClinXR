#!/usr/bin/env node
// Fixture suite for the hair-cards probe judge (verify.mjs).
// Authored framework is node:test ONLY: the original was a plain node CLI
// script, the subject under test spawns child node/python processes, and
// `node file` / `node --test file` both execute this suite. No vitest
// imports: the root dispatcher routes node:test files to the node group by
// its existing automatic partition.
// Import-safe: no top-level side effects, no process.exit on import, so test
// collectors can load this file. Fixture generation runs in beforeAll.
// Scratch files live in a unique per-invocation mkdtemp dir under
// TMPDIR/tmpdir (reused within this file, removed in afterAll) so concurrent
// runs never share basenames.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before as beforeAll, after as afterAll } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const V = join(root, 'tools/openclinxr/evidence/hair-cards-probe/verify.mjs');
const F = join(root, 'tools/openclinxr/evidence/hair-cards-probe/fixtures');
const node = process.execPath;

const baseTmp = process.env.TMPDIR || tmpdir();
let scratchDir = null;
const counts = { pass: 0, fail: 0 };
function checkIt(name, fn) {
    it(name, () => {
        try {
            fn();
            counts.pass += 1;
        } catch (e) {
            counts.fail += 1;
            throw e;
        }
    });
}

function run(args) {
  try {
    const out = execFileSync(node, [V, ...args], { encoding: 'utf8', cwd: root });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}

function expectFailOnly(file, extra, clause) {
  const r = run([join(F, file), ...extra]);
  const ids = [...r.out.matchAll(/FAIL (\S+):/g)].map(m => m[1]);
  assert.equal(r.code, 1, `${file} exits 1 (got ${r.code}): ${r.out}`);
  assert.ok(
    ids.length >= 1 && ids.every(i => i === clause),
    `${file} only ${clause} (got [${ids}])`,
  );
}

describe('hair-cards-probe fixtures', () => {
  beforeAll(() => {
    scratchDir = mkdtempSync(join(baseTmp, 'hair-probe-'));
    execFileSync(node, [join(F, 'make-fixtures.mjs')], { cwd: root, stdio: 'inherit' });
  });

  afterAll(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = null;
  });

  checkIt('good.json passes --arms C', () => {
    assert.equal(run([join(F, 'good.json'), '--arms', 'C']).code, 0);
  });
  checkIt('good-all.json passes', () => {
    assert.equal(run([join(F, 'good-all.json')]).code, 0);
  });
  checkIt('bad-tri-high.json fails only tri-window', () => {
    expectFailOnly('bad-tri-high.json', ['--arms', 'C'], 'tri-window');
  });
  checkIt('bad-sha-mismatch.json fails only sha-matches', () => {
    expectFailOnly('bad-sha-mismatch.json', ['--arms', 'C'], 'sha-matches');
  });
  checkIt('bad-no-children.json fails only children-added', () => {
    expectFailOnly('bad-no-children.json', [], 'children-added');
  });
  checkIt('bad-empty-error.json fails only error-on-failure', () => {
    expectFailOnly('bad-empty-error.json', [], 'error-on-failure');
  });
  checkIt('bad-body-mismatch.json fails only body-same', () => {
    expectFailOnly('bad-body-mismatch.json', [], 'body-same');
  });
  checkIt('bad-eevee.json fails only lab-provenance', () => {
    expectFailOnly('bad-eevee.json', ['--arms', 'C', '--require-lab'], 'lab-provenance');
  });
  checkIt('bad-forbidden.json fails only forbidden-sha', () => {
    const forb = JSON.parse(readFileSync(join(F, 'bad-forbidden.json'), 'utf8'));
    const s = forb.arms.C.glbSha256;
    expectFailOnly('bad-forbidden.json', ['--arms', 'C', '--forbid-sha', s], 'forbidden-sha');
  });
  checkIt('nonexistent report exits 2', () => {
    assert.equal(run([join(F, 'nope-missing.json')]).code, 2);
  });
  checkIt('neg-good passes --allow-negative', () => {
    assert.equal(run([join(F, 'neg-good.json'), '--arms', 'C', '--allow-negative']).code, 0);
  });
  checkIt('ok-good.json passes --arms C --allow-negative', () => {
    assert.equal(run([join(F, 'ok-good.json'), '--arms', 'C', '--allow-negative']).code, 0);
  });
  checkIt('bad-tri-derived.json fails only tri-derived', () => {
    expectFailOnly('bad-tri-derived.json', ['--arms', 'C', '--allow-negative'], 'tri-derived');
  });
  checkIt('bad-guides-low.json fails only guide-count', () => {
    expectFailOnly('bad-guides-low.json', ['--arms', 'C', '--allow-negative'], 'guide-count');
  });
  checkIt('bad-glb-big.json fails only size', () => {
    expectFailOnly('bad-glb-big.json', ['--arms', 'C', '--allow-negative'], 'size');
  });
  checkIt('bad-neg-nonerror.json fails only negative-honest', () => {
    expectFailOnly('bad-neg-nonerror.json', ['--arms', 'C', '--allow-negative'], 'negative-honest');
  });
  checkIt('neg-no-stage.json fails only negative-stage', () => {
    expectFailOnly('neg-no-stage.json', ['--arms', 'C', '--allow-negative'], 'negative-stage');
  });
  checkIt('neg-short-error.json fails only negative-error', () => {
    expectFailOnly('neg-short-error.json', ['--arms', 'C', '--allow-negative'], 'negative-error');
  });
  checkIt('ok-no-png.json fails only png-present', () => {
    expectFailOnly('ok-no-png.json', ['--arms', 'C', '--allow-negative'], 'png-present');
  });
  checkIt('ok:false empty-error still fails without flag', () => {
    assert.equal(run([join(F, 'bad-empty-error.json')]).code, 1);
  });
  checkIt('deletion probe: every deleted top-level field still fails', () => {
    const g = JSON.parse(readFileSync(join(F, 'good.json'), 'utf8'));
    const tmp = join(scratchDir, 'hair-probe-del.json');
    for (const f of Object.keys(g)) {
      const c = JSON.parse(JSON.stringify(g));
      delete c[f];
      writeFileSync(tmp, JSON.stringify(c));
      const r = run([tmp, '--arms', 'C']);
      assert.notEqual(r.code, 0, `del top ${f} exits ${r.code}, expected non-zero`);
    }
  });
  checkIt('deletion probe: every deleted arm C field still fails', () => {
    const g = JSON.parse(readFileSync(join(F, 'good.json'), 'utf8'));
    const tmp = join(scratchDir, 'hair-probe-del.json');
    for (const f of Object.keys(g.arms.C)) {
      const c = JSON.parse(JSON.stringify(g));
      delete c.arms.C[f];
      writeFileSync(tmp, JSON.stringify(c));
      const r = run([tmp, '--arms', 'C']);
      assert.notEqual(r.code, 0, `del arm ${f} exits ${r.code}, expected non-zero`);
    }
  });
});
