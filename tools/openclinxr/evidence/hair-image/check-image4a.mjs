#!/usr/bin/env node
// check-image3b.mjs: fail-closed judge for hair image03b row3b.json.
// ok:true  -> exactly 9 numeric cells, every cell strandsAfter within 1% of
//             strandsBefore x (Amount+1) unless invalid, selected not invalid,
//             recomputed selection equals selected (ties: smaller Amount then
//             smaller Radius), front3b.png + three_quarter3b.png exist >=
//             MIN_PNG with different sha256, judge re-runs measure.py on
//             front3b.png within 0.06 and re-derives faceSkinRatio vs front.png.
// ok:false -> stage in set + blenderVersion + (error >= 20 chars containing
//             Traceback|Error OR stage select with 9 infeasible cells).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES = new Set(["setup", "mask", "delete", "sockets", "sweep", "select", "render", "compose", "measure"]);
const MIN_PNG = 300000;
const TARGET_VOL = 0.294;
const TOL = 0.06;

function sha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

// Recompute feasibility from numeric thresholds (do not trust flags alone).
// Invalid cells can never be feasible.
function feasibleOf(c) {
  if (c.invalid === true) return false;
  return c.crownScalpFraction < 0.08 && c.faceSkinRatio >= 0.5 &&
    c.meanHairLuminance >= 0.08 && c.meanHairLuminance <= 0.22;
}

function recomputeSelection(cells) {
  const feas = cells.filter(feasibleOf);
  if (feas.length === 0) return null;
  let best = feas[0];
  for (const c of feas.slice(1)) {
    const d = Math.abs(c.volume - TARGET_VOL);
    const bd = Math.abs(best.volume - TARGET_VOL);
    if (d < bd - 1e-12) best = c;
    else if (Math.abs(d - bd) <= 1e-12) {
      if (c.amount < best.amount) best = c;
      else if (c.amount === best.amount && c.radius < best.radius) best = c;
    }
  }
  return best;
}

function sameCell(a, b) {
  if (!a || !b) return false;
  return a.strands === b.strands && a.radius === b.radius;
}

function expectedAfter(strandsBefore, amount) {
  return strandsBefore * (amount + 1);
}

function validateCells(cells, strandsBefore) {
  const errors = [];
  if (!Array.isArray(cells) || cells.length !== 9) {
    errors.push(`cells must be an array of exactly 9 (got ${Array.isArray(cells) ? cells.length : typeof cells})`);
    return errors;
  }
  cells.forEach((c, i) => {
    if (typeof c.strands !== "string") errors.push(`cells[${i}].strands must be string`);
    if (!isNum(c.amount)) errors.push(`cells[${i}].amount must be numeric`);
    if (!isNum(c.radius)) errors.push(`cells[${i}].radius must be numeric`);
    if (!isNum(c.strandsAfter)) errors.push(`cells[${i}].strandsAfter must be numeric`);
    if (!isNum(c.volume)) errors.push(`cells[${i}].volume must be numeric`);
    if (!isNum(c.crownScalpFraction)) errors.push(`cells[${i}].crownScalpFraction must be numeric`);
    if (!isNum(c.meanHairLuminance)) errors.push(`cells[${i}].meanHairLuminance must be numeric`);
    if (!isNum(c.faceSkinRatio)) errors.push(`cells[${i}].faceSkinRatio must be numeric`);
    if (typeof c.invalid !== "boolean") errors.push(`cells[${i}].invalid must be boolean`);
    if (typeof c.feasible !== "boolean") errors.push(`cells[${i}].feasible must be boolean`);
    else if (c.feasible !== feasibleOf(c)) errors.push(`cells[${i}].feasible flag disagrees with recompute`);
    if (c.invalid === true && c.feasible === true) errors.push(`cells[${i}] invalid but feasible`);
    if (isNum(c.strandsAfter) && isNum(c.amount) && isNum(strandsBefore)) {
      const exp = expectedAfter(strandsBefore, c.amount);
      const ok = Math.abs(c.strandsAfter - exp) <= 0.01 * exp;
      if (!ok && c.invalid !== true) errors.push(`cells[${i}].strandsAfter ${c.strandsAfter} not within 1% of ${strandsBefore}x(${c.amount}+1)=${exp} and not marked invalid`);
      if (ok && c.invalid === true) errors.push(`cells[${i}] marked invalid but strandsAfter matches`);
    }
  });
  return errors;
}

