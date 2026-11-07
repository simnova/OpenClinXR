#!/usr/bin/env node
import fs from "node:fs";

function fail(message) {
  throw new Error(message);
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail(`${label} must be finite`);
}

export function validate(row) {
  if (!row || row.ok !== true) fail("row must be complete and ok:true");
  if (!Array.isArray(row.cells) || row.cells.length < 4) fail("row requires at least 4 cells");
  for (const [index, cell] of row.cells.entries()) {
    if (!cell || Object.keys(cell).length < 7) fail(`cell ${index} is a skeleton`);
    finite(cell.coveragePixels, `cell ${index} coveragePixels`);
    if (cell.coveragePixels <= 0) fail(`cell ${index} coveragePixels must be positive`);
    for (const key of ["p10", "p50", "p90", "meanRBSpread"])
      finite(cell[key], `cell ${index} ${key}`);
    if (!(cell.p10 <= cell.p50 && cell.p50 <= cell.p90)) fail(`cell ${index} percentiles unordered`);
    if (!Array.isArray(cell.meanRGB) || cell.meanRGB.length !== 3 ||
        cell.meanRGB.some((v) => !Number.isFinite(v))) fail(`cell ${index} meanRGB invalid`);
    if (cell.meanRBSpread >= 0.12) fail(`cell ${index} mean R-B spread must be below 0.12`);
  }
  if (!row.reference) fail("reference metrics missing");
  for (const key of ["coveragePixels", "p10", "p50", "p90", "meanRBSpread"])
    finite(row.reference[key], `reference ${key}`);
  return true;
}

function selfTest() {
  const cell = {rimWatts: 0, coveragePixels: 12, p10: 0.1, p50: 0.2, p90: 0.3,
    meanRGB: [0.2, 0.19, 0.18], meanRBSpread: 0.02};
  const valid = {ok: true, cells: [80, 40, 20, 0].map((rimWatts) => ({...cell, rimWatts})),
    reference: {...cell}};
  validate(valid);
  const rejected = [];
  for (const bad of [
    {...valid, cells: valid.cells.map((c, i) => i ? c : {...c, meanRBSpread: 0.12})},
    {...valid, cells: [{}, ...valid.cells.slice(1)]},
    {...valid, cells: valid.cells.slice(0, 3)},
  ]) {
    try { validate(bad); rejected.push(false); } catch { rejected.push(true); }
  }
  if (!rejected.every(Boolean)) fail("self-test failed to reject an invalid row");
  console.log("self-test: ok (spread, skeleton, and short-row rejection)");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const path = process.argv[2];
  if (!path) fail("usage: check-image-mask.mjs <row-mask.json> | --self-test");
  validate(JSON.parse(fs.readFileSync(path, "utf8")));
  console.log(`validated: ${path}`);
}
