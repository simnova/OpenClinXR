// check-guides13.mjs — gate checker for hair-guides-13.
// Usage: node check-guides13.mjs [--row <path>] [--self-test]
// Recomputes every G1..G9 verdict from row measurements (never trusts verdict
// strings). Exit 0 iff all gates PASS (or all self-tests behave).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const rowPath = (argvVal("--row") || join(DIR, "row-guides13.json"));

function argvVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function checkRow(r) {
  const fails = [];
  if ((r.g1?.p95_mm ?? 999) > 0.5) fails.push(`G1:p95=${r.g1?.p95_mm}`);
  if ((r.g1?.max_mm ?? 999) > 2.0) fails.push(`G1:max=${r.g1?.max_mm}`);
  if (!((r.count ?? 0) >= 0.95 * (r.n_roots ?? 1))) fails.push(`G2:count=${r.count}/${r.n_roots}`);
  if (!r.g2?.pts32) fails.push("G2:pts32");
  if ((r.g2?.nan ?? 1) !== 0) fails.push(`G2:nan=${r.g2?.nan}`);
  if ((r.g2?.short ?? 1) !== 0) fails.push(`G2:short=${r.g2?.short}`);
  if ((r.g2?.zero ?? 1) !== 0) fails.push(`G2:zero=${r.g2?.zero}`);
  if ((r.g3?.behind_viol ?? 1) !== 0) fails.push(`G3:behind=${r.g3?.behind_viol}`);
  if ((r.g3?.front ?? 1) !== 0) fails.push(`G3:front=${r.g3?.front}`);
  if ((r.g4?.inside ?? 1) !== 0) fails.push(`G4:inside=${r.g4?.inside}`);
  if ((r.g4?.min_mm ?? 0) < 2.0) fails.push(`G4:min=${r.g4?.min_mm}`);
  const lo = (r.crown_z ?? 1.66) - 0.15, hi = (r.crown_z ?? 1.66) - 0.06;
  if (!((r.g5?.liftoff_med_z ?? -1) >= lo && (r.g5?.liftoff_med_z ?? 999) <= hi))
    fails.push(`G5:med=${r.g5?.liftoff_med_z}`);
  if ((r.g5?.nape_edge_frac ?? 1) > 0.10) fails.push(`G5:nape=${r.g5?.nape_edge_frac}`);
  if ((r.g6?.cover?.L ?? 0) < 0.90) fails.push(`G6:coverL=${r.g6?.cover?.L}`);
  if ((r.g6?.cover?.R ?? 0) < 0.90) fails.push(`G6:coverR=${r.g6?.cover?.R}`);
  if ((r.g6?.hull_inside ?? 1) !== 0) fails.push(`G6:hull=${r.g6?.hull_inside}`);
  if ((r.g7?.zig_frac ?? 1) > 0.01) fails.push(`G7:zig=${r.g7?.zig_frac}`);
  if ((r.g7?.p95 ?? 999) > 20) fails.push(`G7:p95=${r.g7?.p95}`);
  if ((r.g8?.hem_bad ?? 1) !== 0) fails.push(`G8:hembad=${r.g8?.hem_bad}`);
  if ((r.g9?.face ?? 1) !== 0) fails.push(`G9:face=${r.g9?.face}`);
  if ((r.g9?.forehead ?? 99) > 10) fails.push(`G9:forehead=${r.g9?.forehead}`);
  return fails;
}

function passRow() {
  return {
    count: 590, n_roots: 600, crown_z: 1.6599,
    g1: { p95_mm: 0.0, max_mm: 0.0 },
    g2: { pts32: true, nan: 0, short: 0, zero: 0 },
    g3: { behind_viol: 0, front: 0 },
    g4: { inside: 0, min_mm: 2.5 },
    g5: { liftoff_med_z: 1.56, nape_edge_frac: 0.02 },
    g6: { cover: { L: 0.93, R: 0.93 }, hull_inside: 0 },
    g7: { zig_frac: 0.0, p95: 12 },
    g8: { hem_bad: 0 },
    g9: { face: 0, forehead: 3 },
  };
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["G1p95", (r) => { r.g1.p95_mm = 1.2; }],
    ["G1max", (r) => { r.g1.max_mm = 5.0; }],
    ["G2count", (r) => { r.count = Math.round(0.5 * r.n_roots); }],
    ["G2pts", (r) => { r.g2.pts32 = false; }],
    ["G2nan", (r) => { r.g2.nan = 3; }],
    ["G2short", (r) => { r.g2.short = 2; }],
    ["G2zero", (r) => { r.g2.zero = 1; }],
    ["G3behind", (r) => { r.g3.behind_viol = 4; }],
    ["G3front", (r) => { r.g3.front = 4; }],
    ["G4inside", (r) => { r.g4.inside = 12; }],
    ["G4min", (r) => { r.g4.min_mm = 0.5; }],
    ["G5med", (r) => { r.g5.liftoff_med_z = 1.40; }],
    ["G5nape", (r) => { r.g5.nape_edge_frac = 0.5; }],
    ["G6coverL", (r) => { r.g6.cover.L = 0.5; }],
    ["G6coverR", (r) => { r.g6.cover.R = 0.5; }],
    ["G6hull", (r) => { r.g6.hull_inside = 9; }],
    ["G7zig", (r) => { r.g7.zig_frac = 0.05; }],
    ["G7p95", (r) => { r.g7.p95 = 40; }],
    ["G8hem", (r) => { r.g8.hem_bad = 30; }],
    ["G9face", (r) => { r.g9.face = 7; }],
    ["G9forehead", (r) => { r.g9.forehead = 40; }],
  ];
  let bad = 0;
  const okBase = checkRow(passRow());
  if (okBase.length !== 0) { console.log(`SELF-TEST template fails clean: ${okBase}`); bad++; }
  for (const [name, mut] of cases) {
    const r = passRow(); mut(r);
    const f = checkRow(r);
    if (f.length === 0) { console.log(`SELF-TEST ${name}: planted violation NOT caught`); bad++; }
    else console.log(`SELF-TEST ${name}: caught (${f[0]})`);
  }
  if (bad) { console.log(`SELF-TEST ${bad} problems`); process.exit(1); }
  console.log("SELF-TEST all planted violations caught, clean row passes");
  process.exit(0);
}

const row = JSON.parse(readFileSync(rowPath, "utf8"));
const fails = checkRow(row);
for (const g of (row.gates || [])) console.log(`${g.gate} ${g.measured} | ${g.bar} ${g.verdict}`);
if (fails.length) { console.log(`FAIL ${fails.join("; ")}`); process.exit(1); }
for (const f of ["guides13.npz", "guides13-debug.png", "target-vs-guides13.png", "row-guides13.json"]) {
  if (!existsSync(join(DIR, f))) { console.log(`FAIL missing ${f}`); process.exit(1); }
}
if (!existsSync(join(DIR, "..", "hair-guides12", "heightfields.npz"))) {
  console.log("FAIL missing reused ../hair-guides12/heightfields.npz"); process.exit(1);
}
console.log("ALL GATES PASS");
