// Gate checker for hair-part-1 row-part.json.
// Usage: node tools/openclinxr/evidence/hair-part/check-part.mjs [--self-test]
// Exit 0 iff every gate PASSES. --self-test builds an all-pass row from the
// real one, asserts it passes, then plants one violation per gate and asserts
// each is reported MISS (fails otherwise).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E = dirname(fileURLToPath(import.meta.url));
const ROW = join(E, "row-part.json");
const TEST = join(E, "test_show_through.mjs");

function fail(id, detail) {
  return { id, status: "MISS", detail };
}
function pass(id, detail) {
  return { id, status: "PASS", detail };
}

function bestCell(row) {
  let best = null;
  for (const [cell, d] of Object.entries(row.cells)) {
    if (best === null || d.partPx < row.cells[best].partPx) best = cell;
  }
  return best;
}

function checkGates(row, opts = {}) {
  const out = [];
  const testFile = opts.testFile || TEST;
  const C = row.cells || {};
  // G1: C0 reproduces blend-1 on guides6: part within ±3 of 47, IoU ±0.01 of 0.622
  {
    const c0 = C.C0 || {};
    const dp = Math.abs((c0.partPx ?? 1e9) - 47);
    const di = Math.abs((c0.iou ?? -1) - 0.622);
    out.push(dp <= 3 && di <= 0.01
      ? pass("G1", `C0 part=${c0.partPx} IoU=${c0.iou}`)
      : fail("G1", `C0 part=${c0.partPx} (|d|=${dp}, bar<=3) IoU=${c0.iou} (|d|=${di.toFixed(4)}, bar<=0.01)`));
  }
  // G2: determinism x2, counts within 2% of 50000, 32 pts, 0 NaN, 0 crossings
  {
    const bad = [];
    for (const [cell, d] of Object.entries(C)) {
      if (d.sha256_twice_equal !== true) bad.push(`${cell}:twice!=true`);
      if (Math.abs(d.evaluatedCurveCount - 50000) / 50000 > 0.02) bad.push(`${cell}:n=${d.evaluatedCurveCount}`);
      if (d.pointsPerCurve !== 32) bad.push(`${cell}:ppc=${d.pointsPerCurve}`);
      if (d.nanCount !== 0) bad.push(`${cell}:nan=${d.nanCount}`);
      if (d.crossings !== 0) bad.push(`${cell}:cross=${d.crossings}`);
    }
    out.push(bad.length ? fail("G2", bad.join("; ")) : pass("G2", "4 cells x2-equal, n=50000, 32pts, 0NaN, 0cross"));
  }
  // G3: best cell part <= 30 px and its ID show-through <= 3%
  {
    const b = bestCell(row);
    const d = C[b] || {};
    const ok = (d.partPx ?? 1e9) <= 30 && (d.idShow ?? 1) <= 0.03;
    out.push(ok
      ? pass("G3", `best=${b} part=${d.partPx} idshow=${d.idShow}`)
      : fail("G3", `best=${b} part=${d.partPx} (bar<=30) idshow=${d.idShow} (bar<=0.03)`));
  }
  // G4: no ridge, per cell fracLe6mm >= 0.99
  {
    const bad = [];
    for (const [cell, d] of Object.entries(C)) {
      const f = d.ridge && d.ridge.fracLe6mm;
      if (!(f >= 0.99)) bad.push(`${cell}:frac=${f}`);
    }
    out.push(bad.length ? fail("G4", bad.join("; ")) : pass("G4", "ridge frac>=0.99 all cells"));
  }
  // G5: best cell no regression: IoU>=0.612, width_rms<=0.231, eye gap within ±0.02H of C0
  {
    const b = bestCell(row);
    const d = C[b] || {};
    const c0 = C.C0 || {};
    const de = Math.abs((d.eyeOurs ?? 1e9) - (c0.eyeOurs ?? -1e9));
    const ok = (d.iou ?? -1) >= 0.612 && (d.widthRms ?? 1e9) <= 0.231 && de <= 0.02;
    out.push(ok
      ? pass("G5", `best=${b} IoU=${d.iou} w=${d.widthRms} dEye=${de.toFixed(4)}`)
      : fail("G5", `best=${b} IoU=${d.iou} (bar>=0.612) w=${d.widthRms} (bar<=0.231) dEye=${de.toFixed(4)} (bar<=0.02)`));
  }
  // G6: show-through tests pass
  {
    try {
      execFileSync("node", [testFile], { stdio: "pipe", encoding: "utf8" });
      out.push(pass("G6", "test_show_through.mjs exits 0"));
    } catch (err) {
      out.push(fail("G6", `test run failed: ${String(err.message || err).slice(0, 160)}`));
    }
  }
  return out;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

if (process.argv.includes("--self-test")) {
  const real = JSON.parse(readFileSync(ROW, "utf8"));
  const failures = [];
  const expect = (id, cond, detail) => {
    console.log((cond ? "PASS" : "FAIL") + " self:" + id + (detail ? " :: " + detail : ""));
    if (!cond) failures.push(id);
  };
  // all-pass row: patch the honest G3 MISS into a pass (C2 part/idshow)
  const good = clone(real);
  good.cells.C2.partPx = 25;
  good.cells.C2.idShow = 0.02;
  good.cells.C3.partPx = 38;
  const r0 = checkGates(good);
  expect("clean-passes", r0.every((g) => g.status === "PASS"), JSON.stringify(r0.map((g) => g.status)));
  const plants = {
    G1: (r) => { r.cells.C0.partPx = 99; },
    G2: (r) => { r.cells.C1.nanCount = 7; },
    G3: (r) => { r.cells.C2.partPx = 99; r.cells.C2.idShow = 0.5; r.cells.C3.partPx = 99; r.cells.C3.idShow = 0.5; },
    G4: (r) => { r.cells.C0.ridge.fracLe6mm = 0.5; },
    G5: (r) => { r.cells.C2.iou = 0.1; },
    G6: null, // planted via bogus test file below
  };
  for (const [gate, plant] of Object.entries(plants)) {
    if (gate === "G6") {
      const r = checkGates(good, { testFile: join(E, "no-such-test.mjs") });
      const g = r.find((x) => x.id === "G6");
      expect("plant-G6", g && g.status === "MISS", g && g.detail);
    } else {
      const mutated = clone(good);
      plant(mutated);
      const r = checkGates(mutated);
      const g = r.find((x) => x.id === gate);
      expect("plant-" + gate, g && g.status === "MISS", g && `${g.status} ${g.detail}`);
    }
  }
  if (failures.length) {
    console.log("SELF-TEST FAILURES: " + failures.join(","));
    process.exit(1);
  }
  console.log("check-part self-test: all planted violations caught");
} else {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  const res = checkGates(row);
  for (const g of res) console.log(`${g.status} ${g.id} :: ${g.detail}`);
  process.exit(res.every((g) => g.status === "PASS") ? 0 : 1);
}
