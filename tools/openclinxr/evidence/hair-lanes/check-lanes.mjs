// Gate checker for hair-lanes-1 row-lanes.json.
// Usage: node tools/openclinxr/evidence/hair-lanes/check-lanes.mjs [--self-test]
// Exit 0 iff every gate PASSES. --self-test plants one violation per gate and
// asserts each is reported MISS (fails otherwise).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E = dirname(fileURLToPath(import.meta.url));
const ROW = join(E, "row-lanes.json");

function fail(id, detail) {
  return { id, status: "MISS", detail };
}
function pass(id, detail) {
  return { id, status: "PASS", detail };
}

const CELLS = ["C0", "C1", "C2", "C3", "C4", "C5", "C6"];

function checkGates(row) {
  const out = [];
  const cells = row.cells || {};
  // G1: 7 cells present, each within 5% of 2000 children, single point count
  {
    const missing = CELLS.filter((c) => !cells[c]);
    if (missing.length) {
      out.push(fail("G1", `missing cells ${missing}`));
    } else {
      const bad = [];
      for (const c of CELLS) {
        const d = cells[c];
        const hist = Object.keys(d.pointsPerCurveHistogram || {});
        if (Math.abs(d.evaluatedCurveCount - 2000) / 2000 > 0.05) bad.push(`${c}:n=${d.evaluatedCurveCount}`);
        if (hist.length !== 1) bad.push(`${c}:hist=${JSON.stringify(hist)}`);
      }
      out.push(bad.length ? fail("G1", bad.join("; ")) : pass("G1", "7 cells, each within 5% of 2000, single point count"));
    }
  }
  // G2: per cell exactly one input differs from C0 (two for C6)
  {
    const keys = ["followSurfaceNormal", "interpolationGuides", "distributionMethod", "densityMask", "distanceToGuides", "partByMeshIslands"];
    const base = cells.C0?.inputs;
    if (!base) {
      out.push(fail("G2", "C0 inputs missing"));
    } else {
      const bad = [];
      for (const c of CELLS) {
        const cur = cells[c]?.inputs;
        if (!cur) { bad.push(`${c}:missing`); continue; }
        const diff = keys.filter((k) => String(cur[k]) !== String(base[k]));
        const want = c === "C6" ? 2 : c === "C0" ? 0 : 1;
        if (diff.length !== want) bad.push(`${c}:diff=${diff.length}(${diff}) want=${want}`);
      }
      out.push(bad.length ? fail("G2", bad.join("; ")) : pass("G2", "C1..C5 differ by exactly one input, C6 by two"));
    }
  }
  // G3: C0 reproduces CH (inside within +-3 points of 22.2%, CV within +-0.1 of 0.85)
  {
    const d = cells.C0;
    if (!d) {
      out.push(fail("G3", "C0 missing"));
    } else {
      const insidePct = d.insideBodyFrac * 100;
      const okIn = Math.abs(insidePct - 22.2) <= 3.0;
      const okCv = Math.abs(d.rootDensityCV - 0.85) <= 0.1;
      out.push(okIn && okCv
        ? pass("G3", `C0 inside ${insidePct.toFixed(2)}% vs 22.2; CV ${d.rootDensityCV.toFixed(3)} vs 0.85`)
        : fail("G3", `C0 inside ${insidePct.toFixed(2)}% (bar 19.2-25.2); CV ${d.rootDensityCV} (bar 0.75-0.95)`));
    }
  }
  return out;
}

function plantViolation(id, row) {
  const r = JSON.parse(JSON.stringify(row));
  const C = (c) => r.cells[c];
  switch (id) {
    case "G1": C("C3").evaluatedCurveCount = 500; break;
    case "G2": C("C2").inputs.followSurfaceNormal = true; break;
    case "G3": C("C0").insideBodyFrac = 0.45; break;
    default: throw new Error("unknown gate " + id);
  }
  return r;
}

const GATE_IDS = ["G1", "G2", "G3"];

if (process.argv.includes("--self-test")) {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  let failures = 0;
  for (const id of GATE_IDS) {
    const mutated = plantViolation(id, row);
    const env = { ...process.env, CHECK_LANES_ROW: JSON.stringify(mutated) };
    let output = "";
    let code = 0;
    try {
      output = execFileSync(process.execPath, [fileURLToPath(import.meta.url)],
        { env: { ...env, CHECK_LANES_STDIN: "1" }, encoding: "utf8" });
    } catch (err) {
      code = err.status ?? 1;
      output = (err.stdout ?? "") + (err.stderr ?? "");
    }
    const caught = code !== 0 && output.includes(id) && output.includes("MISS");
    console.log(`${caught ? "PASS" : "FAIL"} self-test ${id} (checker exits MISS: ${caught})`);
    if (!caught) failures++;
  }
  if (failures) {
    console.log(`SELF-TEST FAILURES: ${failures}`);
    process.exit(1);
  }
  console.log("SELF-TEST ALL CAUGHT");
} else if (process.env.CHECK_LANES_STDIN === "1" && process.env.CHECK_LANES_ROW) {
  const row = JSON.parse(process.env.CHECK_LANES_ROW);
  const results = checkGates(row);
  for (const r of results) console.log(`${r.id}::${r.status} ${r.detail}`);
  if (results.some((r) => r.status === "MISS")) process.exit(1);
} else {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  const results = checkGates(row);
  for (const r of results) console.log(`${r.id}::${r.status} ${r.detail}`);
  if (results.some((r) => r.status === "MISS")) process.exit(1);
}
