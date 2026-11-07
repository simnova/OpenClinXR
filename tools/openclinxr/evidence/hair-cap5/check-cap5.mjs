#!/usr/bin/env node
// check-cap5.mjs: gate checker for hair-cap-5b row-cap5.json.
// Usage: node check-cap5.mjs [--self-test]
// Exit 0 = all gates PASS (or all self-tests behave as expected); non-zero otherwise.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROW = join(HERE, "row-cap5.json");

function check(row) {
  const fails = [];
  const g = row.gates;
  if (!(560 <= g.g1.area_cm2 && g.g1.area_cm2 <= 620)) fails.push(`G1 area ${g.g1.area_cm2} not in [560,620]`);
  if (g.g1.ncomp !== 1) fails.push(`G1 ncomp ${g.g1.ncomp} != 1`);
  if (!(g.g1.step_mm <= 3.0)) fails.push(`G1 step ${g.g1.step_mm} > 3mm`);
  if (!(g.g1.added_cm2 <= 0.5)) fails.push(`G1 added ${g.g1.added_cm2} > 0.5 (expect ~0)`);
  if (!(g.g2.maxerr_H <= 0.02)) fails.push(`G2 maxerr ${g.g2.maxerr_H} > 0.02H`);
  if (!(g.g2.mirror_mm <= 1.0)) fails.push(`G2 mirror ${g.g2.mirror_mm} > 1mm`);
  if (!(g.g3.g13 >= 0.90)) fails.push(`G3 g13 ${g.g3.g13} < 0.90`);
  if (!(g.g3.g7 >= 0.95)) fails.push(`G3 g7 ${g.g3.g7} < 0.95`);
  if (!(g.g3.g15 <= 25.0)) fails.push(`G3 g15 ${g.g3.g15} > 25deg`);
  if (g.g3.cross !== 0) fails.push(`G3 cross ${g.g3.cross} != 0`);
  if (g.g3.sinks !== 0) fails.push(`G3 sinks ${g.g3.sinks} != 0`);
  if (!(g.g3.fore_pct <= 0.02)) fails.push(`G3 fore_pct ${g.g3.fore_pct} > 2%`);
  if (!(g.g4.hausdorff_mm <= 1.0)) fails.push(`G4 hausdorff ${g.g4.hausdorff_mm} > 1mm`);
  return fails;
}

function plantViolation(row, gate) {
  const c = JSON.parse(JSON.stringify(row));
  if (gate === "G1") c.gates.g1.area_cm2 = 700;
  if (gate === "G2") c.gates.g2.maxerr_H = 0.05;
  if (gate === "G3") c.gates.g3.sinks = 1;
  if (gate === "G4") c.gates.g4.hausdorff_mm = 5;
  return c;
}

if (process.argv.includes("--self-test")) {
  // Checker correctness is independent of the real verdict: a synthetic
  // all-pass row must pass, and each planted gate violation must fail.
  const real = JSON.parse(readFileSync(ROW, "utf8"));
  const good = JSON.parse(JSON.stringify(real));
  good.gates.g1.area_cm2 = 590; good.gates.g1.ncomp = 1; good.gates.g1.step_mm = 2.0; good.gates.g1.added_cm2 = 0;
  good.gates.g2.maxerr_H = 0.01; good.gates.g2.mirror_mm = 0.5;
  good.gates.g3.g13 = 0.99; good.gates.g3.g7 = 0.99; good.gates.g3.g15 = 10; good.gates.g3.cross = 0;
  good.gates.g3.sinks = 0; good.gates.g3.fore_pct = 0.01;
  good.gates.g4.hausdorff_mm = 0.5;
  const problems = [];
  if (check(good).length !== 0) problems.push("synthetic-pass failed: " + check(good).join("; "));
  for (const gate of ["G1", "G2", "G3", "G4"]) {
    const f = check(plantViolation(good, gate));
    if (f.length === 0) problems.push(`${gate} planted violation NOT caught`);
    else if (!f.some((m) => m.startsWith(gate))) problems.push(`${gate} violation caught by wrong gate: ${f.join("; ")}`);
  }
  if (problems.length) { console.error("SELF-TEST FAIL\n" + problems.join("\n")); process.exit(1); }
  console.log("SELF-TEST PASS (synthetic pass + G1/G2/G3/G4 planted violations each caught)");
  process.exit(0);
}

const row = JSON.parse(readFileSync(ROW, "utf8"));
const fails = check(row);
if (fails.length) { console.error("GATES MISS\n" + fails.join("\n")); process.exit(1); }
console.log(`GATES PASS area=${row.gates.g1.area_cm2} maxerr=${row.gates.g2.maxerr_H} sinks=${row.gates.g3.sinks} hd=${row.gates.g4.hausdorff_mm}`);
