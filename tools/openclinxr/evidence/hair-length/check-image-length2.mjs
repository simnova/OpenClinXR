#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const expected = [1.0, 1.3, 1.5, 1.7];
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function passes(cell, controlPenetration) {
  const m = cell.metrics;
  return m.lengthBelowChinFrac >= 0.46 && m.lengthBelowChinFrac <= 0.56 &&
    cell.locksSplit <= 3 && m.p50 <= 0.12 && m.p10 >= 0.025 &&
    m.face >= 0.55 && m.face <= 0.70 && cell.strandsAfter === 50265 &&
    m.meanRBSpread < 0.20 && m.maskPx >= 100000 &&
    cell.penetrationM <= controlPenetration + 0.001;
}

function validate(row, baseDir, files = true) {
  assert(Array.isArray(row.cells), "cells must be an array");
  assert(row.cells.length === 4, "exactly four rendered cells required");
  row.cells.forEach((cell, index) => {
    assert(close(cell.lengthMultiple, expected[index], 1e-9), `cell ${index} requested multiple mismatch`);
    assert(close(cell.lengthReadBack, expected[index], 1e-6), `cell ${index} read-back mismatch`);
    assert(cell.strandsAfter === 50265, `cell ${index} strandsAfter mismatch`);
    assert(Number.isFinite(cell.penetrationM), `cell ${index} penetration missing`);
    assert(Number.isFinite(cell.penetrationExcludingFirst5mmM), `cell ${index} root-excluded penetration missing`);
    assert(Number.isInteger(cell.locksSplit), `cell ${index} locksSplit missing`);
  });
  const control = row.cells[0];
  const m = control.metrics;
  assert(close(m.p50, 0.077, 0.01), "control p50 reproduction failure");
  assert(close(m.p10, 0.034, 0.01), "control p10 reproduction failure");
  assert(close(m.lengthBelowChinFrac, 0.269, 0.02), "control length reproduction failure");
  assert(close(m.face, 0.649, 0.02), "control face reproduction failure");
  assert(row.lightCount === 3, "rig lightCount must be 3");
  const passing = row.cells.filter(cell => passes(cell, row.controlPenetrationM));
  if (passing.length) {
    assert(row.ok === true, "row must be ok when a cell passes");
    assert(close(row.selectedMultiple, passing[0].lengthMultiple, 1e-9), "selection is not smallest passing multiple");
  } else {
    assert(row.ok === false, "row must be false when no cell passes");
  }
  if (files) {
    for (const name of ["sweep-length2.png", "front-length2.png", "side-length2.png", "mask-overlay-length2.png"]) {
      const file = path.join(baseDir, name);
      assert(fs.existsSync(file), `missing ${name}`);
      assert(fs.statSync(file).size > 10000, `${name} is implausibly small`);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const metrics = {lengthBelowChinFrac: 0.50, p10: 0.034, p50: 0.077, p90: 0.25,
    face: 0.649, meanRBSpread: 0.05, maskPx: 126868};
  const cells = expected.map((lengthMultiple, index) => ({lengthMultiple, lengthReadBack: lengthMultiple,
    strandsAfter: 50265, penetrationM: 0.002, penetrationExcludingFirst5mmM: 0.001,
    locksSplit: 1, metrics: {...metrics, lengthBelowChinFrac: index ? 0.50 : 0.269}}));
  validate({ok: true, cells, lightCount: 3, controlPenetrationM: 0.002, selectedMultiple: 1.3}, ".", false);
  console.log("ok self-test");
} else {
  const input = process.argv[2];
  if (!input) throw new Error("usage: check-image-length2.mjs <row-length2.json>");
  const absolute = path.resolve(input);
  validate(JSON.parse(fs.readFileSync(absolute, "utf8")), path.dirname(absolute));
  console.log(`ok ${input}`);
}