function runMeasure(pngPath) {
  const measurer = join(HERE, "measure.py");
  const env = { ...process.env };
  if (!env.MISE_TRUSTED_CONFIG_PATHS) env.MISE_TRUSTED_CONFIG_PATHS = resolve(HERE, "..", "..", "..");
  const use = spawnSync("python3", [measurer, pngPath], { encoding: "utf8", env });
  if (use.status !== 0) return { error: `measure.py failed: ${(use.stderr || "").slice(0, 300)}` };
  try {
    return { value: JSON.parse((use.stdout || "").trim().split("\n").pop()) };
  } catch (e) {
    return { error: `measure.py output does not parse: ${e.message}` };
  }
}

function skinBandCount(pngPath, W, H) {
  // Re-derive faceSkinRatio: caller compares band counts. Minimal PNG parse
  // is overkill; use python + PIL one-liner for the band count.
  const env = { ...process.env };
  const script = `from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert("RGB"); im=im.resize((512,512)); a=list(im.getdata()); W,H=512,512; import math; band=[a[y*512+x] for y in range(int(H*0.30),int(H*0.50)) for x in range(int(W*0.30),int(W*0.70))]; print(sum(1 for r,g,b in band if (0.299*r+0.587*g+0.114*b)/255.0>0.55))`;
  const use = spawnSync("python3", ["-c", script, pngPath], { encoding: "utf8", env });
  if (use.status !== 0) return { error: `skin band failed: ${(use.stderr || "").slice(0, 200)}` };
  const n = Number((use.stdout || "").trim());
  if (!Number.isFinite(n)) return { error: "skin band count does not parse" };
  return { value: n };
}

