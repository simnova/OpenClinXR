// Gate checker for hair-children-4 row-children.json.
// Usage: node tools/openclinxr/evidence/hair-children/check-children.mjs [--self-test]
// Exit 0 iff every gate PASSES. --self-test plants one violation per gate and
// asserts each is reported MISS (fails otherwise).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E = dirname(fileURLToPath(import.meta.url));
const ROW = join(E, "final", "row-children.json");

function fail(id, detail) {
  return { id, status: "MISS", detail };
}
function pass(id, detail) {
  return { id, status: "PASS", detail };
}

function checkGates(row) {
  const out = [];
  // G0: d1_diagnosis with (a)-(e) + named cause from a measured pair
  {
    const d = row.d1_diagnosis;
    const hasAll = d && d.a_matrices && d.b_children && d.c_guides && d.d_uv && d.e_visible;
    const muts = row.mutation_log || [];
    const base = muts.find((s) => s.what === "baseline");
    const fix = muts.find((s) => s.what === "no-attach-hand-uv");
    const pair = base && fix && base.children > 0 && fix.children > 0;
    const cause = typeof row.causeD1 === "string" && row.causeD1.length > 20;
    out.push(hasAll && pair && cause
      ? pass("G0", "d1(a-e) present; baseline->hand-uv measured pair; cause named")
      : fail("G0", `d1=${!!hasAll} pair=${!!pair} cause=${!!cause}`));
  }
  // G2: attachment UV range > 0.1 both components, 0 NaN
  {
    const h = row.guidesHandUV || {};
    const ok = h.nan === 0 && (h.uMax - h.uMin) > 0.1 && (h.vMax - h.vMin) > 0.1;
    out.push(ok ? pass("G2", `U[${h.uMin},${h.uMax}] V[${h.vMin},${h.vMax}] nan=0`)
      : fail("G2", JSON.stringify(h)));
  }
  // G3: counts within 5% of requested + single point count per pass
  for (const [tag, want] of [["A", 2000], ["B", 50000]]) {
    const p = row.passes?.[tag];
    const hist = p ? Object.keys(p.pointsPerCurveHistogram || {}) : [];
    const ok = p && Math.abs(p.evaluatedCurveCount - want) / want <= 0.05 && hist.length === 1;
    out.push(ok ? pass(`G3${tag}`, `${p.evaluatedCurveCount} vs ${want}; points {${hist}}`)
      : fail(`G3${tag}`, p ? `${p.evaluatedCurveCount} vs ${want}; hist ${JSON.stringify(hist)}` : "missing pass"));
  }
  // G4: per-guide max <= 3x median
  for (const tag of ["A", "B"]) {
    const p = row.passes?.[tag];
    const ok = p && p.perGuideMax <= 3 * p.perGuideMedian;
    out.push(ok ? pass(`G4${tag}`, `max ${p.perGuideMax} <= 3*median ${p.perGuideMedian}`)
      : fail(`G4${tag}`, p ? `max ${p.perGuideMax} median ${p.perGuideMedian}` : "missing pass"));
  }
  // G5: part discipline
  for (const tag of ["A", "B"]) {
    const p = row.passes?.[tag];
    const ok = p && p.partCrossingPointCount === 0 && p.rootsCorrectIslandFrac >= 0.995;
    out.push(ok ? pass(`G5${tag}`, `cross ${p.partCrossingPointCount}; islandFrac ${p.rootsCorrectIslandFrac}`)
      : fail(`G5${tag}`, p ? `cross ${p.partCrossingPointCount}; islandFrac ${p.rootsCorrectIslandFrac}` : "missing pass"));
  }
  // G6: clearance
  for (const tag of ["A", "B"]) {
    const p = row.passes?.[tag];
    const ok = p && p.insideBodyCount === 0 && p.insideShirtFrac <= 0.005
      && p.bodyDistanceMm.p5 >= 1.5;
    out.push(ok ? pass(`G6${tag}`, `body ${p.insideBodyCount}; shirtFrac ${p.insideShirtFrac}; p5 ${p.bodyDistanceMm.p5}`)
      : fail(`G6${tag}`, p ? `body ${p.insideBodyCount}; shirtFrac ${p.insideShirtFrac}; p5 ${p.bodyDistanceMm?.p5}` : "missing pass"));
  }
  // G7: root density CV < 0.3
  for (const tag of ["A", "B"]) {
    const p = row.passes?.[tag];
    const ok = p && p.rootDensityCV < 0.3;
    out.push(ok ? pass(`G7${tag}`, `CV ${p.rootDensityCV}`)
      : fail(`G7${tag}`, p ? `CV ${p.rootDensityCV}` : "missing pass"));
  }
  // G8: show-through B <= 5%
  {
    const s = row.showThroughTop?.B;
    out.push(typeof s === "number" && s <= 0.05 ? pass("G8", `B show-through ${s}`)
      : fail("G8", `B show-through ${s}`));
  }
  // G9: placement
  for (const tag of ["A", "B"]) {
    const p = row.passes?.[tag];
    const off = p?.offsetMeanMm || [];
    const ok = p && p.rootToCapMm.mean <= 1.5 && p.rootToGuideMm.mean <= 12
      && off.length === 3 && off.every((v) => Math.abs(v) <= 3);
    out.push(ok ? pass(`G9${tag}`, `cap ${p.rootToCapMm.mean}; guide ${p.rootToGuideMm.mean}; off ${off}`)
      : fail(`G9${tag}`, p ? `cap ${p.rootToCapMm?.mean}; guide ${p.rootToGuideMm?.mean}; off ${off}` : "missing pass"));
  }
  // G10: face box clean (A) + show-through A<=25%, B<=5%
  {
    const p = row.passes?.A;
    const ok = p && p.faceBoxHairPixels === 0;
    out.push(ok ? pass("G10face", "passA face box hair pixels = 0")
      : fail("G10face", p ? `face box hair pixels = ${p.faceBoxHairPixels}` : "missing pass A"));
    const sa = row.showThroughTop?.A, sb = row.showThroughTop?.B;
    const okS = typeof sa === "number" && sa <= 0.25 && typeof sb === "number" && sb <= 0.05;
    out.push(okS ? pass("G10top", `show-through A ${sa} B ${sb}`)
      : fail("G10top", `show-through A ${sa} B ${sb}`));
  }
  return out;
}

