// check-guides11.mjs — gate checker for hair-guides-11 S2.
// Usage: node check-guides11.mjs [--row <path>] [--self-test]
// Recomputes every G2..G8 verdict from row measurements (never trusts verdict
// strings). Exit 0 iff all gates PASS (or all self-tests behave).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const rowPath = (argvVal("--row") || join(DIR, "row-guides11.json"));

function argvVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function checkRow(r) {
  const fails = [];
  const n = r.count, nr = r.n_roots;
  if (!(0.9 * nr <= n && n <= 1.1 * nr)) fails.push(`G2:count n=${n} roots=${nr}`);
  if (!r.g2?.pts32) fails.push("G2:pts32");
  if ((r.g2?.nan ?? 1) !== 0) fails.push(`G2:nan=${r.g2?.nan}`);
  if ((r.contact_ended_frac ?? 100) > 8.0) fails.push(`G2:ce=${r.contact_ended_frac}`);
  if ((r.g2?.short_frac ?? 1) > 0.01) fails.push(`G2:short=${r.g2?.short_frac}`);
  if ((r.g2?.zero ?? 1) !== 0) fails.push(`G2:zero=${r.g2?.zero}`);
  if ((r.g3?.frac_pct ?? 100) > 2.0) fails.push(`G3:curtain=${r.g3?.frac_pct}`);
  if ((r.g3?.earfront ?? 1) !== 0) fails.push(`G3:earfront=${r.g3?.earfront}`);
  if ((r.g4?.cover?.L ?? 0) < 0.90) fails.push(`G4:coverL=${r.g4?.cover?.L}`);
  if ((r.g4?.cover?.R ?? 0) < 0.90) fails.push(`G4:coverR=${r.g4?.cover?.R}`);
  if ((r.g4?.ear_row?.L?.maxgap_mm ?? 999) > 12.0) fails.push(`G4:gapL=${r.g4?.ear_row?.L?.maxgap_mm}`);
  if ((r.g4?.ear_row?.R?.maxgap_mm ?? 999) > 12.0) fails.push(`G4:gapR=${r.g4?.ear_row?.R?.maxgap_mm}`);
  if ((r.g4?.gap_balance ?? 0) < 0.80) fails.push(`G4:balance=${r.g4?.gap_balance}`);
  if ((r.g5?.face ?? 1) !== 0) fails.push(`G5:face=${r.g5?.face}`);
  if ((r.g5?.forehead ?? 1) !== 0) fails.push(`G5:forehead=${r.g5?.forehead}`);
  if ((r.g6?.inside ?? 1) !== 0) fails.push(`G6:inside=${r.g6?.inside}`);
  if ((r.g6?.min_mm ?? 0) < 1.0) fails.push(`G6:min=${r.g6?.min_mm}`);
  if ((r.g7?.p95 ?? 999) > 10) fails.push(`G7:p95=${r.g7?.p95}`);
  if ((r.g7?.max ?? 999) > 45) fails.push(`G7:max=${r.g7?.max}`);
  if (Math.abs((r.g8?.hem_hh ?? 999) - 0.73) > 0.06) fails.push(`G8:hem=${r.g8?.hem_hh}`);
  return fails;
}

function passRow() {
  return {
    count: 600, n_roots: 600, contact_ended_frac: 2.0,
    g2: { pts32: true, nan: 0, short_frac: 0.001, zero: 0 },
    g3: { frac_pct: 0.5, earfront: 0 },
    g4: { cover: { L: 0.95, R: 0.95 }, ear_row: { L: { maxgap_mm: 8 }, R: { maxgap_mm: 9 } }, gap_balance: 0.89 },
    g5: { face: 0, forehead: 0 },
    g6: { inside: 0, min_mm: 1.5 },
    g7: { p95: 5, max: 30 },
    g8: { hem_hh: 0.73 },
  };
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["G2count", (r) => { r.count = Math.round(1.5 * r.n_roots); }],
    ["G2pts", (r) => { r.g2.pts32 = false; }],
    ["G2nan", (r) => { r.g2.nan = 3; }],
    ["G2ce", (r) => { r.contact_ended_frac = 9.0; }],
    ["G2short", (r) => { r.g2.short_frac = 0.05; }],
    ["G2zero", (r) => { r.g2.zero = 2; }],
    ["G3curtain", (r) => { r.g3.frac_pct = 5.0; }],
    ["G3earfront", (r) => { r.g3.earfront = 4; }],
    ["G4coverL", (r) => { r.g4.cover.L = 0.5; }],
    ["G4coverR", (r) => { r.g4.cover.R = 0.5; }],
    ["G4gapL", (r) => { r.g4.ear_row.L.maxgap_mm = 30; }],
    ["G4gapR", (r) => { r.g4.ear_row.R.maxgap_mm = 30; }],
    ["G4balance", (r) => { r.g4.gap_balance = 0.5; }],
    ["G5face", (r) => { r.g5.face = 7; }],
    ["G5forehead", (r) => { r.g5.forehead = 7; }],
    ["G6inside", (r) => { r.g6.inside = 12; }],
    ["G6min", (r) => { r.g6.min_mm = 0.2; }],
    ["G7p95", (r) => { r.g7.p95 = 20; }],
    ["G7max", (r) => { r.g7.max = 90; }],
    ["G8hem", (r) => { r.g8.hem_hh = 0.4; }],
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
for (const f of ["guides11.npz", "guides11-debug.png"]) {
  if (!existsSync(join(DIR, f))) { console.log(`FAIL missing ${f}`); process.exit(1); }
}
console.log("ALL GATES PASS");
