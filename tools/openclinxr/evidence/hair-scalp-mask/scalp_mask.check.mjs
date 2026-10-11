import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const script = join(dir, "scalp_mask.py");
const fixtures = join(dir, "fixtures");
mkdirSync(fixtures, { recursive: true });

// deterministic synthetic roots: seeded grid 24x24 + 40 on centre line
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry(69);
const grid = [];
for (let j = 0; j < 24; j++)
  for (let i = 0; i < 24; i++)
    grid.push([(i + rng()) / 24, (j + rng()) / 24]);
const centreExtra = [];
for (let k = 0; k < 40; k++) centreExtra.push([0.5, rng()]);
const roots = [...grid, ...centreExtra];
writeFileSync(join(fixtures, "synthetic-roots.json"), JSON.stringify({ roots }));

function runMask(input, extraArgs = []) {
  const p = join(tmpdir(), "scalp-mask-tmp.json");
  writeFileSync(p, JSON.stringify(input));
  const r = spawnSync("python3", [script, p, ...extraArgs], { encoding: "utf8" });
  return r;
}

let pass = 0;
function check(name, cond, detail = "") {
  if (!cond) { console.error(`FAIL ${name} ${detail}`); process.exitCode = 1; }
  else { pass++; console.log(`ok ${name}`); }
}

const base = { hairlineRatio: 0.62, partSide: "center", partWidthMm: 2, uvWidthMm: 160, roots };

// (1) below-hairline removal
{
  const r = runMask(base, ["--json"]);
  check("(1) exits 0", r.status === 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const expected = roots.filter(([, v]) => v > 0.62).length;
  check("(1) removedBelowHairline matches", out.removedBelowHairline === expected, `${out.removedBelowHairline} vs ${expected}`);
  check("(1) no kept root below hairline", out.keepIndices.every((i) => roots[i][1] <= 0.62));
}

// (2) part gap
{
  const out = JSON.parse(runMask(base, ["--json"]).stdout);
  check("(2) gap within 1mm of 2.0", Math.abs(out.partGapMm - 2.0) <= 1.0, `gap=${out.partGapMm}`);
  const gridOnly = { ...base, roots: grid };
  const out2 = JSON.parse(runMask(gridOnly, ["--json"]).stdout);
  check("(2) grid-only gap >= 1.0", out2.partGapMm >= 1.0, `gap=${out2.partGapMm}`);
}

// (3) partSide none keeps all above hairline
{
  const out = JSON.parse(runMask({ ...base, partSide: "none" }, ["--json"]).stdout);
  const expected = roots.map(([, v], i) => (v <= 0.62 ? i : -1)).filter((i) => i >= 0);
  check("(3) none keeps all v<=hairline", JSON.stringify(out.keepIndices) === JSON.stringify(expected));
}

// (4) determinism
{
  const a = runMask(base, ["--json"]).stdout;
  const b = runMask(base, ["--json"]).stdout;
  check("(4) byte-identical", a === b);
}

// (5) invalid hairlineRatio
{
  const r = runMask({ ...base, hairlineRatio: 0.2 }, ["--json"]);
  check("(5) exits non-zero", r.status !== 0);
  check("(5) message names hairlineRatio", (r.stderr || "").includes("hairlineRatio"), r.stderr);
}

// (6) count guard
{
  const out = JSON.parse(runMask(base, ["--json"]).stdout);
  check("(6) keeps >= 30%", out.keepIndices.length >= 0.3 * roots.length, `${out.keepIndices.length}/${roots.length}`);
}

// mask image smoke: 1024x1024 file written
{
  const mp = join(tmpdir(), "scalp-mask.png");
  const r = runMask(base, ["--out-mask", mp]);
  check("(mask) exits 0", r.status === 0, r.stderr);
  check("(mask) file written", statSync(mp).size > 1000);
}

console.log(`done: ${pass} checks passed`);
