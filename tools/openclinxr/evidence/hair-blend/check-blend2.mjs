// Gate checker for hair-blend-2 v2/row-blend.json.
// Usage: node tools/openclinxr/evidence/hair-blend/check-blend2.mjs [--self-test]
// Exit 0 iff every gate PASSES. --self-test plants one violation per gate and
// asserts each is reported MISS (fails otherwise).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E = dirname(fileURLToPath(import.meta.url));
const ROW = join(E, "v2", "row-blend.json");

function fail(id, detail) {
  return { id, status: "MISS", detail };
}
function pass(id, detail) {
  return { id, status: "PASS", detail };
}

function checkGates(row) {
  const out = [];
  const g = row.gates || {};
  const B = (row.passes || {}).B || {};
  const A = (row.passes || {}).A || {};
  {
    const ok = B.sha256_twice_equal === true && A.sha256_twice_equal === true;
    out.push(ok ? pass("G1", `sha256 stable x2 (A+B), B=${String(B.sha256).slice(0, 16)}`)
      : fail("G1", `twice_equal A=${A.sha256_twice_equal} B=${B.sha256_twice_equal}`));
  }
  {
    const bad = [];
    for (const [tag, m, req] of [["A", A, 2000], ["B", B, 50000]]) {
      if (Math.abs(m.evaluatedCurveCount - req) / req > 0.02) bad.push(`${tag}:n=${m.evaluatedCurveCount}`);
      if (m.pointsPerCurve !== 32) bad.push(`${tag}:ppc=${m.pointsPerCurve}`);
      if (m.nanCount !== 0) bad.push(`${tag}:nan=${m.nanCount}`);
    }
    out.push(bad.length ? fail("G2", bad.join("; ")) : pass("G2", "A=2000 B=50000 exact, 32 pts, 0 NaN"));
  }
  {
    const c = B.crossings;
    out.push(c === 0 ? pass("G3", "0 part crossings in front of apex") : fail("G3", `crossings=${c}`));
  }
  {
    const m = B.rootToCapMm || {};
    const cv = B.rootDensityCV;
    const ok = m.mean >= 2.5 && m.mean <= 3.5 && cv <= 0.30;
    out.push(ok ? pass("G4", `rootCapMean=${m.mean}mm cv=${cv}`)
      : fail("G4", `mean=${m.mean} (bar 2.5-3.5) cv=${cv} (bar <=0.30)`));
  }
  {
    const p = B.g5p || {};
    const ok = p.insideHeadFinal === 0 && p.insideGarmentMaxFinal <= 0.005;
    out.push(ok ? pass("G5p", `head=${p.insideHeadFinal} garments<=${p.insideGarmentMaxFinal}`)
      : fail("G5p", `head=${p.insideHeadFinal} (bar 0) garments=${p.insideGarmentMaxFinal} (bar <=0.005), raw head=${p.insideHeadRaw}`));
  }
  {
    const l = B.lanes || {};
    const ok = l.showRest <= 0.10 && l.gutters <= 3;
    out.push(ok ? pass("G7", `showRest=${l.showRest} gutters=${l.gutters}`)
      : fail("G7", `showRest=${l.showRest} (bar <=0.10) gutters=${l.gutters} (bar <=3)`));
  }
  {
    const v = B.g8 || {};
    const ok = v.fracWithin4mm >= 0.90;
    out.push(ok ? pass("G8", `frac=${v.fracWithin4mm} (n=${v.n})`)
      : fail("G8", `frac=${v.fracWithin4mm} (bar >=0.90), medDev=${v.medianDevMm}mm`));
  }
  {
    const t = B.turnRate || {};
    const ok = t.p95 <= 10 && t.max <= 40;
    out.push(ok ? pass("G9", `p95=${t.p95} max=${t.max} deg/cm`)
      : fail("G9", `p95=${t.p95} (bar <=10) max=${t.max} (bar <=40)`));
  }
  {
    const v = B.g10 || {};
    const ok = v.dip <= 0.15;
    out.push(ok ? pass("G10", `dip=${v.dip}`)
      : fail("G10", `dip=${v.dip} (bar <=0.15), center=${v.centerMean} side=${v.sideMean}`));
  }
  for (const r of out) {
    const stored = g[r.id] && g[r.id].status;
    if (stored && stored !== r.status) {
      return [fail("GATES", `stored ${r.id}=${stored} != recomputed ${r.status}`)];
    }
  }
  return out;
}

function plantViolation(id, row) {
  const c = JSON.parse(JSON.stringify(row));
  if (id === "G1") c.passes.B.sha256_twice_equal = false;
  if (id === "G2") c.passes.B.evaluatedCurveCount = 40000;
  if (id === "G3") c.passes.B.crossings = 7;
  if (id === "G4") c.passes.B.rootDensityCV = 0.99;
  if (id === "G5p") c.passes.B.g5p.insideHeadFinal = 0.01;
  if (id === "G7") c.passes.B.lanes.gutters = 99;
  if (id === "G8") c.passes.B.g8.fracWithin4mm = 0.1;
  if (id === "G9") c.passes.B.turnRate.p95 = 99;
  if (id === "G10") c.passes.B.g10.dip = 0.9;
  return c;
}

const GATE_IDS = ["G1", "G2", "G3", "G4", "G5p", "G7", "G8", "G9", "G10"];

if (process.argv.includes("--self-test")) {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  let failures = 0;
  for (const id of GATE_IDS) {
    const mutated = plantViolation(id, row);
    const env = { ...process.env, CHECK_BLEND_ROW: JSON.stringify(mutated) };
    let output = "";
    let code = 0;
    try {
      output = execFileSync(process.execPath, [fileURLToPath(import.meta.url)],
        { env: { ...env, CHECK_BLEND_STDIN: "1" }, encoding: "utf8" });
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
} else if (process.env.CHECK_BLEND_STDIN === "1" && process.env.CHECK_BLEND_ROW) {
  const row = JSON.parse(process.env.CHECK_BLEND_ROW);
  const results = checkGates(row);
  for (const r of results) console.log(`${r.id}::${r.status} ${r.detail}`);
  if (results.some((r) => r.status === "MISS")) process.exit(1);
} else {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  const results = checkGates(row);
  for (const r of results) console.log(`${r.id}::${r.status} ${r.detail}`);
  if (results.some((r) => r.status === "MISS")) process.exit(1);
}
