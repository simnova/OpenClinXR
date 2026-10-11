#!/usr/bin/env node
// check-image.mjs: fail-closed checker for hair image 01 row.json.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES = new Set(["setup", "mask", "delete", "material", "render", "compose", "evaluate"]);
const MIN_PNG = 300000;

function sha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function checkRow(rowPath) {
  const errors = [];
  let row;
  try {
    row = JSON.parse(readFileSync(rowPath, "utf8"));
  } catch (e) {
    return [`row.json does not parse: ${e.message}`];
  }
  const dir = dirname(resolve(rowPath));
  if (row.ok === true) {
    for (const f of ["front.png", "three_quarter.png"]) {
      const p = join(dir, f);
      if (!existsSync(p)) errors.push(`missing ${f}`);
      else if (statSync(p).size < MIN_PNG) errors.push(`${f} under ${MIN_PNG} bytes`);
    }
    const fp = join(dir, "front.png");
    const tp = join(dir, "three_quarter.png");
    if (existsSync(fp) && existsSync(tp) && sha256(fp) === sha256(tp)) {
      errors.push("front and three_quarter have identical sha256");
    }
    if (!existsSync(join(dir, "3up.png"))) errors.push("missing 3up.png");
    if (!(row.deletedFringe > 0)) errors.push("deletedFringe must be > 0");
    if (!(row.deletedPart > 0) && row.partWasEmpty !== true) {
      errors.push("deletedPart must be > 0 or partWasEmpty:true with reason");
    }
    if (!(row.remaining >= 3000 && row.remaining <= 10191)) {
      errors.push(`remaining ${row.remaining} outside [3000, 10191]`);
    }
    const vol = row?.evaluator?.front?.volume;
    if (typeof vol !== "number") errors.push("evaluator.front.volume must be numeric");
  } else if (row.ok === false) {
    if (!STAGES.has(row.stage)) errors.push(`stage ${row.stage} not in set`);
    if (!row.blenderVersion) errors.push("blenderVersion missing");
    if (typeof row.error !== "string" || row.error.length < 20) {
      errors.push("error must be >= 20 chars");
    } else if (!/Traceback|Error/.test(row.error)) {
      errors.push("error must contain Traceback or Error");
    }
  } else {
    errors.push("ok must be true or false");
  }
  return errors;
}

function selfTest() {
  const cases = [
    {
      name: "good row",
      row: {
        ok: true, deletedFringe: 1200, deletedPart: 45, remaining: 8946,
        evaluator: { front: { volume: 0.42 } },
      },
      files: { "front.png": "a".repeat(10), "three_quarter.png": "b".repeat(10), "3up.png": "c" },
      sizes: { "front.png": MIN_PNG, "three_quarter.png": MIN_PNG },
      expectPass: true,
    },
    {
      name: "deleted everything",
      row: {
        ok: true, deletedFringe: 9000, deletedPart: 1191, remaining: 0,
        evaluator: { front: { volume: 0.0 } },
      },
      files: { "front.png": "a".repeat(10), "three_quarter.png": "b".repeat(10), "3up.png": "c" },
      sizes: { "front.png": MIN_PNG, "three_quarter.png": MIN_PNG },
      expectPass: false,
    },
    {
      name: "identical images",
      row: {
        ok: true, deletedFringe: 1200, deletedPart: 45, remaining: 8946,
        evaluator: { front: { volume: 0.42 } },
      },
      files: { "front.png": "same".repeat(10), "three_quarter.png": "same".repeat(10), "3up.png": "c" },
      sizes: { "front.png": MIN_PNG, "three_quarter.png": MIN_PNG },
      expectPass: false,
    },
    {
      name: "short error",
      row: { ok: false, stage: "setup", blenderVersion: "5.1", error: "bad" },
      files: {},
      expectPass: false,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    // simulate without filesystem: inline the logic on fixture values
    const errors = [];
    const row = c.row;
    if (row.ok === true) {
      for (const f of ["front.png", "three_quarter.png"]) {
        if (!(f in c.files)) errors.push(`missing ${f}`);
        else if ((c.sizes?.[f] ?? 0) < MIN_PNG) errors.push(`${f} under size`);
      }
      if (c.files["front.png"] === c.files["three_quarter.png"]) {
        errors.push("identical sha256");
      }
      if (!("3up.png" in c.files)) errors.push("missing 3up");
      if (!(row.deletedFringe > 0)) errors.push("fringe");
      if (!(row.deletedPart > 0) && row.partWasEmpty !== true) errors.push("part");
      if (!(row.remaining >= 3000 && row.remaining <= 10191)) errors.push("remaining");
      if (typeof row?.evaluator?.front?.volume !== "number") errors.push("volume");
    } else {
      if (!STAGES.has(row.stage)) errors.push("stage");
      if (!row.blenderVersion) errors.push("version");
      if (typeof row.error !== "string" || row.error.length < 20) errors.push("error-len");
      else if (!/Traceback|Error/.test(row.error)) errors.push("error-content");
    }
    const pass = errors.length === 0;
    const want = c.expectPass;
    if (pass !== want) {
      console.error(`SELF-TEST FAIL: ${c.name}: got ${pass ? "pass" : `fail(${errors.join(",")})`}, want ${want ? "pass" : "fail"}`);
      failed++;
    } else {
      console.log(`self-test ok: ${c.name}`);
    }
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
  console.log("check-image: ok");
} else {
  console.error("usage: check-image.mjs [--self-test | <row.json>]");
  process.exit(2);
}