function checkRow(rowPath) {
  const errors = [];
  let row;
  try {
    row = JSON.parse(readFileSync(rowPath, "utf8"));
  } catch (e) {
    return [`row3b.json does not parse: ${e.message}`];
  }
  const dir = dirname(resolve(rowPath));
  if (row.ok === true) {
    errors.push(...validateCells(row.cells, row.strandsBefore));
    if (typeof row.strandsBefore !== "number") errors.push("strandsBefore must be numeric");
    if (errors.length === 0) {
      const best = recomputeSelection(row.cells);
      if (!best) errors.push("no feasible cell but ok:true");
      else if (!sameCell(best, row.selected)) {
        errors.push(`selected ${JSON.stringify(row.selected)} != recomputed ${best.strands} r=${best.radius}`);
      }
      if (row.selected) {
        const selCell = row.cells.find((c) => sameCell(c, row.selected));
        if (!selCell) errors.push("selected is not a member of cells");
        else if (selCell.invalid === true) errors.push("selected cell is invalid");
      }
    }
    for (const f of ["front3b.png", "three_quarter3b.png"]) {
      const p = join(dir, f);
      if (!existsSync(p)) errors.push(`missing ${f}`);
      else if (statSync(p).size < MIN_PNG) errors.push(`${f} under ${MIN_PNG} bytes`);
    }
    const fp = join(dir, "front3b.png");
    const tp = join(dir, "three_quarter3b.png");
    if (existsSync(fp) && existsSync(tp) && statSync(fp).size >= MIN_PNG && statSync(tp).size >= MIN_PNG) {
      if (sha256(fp) === sha256(tp)) errors.push("front3b and three_quarter3b have identical sha256");
    }
    if (!existsSync(join(dir, "3up3b.png"))) errors.push("missing 3up3b.png");
    if (!existsSync(join(dir, "sweep3b.png"))) errors.push("missing sweep3b.png");
    if (errors.length === 0) {
      const m = runMeasure(fp);
      if (m.error) errors.push(m.error);
      else {
        const selCell = row.cells.find((c) => sameCell(c, row.selected));
        if (Math.abs(m.value.volume - selCell.volume) > TOL) {
          errors.push(`re-measure volume ${m.value.volume} vs selected cell ${selCell.volume} beyond ${TOL}`);
        }
        // Re-derive faceSkinRatio on front3b.png against front.png.
        const ref = join(dir, "front.png");
        if (existsSync(ref)) {
          const a = skinBandCount(fp);
          const b = skinBandCount(ref);
          if (a.error) errors.push(a.error);
          else if (b.error) errors.push(b.error);
          else if (b.value > 0) {
            const fsr = a.value / b.value;
            if (Math.abs(fsr - selCell.faceSkinRatio) > 0.05) {
              errors.push(`re-derived faceSkinRatio ${fsr.toFixed(3)} vs cell ${selCell.faceSkinRatio} beyond 0.05`);
            }
          }
        }
        for (const k of ["volume", "crownScalpFraction", "meanHairLuminance"]) {
          const exp = (row.finalMeasure || {})[k];
          if (typeof exp !== "number") { errors.push(`no numeric expected ${k} for re-measure compare`); break; }
          const got = m.value[k];
          if (typeof got !== "number" || Math.abs(got - exp) > TOL) {
            errors.push(`re-measure ${k} ${got} vs row ${exp} beyond ${TOL}`);
          }
        }
      }
    }
  } else if (row.ok === false) {
    if (!STAGES.has(row.stage)) errors.push(`stage ${row.stage} not in set`);
    if (typeof row.blenderVersion !== "string" || row.blenderVersion.length === 0) {
      errors.push("blenderVersion missing");
    }
    const errOk = typeof row.error === "string" && row.error.length >= 20 && /Traceback|Error/.test(row.error);
    const selectNeg = row.stage === "select" && Array.isArray(row.cells) && row.cells.length === 9 &&
      row.cells.every((c) => c.feasible === false);
    if (!errOk && !selectNeg) {
      if (typeof row.error !== "string" || row.error.length < 20) errors.push("error must be >= 20 chars");
      else if (!/Traceback|Error/.test(row.error)) errors.push("error must contain Traceback or Error (or stage select with 9 infeasible cells)");
    }
    if (row.stage === "select") {
      if (!Array.isArray(row.cells) || row.cells.length !== 9) errors.push("stage select requires 9-row cells table");
      else if (!row.cells.every((c) => c.feasible === false)) errors.push("stage select negative requires all 9 cells infeasible");
    }
  } else {
    errors.push("ok must be true or false");
  }
  return errors;
}

// ---- self-test: logic fixtures, no filesystem measure ----
function logicCheck(row) {
  // Mirrors checkRow minus filesystem + measure (selection + cells + strands + negative).
  const errors = [];
  if (row.ok === true) {
    errors.push(...validateCells(row.cells, row.strandsBefore));
    if (typeof row.strandsBefore !== "number") errors.push("strandsBefore numeric");
    if (errors.length === 0) {
      const best = recomputeSelection(row.cells);
      if (!best) errors.push("no feasible cell but ok:true");
      else if (!sameCell(best, row.selected)) errors.push("selected != recomputed");
      const selCell = row.cells.find((c) => sameCell(c, row.selected));
      if (selCell && selCell.invalid === true) errors.push("selected invalid");
    }
  } else if (row.ok === false) {
    if (!STAGES.has(row.stage)) errors.push("stage");
    if (typeof row.blenderVersion !== "string" || row.blenderVersion.length === 0) errors.push("version");
    const errOk = typeof row.error === "string" && row.error.length >= 20 && /Traceback|Error/.test(row.error);
    const selectNeg = row.stage === "select" && Array.isArray(row.cells) && row.cells.length === 9 &&
      row.cells.every((c) => c.feasible === false);
    if (!errOk && !selectNeg) errors.push("error-content");
    if (row.stage === "select") {
      if (!Array.isArray(row.cells) || row.cells.length !== 9) errors.push("select-9");
      else if (!row.cells.every((c) => c.feasible === false)) errors.push("select-infeasible");
    }
  } else errors.push("ok");
  return errors;
}

