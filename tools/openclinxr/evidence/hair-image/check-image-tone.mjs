#!/usr/bin/env node
// check-image-tone.mjs: judge for the hair image-tone card.
// Usage:
//   node check-image-tone.mjs <row-tone.json>
//   node check-image-tone.mjs --self-test
// When ok:true the judge spawns measure.py on front-tone.png ITSELF and
// requires every reported metric to agree within 0.005. It never trusts
// the row alone (failed treatment: a judge that trusts the row).
import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const TOL = 0.005;
const MEASURE_KEYS = [
  "faceMeanLuminance",
  "backgroundLuminance",
  "meanHairLuminance",
  "hairWarmth",
  "volume",
];
const STAGES = new Set(["rig", "exposure", "colour", "render", "measure", "compose"]);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  return 1;
}
function ok(msg) {
  console.log(`ok: ${msg}`);
  return 0;
}

function loadRow(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { err: `cannot read row file ${path}` };
  }
  try {
    return { row: JSON.parse(raw) };
  } catch {
    return { err: `row file ${path} is not valid JSON` };
  }
}

function measureFront(rowDir, frontPath) {
  const measurePy = join(rowDir, "measure.py");
  if (!existsSync(measurePy)) return { err: `measure.py missing at ${measurePy}` };
  const env = { ...process.env, MISE_TRUSTED_CONFIG_PATHS: process.env.MISE_TRUSTED_CONFIG_PATHS || process.cwd() };
  const r = spawnSync("python3", [measurePy, frontPath], { encoding: "utf8", env });
  if (r.status !== 0) return { err: `measure.py exit ${r.status}: ${(r.stderr || "").slice(0, 300)}` };
  try {
    return { m: JSON.parse(r.stdout) };
  } catch {
    return { err: `measure.py output not JSON: ${r.stdout.slice(0, 200)}` };
  }
}

function checkFailureRow(row) {
  if (!STAGES.has(row.stage)) return `stage '${row.stage}' not in rig/exposure/colour/render/measure/compose`;
  if (!row.blenderVersion) return "blenderVersion missing";
  const hasTable =
    (row.stage === "exposure" && Array.isArray(row.iterations) && row.iterations.length > 0) ||
    (row.stage === "colour" && Array.isArray(row.cells) && row.cells.length > 0);
  const err = typeof row.error === "string" ? row.error : "";
  if (hasTable) return null;
  if (err.length >= 20 && /(Traceback|Error)/.test(err)) return null;
  return "ok:false needs error>=20 chars containing Traceback/Error, or exposure iterations / colour cells table";
}

function checkRow(rowPath) {
  const rowDir = dirname(resolve(rowPath));
  const { row, err } = loadRow(rowPath);
  if (err) return fail(err);
  if (row.ok === false) {
    const problem = checkFailureRow(row);
    if (problem) return fail(`invalid failure row: ${problem}`);
    return ok(`well-formed failure row stage=${row.stage}`);
  }
  if (row.ok !== true) return fail("row has neither ok:true nor ok:false");
  // ok:true path: re-measure front-tone.png ourselves.
  const front = join(rowDir, "front-tone.png");
  if (!existsSync(front)) return fail("front-tone.png missing");
  if (statSync(front).size < 300000) return fail(`front-tone.png too small (${statSync(front).size}B < 300000B)`);
  const up = join(rowDir, "4up-tone.png");
  if (!existsSync(up)) return fail("4up-tone.png missing");
  const { m, err: merr } = measureFront(rowDir, front);
  if (merr) return fail(merr);
  for (const k of MEASURE_KEYS) {
    if (typeof row[k] !== "number") return fail(`row missing numeric '${k}'`);
    if (typeof m[k] !== "number") return fail(`measure.py missing numeric '${k}'`);
    if (Math.abs(row[k] - m[k]) > TOL)
      return fail(`row ${k}=${row[k]} disagrees with measured ${m[k]} (>0.005)`);
  }
  if (m.faceMeanLuminance < 0.55 || m.faceMeanLuminance > 0.7)
    return fail(`faceMeanLuminance ${m.faceMeanLuminance} outside [0.55,0.70]`);
  if (m.backgroundLuminance < 0.45 || m.backgroundLuminance > 0.55)
    return fail(`backgroundLuminance ${m.backgroundLuminance} outside [0.45,0.55]`);
  if (m.meanHairLuminance < 0.11 || m.meanHairLuminance > 0.15)
    return fail(`meanHairLuminance ${m.meanHairLuminance} outside [0.11,0.15]`);
  if (typeof row.targetHairWarmth !== "number") return fail("row missing numeric targetHairWarmth");
  if (Math.abs(m.hairWarmth - row.targetHairWarmth) > 0.08)
    return fail(`|hairWarmth-target| = ${Math.abs(m.hairWarmth - row.targetHairWarmth)} > 0.08`);
  if (m.volume < 0.12) return fail(`volume ${m.volume} < 0.12`);
  if (row.strandsAfter !== 50265) return fail(`strandsAfter ${row.strandsAfter} != 50265`);
  if (row.lightCount !== 3) return fail(`lightCount ${row.lightCount} != 3 (double-rig bug)`);
  if (!Array.isArray(row.iterations) || row.iterations.length < 1)
    return fail("iterations missing or empty");
  for (const [i, it] of row.iterations.entries()) {
    for (const k of ["faceMeanLuminance", "backgroundLuminance"]) {
      if (typeof it[k] !== "number") return fail(`iterations[${i}] missing numeric '${k}'`);
    }
  }
  return ok(
    `face=${m.faceMeanLuminance} bg=${m.backgroundLuminance} hair=${m.meanHairLuminance} warmth=${m.hairWarmth} vol=${m.volume}`
  );
}

