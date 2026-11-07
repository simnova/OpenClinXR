// check-guides7.mjs: gate checker for hair-guides-7. Normal mode exits 1 on any MISS.
// --self-test plants a violation of each gate and requires the checker to flag it.
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const E = dirname(fileURLToPath(import.meta.url));
const row = JSON.parse(readFileSync(join(E, "row-guides7.json"), "utf8"));
const num = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return parseFloat(m[1]); };
const pair = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2])]; };
const quad = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]; };
const trio = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]; };
const CHECKS = {
  G1: { bar: "count in [536,656] and 32 pts and 0 NaN and trunc<=5%", get: (g) => quad(g.measured, /n=(\d+) pts=(\d+) nan=(\d+) trunc=([\d.]+)%/), ok: ([n, p, q, t]) => n >= 536 && n <= 656 && p === 32 && q === 0 && t <= 5.0 },
  G2: { bar: "0 inside and min>=1.5mm", get: (g) => pair(g.measured, /inside=(\d+) min=([\d.]+)mm/), ok: ([i, m]) => i === 0 && m >= 1.5 },
  G3: { bar: "eye in [0.32,0.41] and jaw in [0.38,0.50]", get: (g) => pair(g.measured, /eye=([\d.]+) jaw=([\d.]+)/), ok: ([e, j]) => e >= 0.32 && e <= 0.41 && j >= 0.38 && j <= 0.50 },
  G4: { bar: "<=20 skin px per side and profile pinna hair>=90%", get: (g) => trio(g.measured, /earSkinL=(\d+) earSkinR=(\d+) profHair=([\d.]+)/), ok: ([l, r, f]) => l <= 20 && r <= 20 && f >= 0.90 },
  G5: { bar: "ear within ±10% of 86.3 and hem within ±10% of 120.7", get: (g) => pair(g.measured, /ear=([\d.]+)mm hem=([\d.]+)mm/), ok: ([e, h]) => Math.abs(e - 86.3) / 86.3 <= 0.10 && Math.abs(h - 120.7) / 120.7 <= 0.10 },
  G6: { bar: "p95<=10 and max<=45 and 0 short", get: (g) => trio(g.measured, /p95=([\d.eE+-]+) max=([\d.eE+-]+) short=(\d+)/), ok: ([p, m, s]) => p <= 10 && m <= 45 && s === 0 },
  G7: { bar: "ear-row neighbour gap<=8mm", get: (g) => num(g.measured, /maxgap=([\d.]+)mm/), ok: (v) => v <= 8.0 },
  G8: { bar: "0 hair px in eye box", get: (g) => parseInt(num(g.measured, /hairPx=(\d+)/), 10), ok: (v) => v === 0 },
};
const PLANT = {
  G1: "n=400 pts=32 nan=0 trunc=0.0%",
  G2: "inside=1 min=3.00mm",
  G3: "eye=0.500 jaw=0.402",
  G4: "earSkinL=21 earSkinR=0 profHair=0.95",
  G5: "ear=60.0mm hem=120.7mm",
  G6: "p95=9.00 max=10.00 short=1",
  G7: "maxgap=8.10mm",
  G8: "hairPx=1",
};
const byGate = Object.fromEntries(row.gates.map((g) => [g.gate, g]));
function verdict(gate, measured) {
  const c = CHECKS[gate];
  return c.ok(c.get({ measured })) ? "PASS" : "MISS";
}
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  let fail = 0;
  for (const gate of Object.keys(CHECKS)) {
    const g = byGate[gate];
    if (!g) { console.log("SELF-TEST " + gate + ": gate missing from row-guides7.json"); fail++; continue; }
    const base = verdict(gate, g.measured);
    const v = verdict(gate, PLANT[gate]);
    if (v !== "MISS") { console.log("SELF-TEST " + gate + ": planted violation NOT caught"); fail++; }
    else console.log("SELF-TEST " + gate + ": planted violation -> MISS ok (recorded " + base + ")");
  }
  const need = ["guides7.py", "guides7.npz", "guides7-debug.png", "guides-front-mask.png", "guides-profile-mask.png", "target-vs-guides7.png", "before-after.png", "blend-sheet.png", "row-guides7.json", "RESULT.txt", "blend/passB/front.png", "blend/passB/front-id.png", "blend/passB/profile_90.png", "blend/judge-passB/overlay-blend-passB.png", "blend/blend-A.json", "blend/blend-B.json"];
  for (const f of need) if (!existsSync(join(E, f))) { console.log("SELF-TEST file missing: " + f); fail++; }
  console.log(fail === 0 ? "SELF-TEST ALL CAUGHT" : "SELF-TEST FAILURES=" + fail);
  process.exit(fail === 0 ? 0 : 1);
}
let miss = 0;
for (const gate of Object.keys(CHECKS)) {
  const g = byGate[gate];
  if (!g) { console.log(gate + ": MISSING from row-guides7.json"); miss++; continue; }
  const v = verdict(gate, g.measured);
  console.log(gate + " " + g.measured + " | " + g.bar + " " + v);
  if (v === "MISS") miss++;
}
console.log(miss === 0 ? "ALL PASS" : "MISSES=" + miss);
process.exit(miss === 0 ? 0 : 1);
