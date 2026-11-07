// check-guides12.mjs — gate checker for hair-guides-12 S2.
// Usage: node check-guides12.mjs [--row <path>] [--self-test]
// Recomputes every G1..G8 verdict from row measurements (never trusts verdict
// strings). Exit 0 iff all gates PASS (or all self-tests behave).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const rowPath = (argvVal("--row") || join(DIR, "row-guides12.json"));

function argvVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function checkRow(r) {
  const fails = [];
  if ((r.g1?.p95_mm ?? 999) > 0.5) fails.push(`G1:p95=${r.g1?.p95_mm}`);
  if ((r.g1?.max_mm ?? 999) > 2.0) fails.push(`G1:max=${r.g1?.max_mm}`);
  if (!((r.count ?? 0) >= 0.9 * (r.n_roots ?? 1))) fails.push(`G2:count=${r.count}/${r.n_roots}`);
  if (!r.g2?.pts32) fails.push("G2:pts32");
  if ((r.g2?.nan ?? 1) !== 0) fails.push(`G2:nan=${r.g2?.nan}`);
  if ((r.g2?.short ?? 1) !== 0) fails.push(`G2:short=${r.g2?.short}`);
  if ((r.g2?.zero ?? 1) !== 0) fails.push(`G2:zero=${r.g2?.zero}`);
  if ((r.g3?.behind_viol ?? 1) !== 0) fails.push(`G3:behind=${r.g3?.behind_viol}`);
  if ((r.g3?.front ?? 1) !== 0) fails.push(`G3:front=${r.g3?.front}`);
  if ((r.g4?.inside ?? 1) !== 0) fails.push(`G4:inside=${r.g4?.inside}`);
  if ((r.g4?.min_mm ?? 0) < 2.0) fails.push(`G4:min=${r.g4?.min_mm}`);
  if ((r.g5?.cover?.L ?? 0) < 0.95) fails.push(`G5:coverL=${r.g5?.cover?.L}`);
  if ((r.g5?.cover?.R ?? 0) < 0.95) fails.push(`G5:coverR=${r.g5?.cover?.R}`);
  if ((r.g5?.face ?? 1) !== 0) fails.push(`G5:face=${r.g5?.face}`);
  if ((r.g5?.forehead ?? 1) !== 0) fails.push(`G5:forehead=${r.g5?.forehead}`);
  if ((r.g6?.p95 ?? 999) > 8) fails.push(`G6:p95=${r.g6?.p95}`);
  if ((r.g6?.max ?? 999) > 30) fails.push(`G6:max=${r.g6?.max}`);
  if (Math.abs((r.g7?.hem_hh ?? 999) - 0.73) > 0.04) fails.push(`G7:hem=${r.g7?.hem_hh}`);
  if ((r.g7?.tipstd_mm ?? 999) > 8.0) fails.push(`G7:tipstd=${r.g7?.tipstd_mm}`);
  if (Math.abs((r.g8?.angle_ours ?? 999) - (r.g8?.angle_ts ?? 0)) > 12.0) fails.push(`G8:angle=${r.g8?.angle_ours}vs${r.g8?.angle_ts}`);
  if (Math.abs((r.g8?.ratio_ours ?? 999) - (r.g8?.ratio_ts ?? 1)) / (r.g8?.ratio_ts ?? 1) > 0.15) fails.push(`G8:ratio=${r.g8?.ratio_ours}vs${r.g8?.ratio_ts}`);
  return fails;
}

function passRow() {
  return {
    count: 590, n_roots: 600,
    g1: { p95_mm: 0.0, max_mm: 0.0 },
    g2: { pts32: true, nan: 0, short: 0, zero: 0 },
    g3: { behind_viol: 0, front: 0 },
    g4: { inside: 0, min_mm: 2.5 },
    g5: { cover: { L: 0.97, R: 0.97 }, face: 0, forehead: 0 },
    g6: { p95: 5, max: 20 },
    g7: { hem_hh: 0.73, tipstd_mm: 3.5 },
    g8: { angle_ours: 21.0, angle_ts: 21.4, ratio_ours: 1.26, ratio_ts: 1.26 },
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
    ["G5coverL", (r) => { r.g5.cover.L = 0.5; }],
    ["G5coverR", (r) => { r.g5.cover.R = 0.5; }],
    ["G5face", (r) => { r.g5.face = 7; }],
    ["G5forehead", (r) => { r.g5.forehead = 7; }],
    ["G6p95", (r) => { r.g6.p95 = 20; }],
    ["G6max", (r) => { r.g6.max = 90; }],
    ["G7hem", (r) => { r.g7.hem_hh = 0.4; }],
    ["G7tipstd", (r) => { r.g7.tipstd_mm = 20; }],
    ["G8angle", (r) => { r.g8.angle_ours = 60.0; }],
    ["G8ratio", (r) => { r.g8.ratio_ours = 2.5; }],
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
for (const f of ["guides12.npz", "guides12-debug.png", "target-vs-guides12.png", "heightfields.npz", "heightfields-debug.png"]) {
  if (!existsSync(join(DIR, f))) { console.log(`FAIL missing ${f}`); process.exit(1); }
}
console.log("ALL GATES PASS");