// ---- self-test ----
const STUB_MEASURE = `#!/usr/bin/env python3
import json, sys
print(json.dumps({"faceMeanLuminance": 0.60, "backgroundLuminance": 0.50,
"meanHairLuminance": 0.128, "hairWarmth": 0.30, "volume": 0.15}))
`;

function runSelfTest() {
  const self = process.argv[1];
  const base = join(tmpdir(), `tone-selftest-${process.pid}`);
  let pass = 0,
    total = 0;
  const cases = [
    { name: "good", mutate: (r) => r, want: 0 },
    { name: "face too bright", mutate: (r, dir) => { writeFileSync(join(dir, "measure.py"), STUB_MEASURE.replace("0.60", "0.75")); r.faceMeanLuminance = 0.75; return r; }, want: 1 },
    { name: "hair too light", mutate: (r, dir) => { writeFileSync(join(dir, "measure.py"), STUB_MEASURE.replace("0.128", "0.20")); r.meanHairLuminance = 0.20; return r; }, want: 1 },
    { name: "warmth out of band", mutate: (r, dir) => { writeFileSync(join(dir, "measure.py"), STUB_MEASURE.replace('"hairWarmth": 0.30', '"hairWarmth": 0.45')); r.hairWarmth = 0.45; return r; }, want: 1 },
    { name: "lightCount 6 (old bug)", mutate: (r) => { r.lightCount = 6; return r; }, want: 1 },
    { name: "skeleton row", row: { note: "skeleton" }, want: 1 },
    { name: "short-error row", row: { ok: false, stage: "rig", blenderVersion: "5.1.1", error: "too short" }, want: 1 },
  ];
  for (const c of cases) {
    total++;
    const dir = join(base, c.name.replace(/[^a-z0-9]+/gi, "-"));
    mkdirSync(dir, { recursive: true });
    let row;
    if (c.row) {
      row = c.row;
    } else {
      writeFileSync(join(dir, "measure.py"), STUB_MEASURE);
      writeFileSync(join(dir, "front-tone.png"), Buffer.alloc(300001, 7));
      writeFileSync(join(dir, "4up-tone.png"), Buffer.alloc(100, 7));
      row = {
        ok: true,
        faceMeanLuminance: 0.6,
        backgroundLuminance: 0.5,
        meanHairLuminance: 0.128,
        hairWarmth: 0.3,
        targetHairWarmth: 0.3,
        volume: 0.15,
        strandsAfter: 50265,
        lightCount: 3,
        iterations: [{ exposureStops: -1.0, faceMeanLuminance: 0.6, backgroundLuminance: 0.5 }],
      };
      row = c.mutate(row, dir);
    }
    const rp = join(dir, "row.json");
    writeFileSync(rp, JSON.stringify(row));
    const r = spawnSync("node", [self, rp], { encoding: "utf8" });
    const good = c.want === 0 ? r.status === 0 : r.status !== 0;
    if (good) {
      pass++;
      console.log(`PASS: ${c.name}`);
    } else {
      console.log(`FAIL: ${c.name} (want exit ${c.want === 0 ? "0" : "non-zero"}, got ${r.status})`);
    }
  }
  console.log(`${pass}/${total} self-test fixtures pass`);
  return pass === total ? 0 : 1;
}

const arg = process.argv[2];
if (arg === "--self-test") process.exit(runSelfTest());
if (!arg) {
  console.error("usage: check-image-tone.mjs <row-tone.json> | --self-test");
  process.exit(1);
}
process.exit(checkRow(arg));
