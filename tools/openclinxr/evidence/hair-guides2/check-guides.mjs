// check-guides.mjs: gate checker for hair-guides-3. Normal mode exits 1 on any MISS.
// --self-test plants a violation of each gate and requires the checker to flag it.
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const E = dirname(fileURLToPath(import.meta.url));
const row = JSON.parse(readFileSync(join(E, "row-guides.json"), "utf8"));
const num = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return parseFloat(m[1]); };
const pair = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2])]; };
const trio = (s, re) => { const m = String(s).match(re); if (!m) throw new Error("unparsed " + s); return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]; };
const CHECKS = {
  G1:  { bar: "count in [350,600]", get: (g) => parseInt(g.measured, 10), ok: (v) => v >= 350 && v <= 600, plant: () => 100 },
  G2:  { bar: "inside=0 and min>=2mm", get: (g) => pair(g.measured, /inside=(\d+) min=([\d.]+)mm/), ok: ([i, m]) => i === 0 && m >= 2, plant: () => [1, 3.0] },
  G3:  { bar: ">=99.5% surface in [2,6]mm", get: (g) => pair(g.measured, /bad=(\d+)\/(\d+)/), ok: ([b, n]) => n > 0 && b / n <= 0.005, plant: () => [100, 6980] },
  G5:  { bar: "p95<=35mm and max<=65mm", get: (g) => pair(g.measured, /p95=([\d.]+)mm max=([\d.]+)mm/), ok: ([p, m]) => p <= 35 && m <= 65, plant: () => [25.3, 66.0] },
  G6:  { bar: "0 face-zone points", get: (g) => parseInt(g.measured, 10), ok: (v) => v === 0, plant: () => 1 },
  G7:  { bar: "p95<=8 and max<=25 deg/cm and 0 short", get: (g) => trio(g.measured, /p95=([\d.eE+-]+) max=([\d.eE+-]+) short=(\d+)/), ok: ([p, m, s]) => p <= 8 && m <= 25 && s === 0, plant: () => [9.0, 10.0, 0] },
  G8:  { bar: "hemdz<=5mm and cend<=10% and stray<3%", get: (g) => trio(g.measured, /hemdz=([\d.]+)mm cend=([\d.]+)% stray=([\d.]+)%/), ok: ([d, c, s]) => d <= 5 && c <= 10 && s < 3, plant: () => [0.0, 6.9, 3.5] },
  G9:  { bar: "coverage max<=9mm", get: (g) => num(g.measured, /max=([\d.]+)mm/), ok: (v) => v <= 9.0, plant: () => 10.0 },
  G10: { bar: "|meanx|<=5mm", get: (g) => num(g.measured, /\|=([\d.]+)mm/), ok: (v) => v <= 5.0, plant: () => 6.0 },
  G11: { bar: "mask gap>=req", get: (g) => pair(g.measured, /gap=([\d.]+)mm req=([\d.]+)mm/), ok: ([gap, req]) => gap >= req, plant: () => [50.0, 113.7] },
};
const byGate = Object.fromEntries(row.gates.map((g) => [g.gate, g]));
function verdict(gate, measured) {
  const c = CHECKS[gate];
  return c.ok(c.get({ measured })) ? "PASS" : "MISS";
}
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  let fail = 0;
  for (const [gate, c] of Object.entries(CHECKS)) {
    const g = byGate[gate];
    if (!g) { console.log("SELF-TEST " + gate + ": gate missing from row-guides.json"); fail++; continue; }
    const base = verdict(gate, g.measured);
    let pm = g.measured;
    if (gate === "G1") pm = "100";
    if (gate === "G2") pm = "inside=1 min=3.00mm";
    if (gate === "G3") pm = "bad=100/6980";
    if (gate === "G5") pm = "p95=25.30mm max=66.00mm";
    if (gate === "G6") pm = "1";
    if (gate === "G7") pm = "p95=9.00 max=10.00 short=0";
    if (gate === "G8") pm = "hemdz=0.00mm cend=6.90% stray=3.50%";
    if (gate === "G9") pm = "max=10.00mm";
    if (gate === "G10") pm = "|meanx|=6.00mm";
    if (gate === "G11") pm = "gap=50.0mm req=113.7mm outer=86.3mm";
    void c.plant();
    const v = verdict(gate, pm);
    if (v !== "MISS") { console.log("SELF-TEST " + gate + ": planted violation NOT caught"); fail++; }
    else console.log("SELF-TEST " + gate + ": planted violation -> MISS ok (recorded " + base + ")");
  }
  const need = ["guides3.py", "guides3.npz", "guides-debug.png", "target-vs-guides.png", "guides-front-mask.png", "row-guides.json", "RESULT3.txt"];
  for (const f of need) if (!existsSync(join(E, f))) { console.log("SELF-TEST file missing: " + f); fail++; }
  console.log(fail === 0 ? "SELF-TEST ALL CAUGHT" : "SELF-TEST FAILURES=" + fail);
  process.exit(fail === 0 ? 0 : 1);
}
let miss = 0;
for (const [gate, c] of Object.entries(CHECKS)) {
  const g = byGate[gate];
  if (!g) { console.log(gate + ": MISSING from row-guides.json"); miss++; continue; }
  const v = verdict(gate, g.measured);
  const agree = v === g.verdict ? "agree" : "VERDICT-MISMATCH(recorded " + g.verdict + ")";
  console.log(gate + " " + g.measured + " | " + c.bar + " " + v + " " + agree);
  if (v !== "PASS" || agree.startsWith("VERDICT")) miss++;
}
process.exit(miss === 0 ? 0 : 1);
