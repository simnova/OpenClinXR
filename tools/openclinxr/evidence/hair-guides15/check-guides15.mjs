// check-guides15.mjs — gate checker for hair-guides-15.
// Usage: node check-guides14.mjs [--row <path>] [--self-test]
// Recomputes every G1..G9 verdict from row measurements (never trusts verdict
// strings). Exit 0 iff all gates PASS (or all self-tests behave).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const rowPath = (argvVal("--row") || join(DIR, "row-guides15.json"));

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
  if ((r.g4?.inside ?? 99) > 5) fails.push(`G4:inside=${r.g4?.inside}`);
  if ((r.g4?.deep_mm ?? 99) > 1.0) fails.push(`G4:deep=${r.g4?.deep_mm}`);
  if ((r.g5?.nape_edge_frac ?? 1) > 0.10) fails.push(`G5:nape=${r.g5?.nape_edge_frac}`);
  if ((r.g5?.front_lo ?? 99) !== 0) fails.push(`G5:frontlo=${r.g5?.front_lo}`);
  if ((r.g6?.backfill_ratio ?? 0) < 0.90) fails.push(`G6:fill=${r.g6?.backfill_ratio}`);
  if ((r.g6?.travel_viol ?? 99) !== 0) fails.push(`G6:travel=${r.g6?.travel_viol}`);
  if ((r.g7?.horiz ?? 99) > 0.01 * (r.count ?? 0)) fails.push(`G7:horiz=${r.g7?.horiz}/${r.count}`);
  if ((r.g8?.cover?.L ?? 0) < 0.90) fails.push(`G8:coverL=${r.g8?.cover?.L}`);
  if ((r.g8?.cover?.R ?? 0) < 0.90) fails.push(`G8:coverR=${r.g8?.cover?.R}`);
  if ((r.g8?.gapL_hh ?? 0) < 0.85 * 0.2266) fails.push(`G8:gapL=${r.g8?.gapL_hh}`);
  if ((r.g8?.gapL_hh ?? 99) > 1.35 * 0.2266) fails.push(`G8:gapLhi=${r.g8?.gapL_hh}`);
  if ((r.g8?.gapR_hh ?? 0) < 0.85 * 0.2100) fails.push(`G8:gapR=${r.g8?.gapR_hh}`);
  if ((r.g8?.gapR_hh ?? 99) > 1.35 * 0.2100) fails.push(`G8:gapRhi=${r.g8?.gapR_hh}`);
  if ((r.g8?.face ?? 1) !== 0) fails.push(`G8:face=${r.g8?.face}`);
  if ((r.g9?.hem_bad ?? 1) !== 0) fails.push(`G9:hembad=${r.g9?.hem_bad}`);
  return fails;
}

function passRow() {
  return {
    count: 590, n_roots: 600, crown_z: 1.6599,
    g1: { p95_mm: 0.0, max_mm: 0.0 },
    g2: { pts32: true, nan: 0, short: 0, zero: 0 },
    g3: { behind_viol: 0, front: 0 },
    g4: { inside: 2, deep_mm: 0.5 },
    g5: { liftoff_med_z: 1.56, nape_edge_frac: 0.02, front_lo: 0 },
    g6: { backfill_ratio: 0.95, travel_viol: 0 },
    g7: { horiz: 0 },
    g8: { cover: { L: 0.93, R: 0.93 }, gapL_hh: 0.20, gapR_hh: 0.19, face: 0 },
    g9: { hem_bad: 0 },
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
    ["G4deep", (r) => { r.g4.deep_mm = 2.5; }],
    ["G5nape", (r) => { r.g5.nape_edge_frac = 0.5; }],
    ["G5frontlo", (r) => { r.g5.front_lo = 9; }],
    ["G6fill", (r) => { r.g6.backfill_ratio = 0.4; }],
    ["G6travel", (r) => { r.g6.travel_viol = 30; }],
    ["G7horiz", (r) => { r.g7.horiz = 25; }],
    ["G8coverL", (r) => { r.g8.cover.L = 0.5; }],
    ["G8coverR", (r) => { r.g8.cover.R = 0.5; }],
    ["G8gapL", (r) => { r.g8.gapL_hh = 0.05; }],
    ["G8gapLhi", (r) => { r.g8.gapL_hh = 0.40; }],
    ["G8gapRhi", (r) => { r.g8.gapR_hh = 0.40; }],
    ["G8gapR", (r) => { r.g8.gapR_hh = 0.05; }],
    ["G8face", (r) => { r.g8.face = 7; }],
    ["G9hem", (r) => { r.g9.hem_bad = 30; }],
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
for (const f of ["guides14.npz", "guides14-debug.png", "target-vs-guides14.png", "row-guides14.json"]) {
  if (!existsSync(join(DIR, f))) { console.log(`FAIL missing ${f}`); process.exit(1); }
}
if (!existsSync(join(DIR, "..", "hair-guides12", "heightfields.npz"))) {
  console.log("FAIL missing reused ../hair-guides12/heightfields.npz"); process.exit(1);
}
console.log("ALL GATES PASS");