function plantViolation(id, row) {
  // Return a mutated deep copy violating exactly the named gate.
  const r = JSON.parse(JSON.stringify(row));
  const A = r.passes.A, B = r.passes.B;
  switch (id) {
    case "G0": delete r.d1_diagnosis; break;
    case "G2": r.guidesHandUV.nan = 7; break;
    case "G3A": A.evaluatedCurveCount = 500; break;
    case "G3B": B.evaluatedCurveCount = 500; break;
    case "G4A": A.perGuideMax = 10 * A.perGuideMedian; break;
    case "G4B": B.perGuideMax = 10 * B.perGuideMedian; break;
    case "G5A": A.partCrossingPointCount = 41; break;
    case "G5B": B.rootsCorrectIslandFrac = 0.5; break;
    case "G6A": A.insideBodyCount = 99; break;
    case "G6B": B.insideShirtFrac = 0.9; break;
    case "G7A": A.rootDensityCV = 0.99; break;
    case "G7B": B.rootDensityCV = 0.99; break;
    case "G8": r.showThroughTop.B = 0.5; break;
    case "G9A": A.rootToGuideMm.mean = 99; break;
    case "G9B": B.offsetMeanMm = [99, 0, 0]; break;
    case "G10face": A.faceBoxHairPixels = 1234; break;
    case "G10top": r.showThroughTop.A = 0.9; break;
    default: throw new Error("unknown gate " + id);
  }
  return r;
}

const GATE_IDS = ["G0", "G2", "G3A", "G3B", "G4A", "G4B", "G5A", "G5B",
  "G6A", "G6B", "G7A", "G7B", "G8", "G9A", "G9B", "G10face", "G10top"];

if (process.argv.includes("--self-test")) {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  let failures = 0;
  for (const id of GATE_IDS) {
    // Run the checker in a child via env override to avoid file writes.
    const mutated = plantViolation(id, row);
    const env = { ...process.env, CHECK_CHILDREN_ROW: JSON.stringify(mutated) };
    let output = "";
    let code = 0;
    try {
      output = execFileSync(process.execPath, [fileURLToPath(import.meta.url)],
        { env: { ...env, CHECK_CHILDREN_STDIN: "1" }, encoding: "utf8" });
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
} else if (process.env.CHECK_CHILDREN_STDIN === "1" && process.env.CHECK_CHILDREN_ROW) {
  const row = JSON.parse(process.env.CHECK_CHILDREN_ROW);
  const results = checkGates(row);
  for (const r of results) console.log(`${r.id}::${r.status} ${r.detail}`);
  if (results.some((r) => r.status === "MISS")) process.exit(1);
} else {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  const results = checkGates(row);
  for (const r of results) console.log(`${r.id}::${r.status} ${r.detail}`);
  if (results.some((r) => r.status === "MISS")) process.exit(1);
}
