#!/usr/bin/env node
// check-cap7.mjs: gate checker for hair-cap-7 row-cap7.json.
// Usage: node check-cap7.mjs [--self-test]
// Exit 0 = all gates PASS (or all self-tests behave as expected); non-zero otherwise.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROW = join(HERE, "row-cap7.json");

function check(row) {
  const fails = [];
  const g = row.gates;
  // G1: one connected cap, one boundary loop, mirror <= 1mm, area in [600,690].
  if (!(600 <= g.g1.area_cm2 && g.g1.area_cm2 <= 690)) fails.push(`G1 area ${g.g1.area_cm2} not in [600,690]`);
  if (g.g1.ncomp !== 1) fails.push(`G1 ncomp ${g.g1.ncomp} != 1`);
  if (g.g1.nloops !== 1) fails.push(`G1 nloops ${g.g1.nloops} != 1`);
  if (!(g.g1.mirror_mm <= 1.0)) fails.push(`G1 mirror ${g.g1.mirror_mm} > 1mm`);
  if (!(g.g1.sideburn_L_cm2 > 0 && g.g1.sideburn_R_cm2 > 0)) fails.push(`G1 sideburn not reported per side`);
  // G2: front hairline <= 0.02H at the six columns.
  for (const c of g.g2.cols) {
    if (!(Math.abs(c.hT - c.h7) <= 0.02)) fails.push(`G2 dx=${c.dx} ${c.side} err ${Math.abs(c.hT - c.h7).toFixed(4)}H > 0.02H`);
  }
  if (!(g.g2.maxerr_H <= 0.02)) fails.push(`G2 maxerr ${g.g2.maxerr_H} > 0.02H`);
  // G3: boundary smooth everywhere <= 3mm.
  if (!(g.g3.step_mm <= 3.0)) fails.push(`G3 step ${g.g3.step_mm} > 3mm`);
  // G4: sideburn setback 8-14mm; bottom within 8mm of lobe+15mm; pinna > 4mm; canthus <= 0.
  for (const c of g.g4.cols) {
    if (!(8.0 <= c.setback_mm && c.setback_mm <= 14.0)) fails.push(`G4 row=${c.row} ${c.side} setback ${c.setback_mm} not in [8,14]`);
  }
  if (!(Math.abs(g.g4.bottom_L_mm) <= 8.0)) fails.push(`G4 bottom_L ${g.g4.bottom_L_mm} not within 8mm`);
  if (!(Math.abs(g.g4.bottom_R_mm) <= 8.0)) fails.push(`G4 bottom_R ${g.g4.bottom_R_mm} not within 8mm`);
  if (!(g.g4.pinna_min_mm > 4.0)) fails.push(`G4 pinna_min ${g.g4.pinna_min_mm} <= 4mm`);
  if (!(g.g4.canthus_infront_mm <= 0.0)) fails.push(`G4 canthus_infront ${g.g4.canthus_infront_mm} > 0mm`);
  // G5: no hole above or behind the ear: coverage 100%.
  if (!(g.g5.coverage === 1 || (g.g5.uncovered === 0 && g.g5.coverage >= 0.9999))) fails.push(`G5 coverage ${g.g5.coverage} uncovered=${g.g5.uncovered} != 100%`);
  // G6: flow gates.
  if (!(g.g6.sideways >= 0.90)) fails.push(`G6 sideways ${g.g6.sideways} < 0.90`);
  if (!(g.g6.backdown >= 0.95)) fails.push(`G6 backdown ${g.g6.backdown} < 0.95`);
  if (!(g.g6.smooth_p95 <= 25.0)) fails.push(`G6 smooth ${g.g6.smooth_p95} > 25deg`);
  if (g.g6.cross !== 0) fails.push(`G6 cross ${g.g6.cross} != 0`);
  if (g.g6.sinks !== 0) fails.push(`G6 sinks ${g.g6.sinks} != 0`);
  if (g.g6.never !== 0) fails.push(`G6 never ${g.g6.never} != 0`);
  if (!(g.g6.fore_pct <= 0.02)) fails.push(`G6 fore_pct ${g.g6.fore_pct} > 2%`);
  if (!(g.g6.sym95_deg <= 1.0)) fails.push(`G6 sym95 ${g.g6.sym95_deg} > 1deg`);
  return fails;
}

function plantViolation(row, gate) {
  const c = JSON.parse(JSON.stringify(row));
  if (gate === "G1") c.gates.g1.area_cm2 = 750;
  if (gate === "G2") c.gates.g2.cols[0].h7 += 0.05;
  if (gate === "G3") c.gates.g3.step_mm = 9;
  if (gate === "G4") c.gates.g4.cols[0].setback_mm = 3;
  if (gate === "G5") { c.gates.g5.uncovered = 5; c.gates.g5.coverage = 0.99; }
  if (gate === "G6") c.gates.g6.sinks = 1;
  return c;
}

if (process.argv.includes("--self-test")) {
  const real = JSON.parse(readFileSync(ROW, "utf8"));
  const good = JSON.parse(JSON.stringify(real));
  good.gates.g1.area_cm2 = 630; good.gates.g1.ncomp = 1; good.gates.g1.nloops = 1; good.gates.g1.mirror_mm = 0.5;
  good.gates.g1.sideburn_L_cm2 = 12; good.gates.g1.sideburn_R_cm2 = 12;
  for (const col of good.gates.g2.cols) col.h7 = col.hT;
  good.gates.g2.maxerr_H = 0.01;
  good.gates.g3.step_mm = 2.0;
  for (const col of good.gates.g4.cols) col.setback_mm = 10;
  good.gates.g4.bottom_L_mm = 2; good.gates.g4.bottom_R_mm = -2;
  good.gates.g4.pinna_min_mm = 6; good.gates.g4.canthus_infront_mm = -5;
  good.gates.g5.coverage = 1; good.gates.g5.uncovered = 0;
  good.gates.g6.sideways = 0.99; good.gates.g6.backdown = 0.99; good.gates.g6.smooth_p95 = 10;
  good.gates.g6.cross = 0; good.gates.g6.sinks = 0; good.gates.g6.never = 0;
  good.gates.g6.fore_pct = 0.01; good.gates.g6.sym95_deg = 0.2;
  const problems = [];
  if (check(good).length !== 0) problems.push("synthetic-pass failed: " + check(good).join("; "));
  for (const gate of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
    const f = check(plantViolation(good, gate));
    if (f.length === 0) problems.push(`${gate} planted violation NOT caught`);
    else if (!f.some((m) => m.startsWith(gate))) problems.push(`${gate} violation caught by wrong gate: ${f.join("; ")}`);
  }
  if (problems.length) { console.error("SELF-TEST FAIL\n" + problems.join("\n")); process.exit(1); }
  console.log("SELF-TEST PASS (synthetic pass + G1/G2/G3/G4/G5/G6 planted violations each caught)");
  process.exit(0);
}

const row = JSON.parse(readFileSync(ROW, "utf8"));
const fails = check(row);
if (fails.length) { console.error("GATES MISS\n" + fails.join("\n")); process.exit(1); }
console.log(`GATES PASS area=${row.gates.g1.area_cm2} maxerr=${row.gates.g2.maxerr_H} step=${row.gates.g3.step_mm} pinna=${row.gates.g4.pinna_min_mm} uncovered=${row.gates.g5.uncovered} sinks=${row.gates.g6.sinks} sym=${row.gates.g6.sym95_deg}`);
