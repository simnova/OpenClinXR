// check-guides8.mjs: gate checker for hair-guides-8 (per cell A/B).
// Normal mode exits 1 unless at least one cell passes all 8 gates.
// --self-test plants a violation of each gate and requires the checker to flag it.
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const E = dirname(fileURLToPath(import.meta.url));
const row = JSON.parse(readFileSync(join(E, "row-guides8.json"), "utf8"));
const num = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return parseFloat(m[1]); };
const pair = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2])]; };
const quad = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]; };
const trio = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]; };
const quint = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5])]; };
const CHECKS = {
  G1: { bar: "count in [536,656] and 32 pts and 0 NaN and ce<=8%", get: (g) => quad(g.measured, /n=(\d+) pts=(\d+) nan=(\d+) ce=([\d.]+)%/), ok: ([n, p, q, t]) => n >= 536 && n <= 656 && p === 32 && q === 0 && t <= 8.0 },
  G2: { bar: "0 inside and min>=1.0mm", get: (g) => pair(g.measured, /inside=(\d+) min=([\d.]+)mm/), ok: ([i, m]) => i === 0 && m >= 1.0 },
  G3: { bar: "per-side half-gap eye in [0.85,1.15]x0.175H, jaw in [0.80,1.20]x0.2185H", get: (g) => quint(g.measured, /eyeL=([\d.]+)px eyeR=([\d.]+)px jawL=([\d.]+)px jawR=([\d.]+)px H=([\d.]+)px/), ok: ([el, er, jl, jr, H]) => el >= 0.85 * 0.175 * H && el <= 1.15 * 0.175 * H && er >= 0.85 * 0.175 * H && er <= 1.15 * 0.175 * H && jl >= 0.80 * 0.2185 * H && jl <= 1.20 * 0.2185 * H && jr >= 0.80 * 0.2185 * H && jr <= 1.20 * 0.2185 * H },
  G4: { bar: "<=20 skin px per side and profile pinna hair>=95%", get: (g) => trio(g.measured, /earSkinL=(\d+) earSkinR=(\d+) profHair=([\d.]+)/), ok: ([l, r, f]) => l <= 20 && r <= 20 && f >= 0.95 },
  G5: { bar: "per-side ear-row neighbour gap<=10mm (no wrap)", get: (g) => pair(g.measured, /Lgap=([\d.]+)mm Rgap=([\d.]+)mm/), ok: ([l, r]) => l <= 10.0 && r <= 10.0 },
  G6: { bar: "p95<=12 and max<=45 and short<=1%", get: (g) => trio(g.measured, /p95=([\d.eE+-]+) max=([\d.eE+-]+) short=([\d.]+)%/), ok: ([p, m, s]) => p <= 12 && m <= 45 && s <= 1.0 },
  G7: { bar: "0 hair px in eye box", get: (g) => parseInt(num(g.measured, /hairPx=(\d+)/), 10), ok: (v) => v === 0 },
  G8: { bar: "IoU>=0.636 and width_rms<=0.208", get: (g) => pair(g.measured, /IoU=([\d.]+) width=([\d.]+)/), ok: ([i, w]) => i >= 0.636 && w <= 0.208 },
};
const PLANT = {
  G1: "n=400 pts=32 nan=0 ce=0.0%",
  G2: "inside=1 min=3.00mm",
  G3: "eyeL=10.0px eyeR=84.0px jawL=104.0px jawR=104.0px H=480.0px",
  G4: "earSkinL=21 earSkinR=0 profHair=0.99",
  G5: "Lgap=10.10mm Rgap=5.00mm",
  G6: "p95=9.00 max=10.00 short=0.000%",
  G7: "hairPx=1",
  G8: "IoU=0.635 width=0.150",
};
function verdict(gate, measured) {
  const c = CHECKS[gate];
  return c.ok(c.get({ measured })) ? "PASS" : "MISS";
}
const cells = row.cells || {};
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  let fail = 0;
  for (const cell of ["A", "B"]) {
    const cg = Object.fromEntries(((cells[cell] || {}).gates || []).map((g) => [g.gate, g]));
    for (const gate of Object.keys(CHECKS)) {
      const g = cg[gate];
      if (!g) { console.log("SELF-TEST " + cell + "." + gate + ": gate missing from row-guides8.json"); fail++; continue; }
      const base = verdict(gate, g.measured);
      const v = verdict(gate, PLANT[gate]);
      if (v !== "MISS") { console.log("SELF-TEST " + cell + "." + gate + ": planted violation NOT caught"); fail++; }
      else console.log("SELF-TEST " + cell + "." + gate + ": planted violation -> MISS ok (recorded " + base + ")");
    }
  }
  const need = ["guides8.py", "A/guides8.npz", "B/guides8.npz", "guides8-debug.png", "blend-sheet.png", "target-vs-guides8.png", "row-guides8.json", "RESULT.txt", "A/blend/passB/front.png", "A/blend/passB/front-id.png", "B/blend/passB/front.png", "B/blend/passB/front-id.png", "B/blend/judge-passB/overlay-blend-passB.png"];
  for (const f of need) if (!existsSync(join(E, f))) { console.log("SELF-TEST file missing: " + f); fail++; }
  console.log(fail === 0 ? "SELF-TEST ALL CAUGHT" : "SELF-TEST FAILURES=" + fail);
  process.exit(fail === 0 ? 0 : 1);
}
let passCell = null;
for (const cell of ["A", "B"]) {
  const cg = (cells[cell] || {}).gates || [];
  let miss = 0;
  for (const gate of Object.keys(CHECKS)) {
    const g = cg.find((x) => x.gate === gate);
    if (!g) { console.log(cell + "." + gate + ": MISSING from row-guides8.json"); miss++; continue; }
    const v = verdict(gate, g.measured);
    console.log(cell + "." + gate + " " + g.measured + " | " + g.bar + " " + v);
    if (v === "MISS") miss++;
  }
  console.log(cell + (miss === 0 ? " ALL PASS" : " MISSES=" + miss));
  if (miss === 0 && passCell === null) passCell = cell;
}
console.log("VERDICT recorded=" + row.verdict + " computed=" + (passCell || "neither"));
process.exit(passCell !== null ? 0 : 1);