function mkCell(i, feas, opts = {}) {
  const amount = [1, 2, 4][Math.floor(i / 3)];
  const radius = [0.002, 0.005, 0.01][i % 3];
  const strandsBefore = opts.strandsBefore ?? 10000;
  const strandsAfter = opts.strandsAfter ?? (strandsBefore * (amount + 1));
  return {
    strands: `Amount ${amount}`,
    amount,
    radius,
    strandsAfter,
    volume: feas ? (opts.volume ?? 0.294) : 0.60,
    crownScalpFraction: feas ? 0.05 : 0.50,
    meanHairLuminance: feas ? 0.12 : 0.02,
    faceSkinRatio: feas ? 0.7 : 0.1,
    invalid: opts.invalid ?? false,
    feasible: feas && !(opts.invalid ?? false),
  };
}

function selfTest() {
  const SB = 10000;
  // good: two feasible, winner is the volume minimiser (cell 4, Amount 2).
  const goodCells = [];
  for (let i = 0; i < 9; i++) {
    goodCells.push(mkCell(i, i === 1 || i === 4, { strandsBefore: SB, volume: i === 4 ? 0.294 : (i === 1 ? 0.30 : 0.60) }));
  }
  const goodSel = { strands: goodCells[4].strands, radius: goodCells[4].radius };
  // selected-not-minimiser: picks cell 1 instead of cell 4.
  const notMinSel = { strands: goodCells[1].strands, radius: goodCells[1].radius };
  // 8 cells.
  const eightCells = goodCells.slice(0, 8);
  // invalid-selected: winner marked invalid.
  const invCells = goodCells.map((c, i) => (i === 4 ? { ...c, invalid: true, feasible: false } : c));
  const invSel = { strands: goodCells[4].strands, radius: goodCells[4].radius };
  const cases = [
    { name: "good passes", row: { ok: true, cells: goodCells, selected: goodSel, strandsBefore: SB }, expectPass: true },
    { name: "selected-not-minimiser fails", row: { ok: true, cells: goodCells, selected: notMinSel, strandsBefore: SB }, expectPass: false },
    { name: "8 cells fails", row: { ok: true, cells: eightCells, selected: goodSel, strandsBefore: SB }, expectPass: false },
    { name: "invalid-selected fails", row: { ok: true, cells: invCells, selected: invSel, strandsBefore: SB }, expectPass: false },
    {
      name: "skeleton row fails",
      row: { ok: false, stage: "setup", error: "skeleton, not yet run", blenderVersion: "unknown", dupSockets: [], cells: [], selected: null },
      expectPass: false,
    },
    {
      name: "short-error row fails",
      row: { ok: false, stage: "sweep", error: "bad", blenderVersion: "5.1.1", cells: [] },
      expectPass: false,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const errors = logicCheck(c.row);
    const pass = errors.length === 0;
    if (pass !== c.expectPass) {
      console.error(`SELF-TEST FAIL: ${c.name}: got ${pass ? "pass" : `fail(${errors.join(",")})`}, want ${c.expectPass ? "pass" : "fail"}`);
      failed++;
    } else console.log(`self-test ok: ${c.name}`);
  }
  if (failed > 0) {
    console.error(`${failed} self-test case(s) failed`);
    process.exit(1);
  }
  console.log("self-test: all pass");
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  selfTest();
} else if (argv.length === 1) {
  const errors = checkRow(resolve(argv[0]));
  if (errors.length > 0) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exit(1);
  }
  console.log("check-image3b: ok");
} else {
  console.error("usage: check-image3b.mjs [--self-test | <row3b.json>]");
  process.exit(2);
}
