// check-guides5.mjs: gate checker for hair-guides-5. Normal mode exits 1 on any MISS.
// --self-test plants a violation of each gate and requires the checker to flag it.
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const E = dirname(fileURLToPath(import.meta.url));
const row = JSON.parse(readFileSync(join(E, "row-guides5.json"), "utf8"));
const pair = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2])]; };
const one = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return parseFloat(m[1]); };
const trio = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]; };
const CHECKS = {
  G1: { bar: "n in [550,800] and 0 fail cells", get: (g) => pair(g.measured, /n=(\d+) lay=.*fail=(\d+)/), ok: ([n, f]) => n >= 550 && n <= 800 && f === 0 },
  G2: { bar: "inside=0 and min>=2mm and m12<=5%", get: (g) => trio(g.measured, /inside=(\d+) min=([\d.]+)mm m12=\d+\(([\d.]+)%\)/), ok: ([i, m, p]) => i === 0 && m >= 2 && p <= 5 },
  G3: { bar: "s40>=90% and s80>=95% within 3mm (skull)", get: (g) => pair(g.measured, /s40=\d+\/\d+\(([\d.]+)\) s80=\d+\/\d+\(([\d.]+)\)/), ok: ([a, b]) => a >= 0.90 && b >= 0.95 },
  G4: { bar: "p95<=8 and max<=25 deg/cm and 0 short", get: (g) => trio(g.measured, /p95=([\d.eE+-]+) max=([\d.eE+-]+) short=(\d+)/), ok: ([p, m, s]) => p <= 8 && m <= 25 && s === 0 },
  G5: { bar: "max<=9mm and slit<=4mm", get: (g) => pair(g.measured, /max=([\d.]+)mm slitmax=([\d.]+)mm/), ok: ([m, s]) => m <= 9.0 && s <= 4.0 },
  G6: { bar: "face gap ratio in [0.85,1.10]", get: (g) => one(g.measured, /gap=[\d.]+mm ratio=([\d.]+) \(ours [\d.]+H/), ok: (r) => r >= 0.85 && r <= 1.10 },
  G7: { bar: "outer ear width within 8% of 86.3mm", get: (g) => one(g.measured, /outer-ear=[\d.]+mm ratio=([\d.]+) vs/), ok: (r) => r >= 0.92 && r <= 1.08 },
  G8: { bar: "0 splay points", get: (g) => one(g.measured, /splay-points=(\d+)/), ok: (n) => n === 0 },
};
const byGate = Object.fromEntries(row.gates.map((g) => [g.gate, g]));
function verdict(gate, measured) {
  const c = CHECKS[gate];
  return c.ok(c.get({ measured })) ? "PASS" : "MISS";
}
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  const PLANT = {
    G1: "n=100 lay={0: 0.25, 1: 0.25, 2: 0.25, 3: 0.25} minpatch=4 fail=0",
    G2: "inside=1 min=3.00mm m12=0(0.0%)",
    G3: "s40=10/700(0.014) s80=650/700(0.929)",
    G4: "p95=9.00 max=10.00 short=0",
    G5: "max=10.00mm slitmax=2.00mm",
    G6: "gap=40.0mm ratio=0.500 (ours 0.175H vs tgt 0.350H)",
    G7: "outer-ear=130.0mm ratio=1.506 vs 86.3mm",
    G8: "splay-points=5",
  };
  let fail = 0;
  for (const gate of Object.keys(CHECKS)) {
    const g = byGate[gate];
    if (!g) { console.log("SELF-TEST " + gate + ": gate missing from row-guides5.json"); fail++; continue; }
    const base = verdict(gate, g.measured);
    const v = verdict(gate, PLANT[gate]);
    if (v !== "MISS") { console.log("SELF-TEST " + gate + ": planted violation NOT caught"); fail++; }
    else console.log("SELF-TEST " + gate + ": planted violation -> MISS ok (recorded " + base + ")");
  }
  const need = ["guides5.py", "guides5.npz", "guides5-debug.png", "target-vs-guides5.png", "guides5-front-mask.png", "row-guides5.json", "RESULT-guides5.txt"];
  for (const f of need) if (!existsSync(join(E, f))) { console.log("SELF-TEST file missing: " + f); fail++; }
  console.log(fail === 0 ? "SELF-TEST ALL CAUGHT" : "SELF-TEST FAILURES=" + fail);
  process.exit(fail === 0 ? 0 : 1);
}
let miss = 0;
for (const [gate, c] of Object.entries(CHECKS)) {
  const g = byGate[gate];
  if (!g) { console.log(gate + ": MISSING from row-guides5.json"); miss++; continue; }
  const v = verdict(gate, g.measured);
  const agree = v === g.verdict ? "agree" : "VERDICT-MISMATCH(recorded " + g.verdict + ")";
  console.log(gate + " " + g.measured + " | " + c.bar + " " + v + " " + agree);
  if (v !== "PASS" || agree.startsWith("VERDICT")) miss++;
}
process.exit(miss === 0 ? 0 : 1);
