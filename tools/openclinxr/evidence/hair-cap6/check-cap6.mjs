#!/usr/bin/env node
// check-cap6.mjs: gate checker for hair-cap-6 row-cap6.json.
// Usage: node check-cap6.mjs [--self-test]
// Exit 0 = all gates PASS (or all self-tests behave as expected); non-zero otherwise.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROW = join(HERE, "row-cap6.json");

function check(row) {
  const fails = [];
  const g = row.gates;
  // G1: area in [600,680], 1 component, mirror <= 1mm, added 10-40 per side.
  if (!(600 <= g.g1.area_cm2 && g.g1.area_cm2 <= 680)) fails.push(`G1 area ${g.g1.area_cm2} not in [600,680]`);
  if (g.g1.ncomp !== 1) fails.push(`G1 ncomp ${g.g1.ncomp} != 1`);
  if (!(g.g1.mirror_mm <= 1.0)) fails.push(`G1 mirror ${g.g1.mirror_mm} > 1mm`);
  if (!(10.0 <= g.g1.added_L_cm2 && g.g1.added_L_cm2 <= 40.0)) fails.push(`G1 added_L ${g.g1.added_L_cm2} not in [10,40]`);
  if (!(10.0 <= g.g1.added_R_cm2 && g.g1.added_R_cm2 <= 40.0)) fails.push(`G1 added_R ${g.g1.added_R_cm2} not in [10,40]`);
  // G2: front hairline <= 0.02H at each of the six |dx| columns.
  for (const c of g.g2.cols) {
    if (!(Math.abs(c.hT - c.h6) <= 0.02)) fails.push(`G2 dx=${c.dx} ${c.side} err ${Math.abs(c.hT - c.h6).toFixed(4)}H > 0.02H`);
  }
  if (!(g.g2.maxerr_H <= 0.02)) fails.push(`G2 maxerr ${g.g2.maxerr_H} > 0.02H`);
  // G3: whole boundary smooth <= 3mm.
  if (!(g.g3.step_mm <= 3.0)) fails.push(`G3 step ${g.g3.step_mm} > 3mm`);
  // G4: sideburn setback 8-12mm each row/side; pinna > 5mm; canthus <= 1mm.
  for (const c of g.g4.cols) {
    if (!(8.0 <= c.setback_mm && c.setback_mm <= 12.0)) fails.push(`G4 row=${c.row} ${c.side} setback ${c.setback_mm} not in [8,12]`);
  }
  if (!(g.g4.pinna_min_mm > 5.0)) fails.push(`G4 pinna_min ${g.g4.pinna_min_mm} <= 5mm`);
  if (!(g.g4.canthus_infront_mm <= 1.0)) fails.push(`G4 canthus_infront ${g.g4.canthus_infront_mm} > 1mm`);
  // G5: flow + mirror symmetry.
  if (!(g.g5.g13 >= 0.90)) fails.push(`G5 g13 ${g.g5.g13} < 0.90`);
  if (!(g.g5.g7 >= 0.95)) fails.push(`G5 g7 ${g.g5.g7} < 0.95`);
  if (!(g.g5.g15 <= 25.0)) fails.push(`G5 g15 ${g.g5.g15} > 25deg`);
  if (g.g5.cross !== 0) fails.push(`G5 cross ${g.g5.cross} != 0`);
  if (g.g5.sinks !== 0) fails.push(`G5 sinks ${g.g5.sinks} != 0`);
  if (g.g5.never !== 0) fails.push(`G5 never ${g.g5.never} != 0`);
  if (!(g.g5.fore_pct <= 0.02)) fails.push(`G5 fore_pct ${g.g5.fore_pct} > 2%`);
  if (!(g.g5.sym95_deg <= 1.0)) fails.push(`G5 sym95 ${g.g5.sym95_deg} > 1deg`);
  return fails;
}

function plantViolation(row, gate) {
  const c = JSON.parse(JSON.stringify(row));
  if (gate === "G1") c.gates.g1.area_cm2 = 750;
  if (gate === "G2") c.gates.g2.cols[0].h6 += 0.05;
  if (gate === "G3") c.gates.g3.step_mm = 9;
  if (gate === "G4") c.gates.g4.cols[0].setback_mm = 3;
  if (gate === "G5") c.gates.g5.sinks = 1;
  return c;
}

if (process.argv.includes("--self-test")) {
  // Checker correctness is independent of the real verdict: a synthetic
  // all-pass row must pass, and each planted gate violation must fail.
  const real = JSON.parse(readFileSync(ROW, "utf8"));
  const good = JSON.parse(JSON.stringify(real));
  good.gates.g1.area_cm2 = 630; good.gates.g1.ncomp = 1; good.gates.g1.mirror_mm = 0.5;
  good.gates.g1.added_L_cm2 = 20; good.gates.g1.added_R_cm2 = 20;
  for (const col of good.gates.g2.cols) col.h6 = col.hT;
  good.gates.g2.maxerr_H = 0.01;
  good.gates.g3.step_mm = 2.0;
  for (const col of good.gates.g4.cols) col.setback_mm = 10;
  good.gates.g4.pinna_min_mm = 8; good.gates.g4.canthus_infront_mm = -2;
  good.gates.g5.g13 = 0.99; good.gates.g5.g7 = 0.99; good.gates.g5.g15 = 10;
  good.gates.g5.cross = 0; good.gates.g5.sinks = 0; good.gates.g5.never = 0;
  good.gates.g5.fore_pct = 0.01; good.gates.g5.sym95_deg = 0.2;
  const problems = [];
  if (check(good).length !== 0) problems.push("synthetic-pass failed: " + check(good).join("; "));
  for (const gate of ["G1", "G2", "G3", "G4", "G5"]) {
    const f = check(plantViolation(good, gate));
    if (f.length === 0) problems.push(`${gate} planted violation NOT caught`);
    else if (!f.some((m) => m.startsWith(gate))) problems.push(`${gate} violation caught by wrong gate: ${f.join("; ")}`);
  }
  if (problems.length) { console.error("SELF-TEST FAIL\n" + problems.join("\n")); process.exit(1); }
  console.log("SELF-TEST PASS (synthetic pass + G1/G2/G3/G4/G5 planted violations each caught)");
  process.exit(0);
}

const row = JSON.parse(readFileSync(ROW, "utf8"));
const fails = check(row);
if (fails.length) { console.error("GATES MISS\n" + fails.join("\n")); process.exit(1); }
console.log(`GATES PASS area=${row.gates.g1.area_cm2} maxerr=${row.gates.g2.maxerr_H} step=${row.gates.g3.step_mm} pinna=${row.gates.g4.pinna_min_mm} sinks=${row.gates.g5.sinks} sym=${row.gates.g5.sym95_deg}`);
