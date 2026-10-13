/**
 * Settle-entry stage-3 bars check (2026-10-12 slice): control vs fix on the
 * seven proof bars. No runs or frames excluded; counts printed.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/settle-entry/settle-entry-bars-check.ts \
 *     --fix=.openclinxr/evidence/settle-entry/fix-sc05 \
 *     --fixSummary=.openclinxr/evidence/settle-entry/fix-sc05-summary.json \
 *     --controlSummary=.openclinxr/evidence/settle-entry/control-sc05-summary.json
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };
type Frame = {
  phase: string | null;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  upperL: Quat | null;
  upperR: Quat | null;
  footYawL: number | null;
  footYawR: number | null;
  targetHeading: number | null;
};
type TraceFrame = {
  frame: number;
  stanceFoot: string;
  toeLeftY: number | null;
  toeRightY: number | null;
  floorOriginY: number | null;
  pivot: { anchorWindow: string | null; pendingWindow: string | null; legacy: boolean } | null;
};
type Metric = {
  tag: string;
  arrivalSlot: { x: number; z: number } | null;
  arrivalYawDeg: number | null;
  plantFoot: string | null;
  plantYawDeg: number | null;
  alongM: number | null;
  lateralM: number | null;
  settlingS: number;
  maxLegStepDeg: number;
  windowSlidesM: number[];
  maxWindowSlideM: number;
};

function arg(name: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!flag) throw new Error(`usage: --${name}=path`);
  return flag;
}
function stats(values: number[]): { n: number; mean: number; sd: number; min: number; max: number } {
  const n = values.length;
  const mean = n === 0 ? NaN : values.reduce((s, v) => s + v, 0) / n;
  const sd = n < 2 ? 0 : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, min: n === 0 ? NaN : Math.min(...values), max: n === 0 ? NaN : Math.max(...values) };
}
const fmt = (v: number, d = 4): string => (Number.isNaN(v) ? "NaN" : v.toFixed(d));
function quatStepDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

async function main(): Promise<void> {
  const fixDir = arg("fix");
  const fixSummary = JSON.parse(await readFile(arg("fixSummary"), "utf8")) as { metrics: Metric[] };
  const controlSummary = JSON.parse(await readFile(arg("controlSummary"), "utf8")) as { metrics: Metric[] };
  const files = (await readdir(fixDir)).filter((f) => f.endsWith(".json") && f.includes("-run") && !f.includes(".trace")).sort();
  const runs: Array<{ tag: string; frames: Frame[]; trace: TraceFrame[] }> = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(fixDir, file), "utf8")) as { frames: Frame[] };
    const tag = file.replace(/\.json$/, "");
    let trace: TraceFrame[] = [];
    try {
      trace = JSON.parse(await readFile(path.join(fixDir, `${tag}.trace.json`), "utf8")) as TraceFrame[];
    } catch {
      trace = [];
    }
    runs.push({ tag, frames: run.frames, trace });
  }
  const fm = fixSummary.metrics;
  const cm = controlSummary.metrics;
  console.log(`# bars: fix n=${runs.length} runs (${runs.map((r) => r.tag).join(" ")}), traces=${runs.filter((r) => r.trace.length > 0).length}`);

  // Bar 1: growth — max pairwise slot spread on any settling frame.
  let growthMax = 0;
  let growthAt = -1;
  const settle = runs.map((r) => r.frames.filter((f) => f.phase === "settling"));
  const len = Math.min(...settle.map((s) => s.length));
  for (let i = 0; i < len; i += 1) {
    const pts = settle.map((s) => s[i]?.slot).filter((s) => s !== null && s !== undefined);
    for (let a = 0; a < pts.length; a += 1) {
      for (let b = a + 1; b < pts.length; b += 1) {
        const d = Math.hypot(pts[a]!.x - pts[b]!.x, pts[a]!.z - pts[b]!.z);
        if (d > growthMax) {
          growthMax = d;
          growthAt = i;
        }
      }
    }
  }
  console.log(`bar1 growth: max pairwise settling spread=${fmt(growthMax)}m at frame ${growthAt} (bar <= 0.002) frames=${len}`);

  // Bar 2: arrival repeatability.
  const slots = fm.map((m) => m.arrivalSlot).filter((s) => s !== null);
  const cx = slots.reduce((s, v) => s + v!.x, 0) / slots.length;
  const cz = slots.reduce((s, v) => s + v!.z, 0) / slots.length;
  const dev = slots.map((v) => Math.hypot(v!.x - cx, v!.z - cz));
  const sd = stats(dev);
  const yawSd = stats(fm.map((m) => m.plantYawDeg).filter((v) => v !== null) as number[]);
  const feet = fm.map((m) => m.plantFoot);
  console.log(`bar2 repeat: arrival slot sd=${fmt(sd.sd)}m range=[${fmt(sd.min)},${fmt(sd.max)}]m (bar <= 0.005); plant yaw sd=${fmt(yawSd.sd, 2)}deg (bar <= 1); feet=${feet.join(",")} (bar 6/6 same)`);

  // Bar 3: arrival accuracy.
  const along = stats(fm.map((m) => Math.abs(m.alongM ?? NaN)).filter((v) => !Number.isNaN(v)));
  const lat = stats(fm.map((m) => Math.abs(m.lateralM ?? NaN)).filter((v) => !Number.isNaN(v)));
  const res = fm.map((m) =>
    m.arrivalYawDeg !== null && runs[0]
      ? Math.abs(Math.atan2(Math.sin(m.arrivalYawDeg * Math.PI / 180 - Math.PI), Math.cos(m.arrivalYawDeg * Math.PI / 180 - Math.PI)) * 180 / Math.PI)
      : NaN,
  ).filter((v) => !Number.isNaN(v));
  const cal = stats(cm.map((m) => Math.abs(m.lateralM ?? NaN)).filter((v) => !Number.isNaN(v)));
  console.log(`bar3 accuracy: fix |along| mean=${fmt(along.mean)} range=[${fmt(along.min)},${fmt(along.max)}] (bar <= 0.02); |lateral| mean=${fmt(lat.mean)} range=[${fmt(lat.min)},${fmt(lat.max)}] (bar <= 0.02; control mean=${fmt(cal.mean)}); residual yaw max=${fmt(Math.max(...res), 2)}deg (bar <= 2)`);

  // Bar 4: settling-only max one-frame leg rotation.
  let legMax = 0;
  for (const r of runs) {
    const s = r.frames.filter((f) => f.phase === "settling");
    for (let i = 1; i < s.length; i += 1) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (a.upperL && b.upperL) legMax = Math.max(legMax, quatStepDeg(a.upperL, b.upperL));
      if (a.upperR && b.upperR) legMax = Math.max(legMax, quatStepDeg(a.upperR, b.upperR));
    }
  }
  console.log(`bar4 legs: settling-only max one-frame rotation=${fmt(legMax, 2)}deg (bar <= 24.5 = 1.5x walk max 16.3)`);

  // Bar 5: stance slide must not get worse than control 0.017.
  const fSlide = Math.max(...fm.map((m) => m.maxWindowSlideM));
  const cSlide = Math.max(...cm.map((m) => m.maxWindowSlideM));
  console.log(`bar5 slide: fix max window=${fmt(fSlide)}m control max=${fmt(cSlide)}m (bar <= 0.02)`);

  // Bar 6: pivoted stance-foot toe height from traces. Descent frames (window
  // pending: foot still converging onto its plan anchor) are reported
  // separately; only landed-window frames count as violations.
  let toeMax = 0;
  let pivoted = 0;
  let descent = 0;
  let violations = 0;
  for (const r of runs) {
    for (const t of r.trace) {
      if (t.pivot === null || t.pivot.legacy || t.pivot.anchorWindow === null) continue;
      const y = t.stanceFoot === "left" ? t.toeLeftY : t.stanceFoot === "right" ? t.toeRightY : null;
      if (y === null || t.floorOriginY === null) continue;
      const h = y - t.floorOriginY;
      if (t.pivot.pendingWindow !== null) {
        descent += 1;
        continue;
      }
      pivoted += 1;
      toeMax = Math.max(toeMax, h);
      if (h > 0.03) violations += 1;
    }
  }
  console.log(`bar6 toe: landed pivoted frames=${pivoted} max stance-toe height=${fmt(toeMax)}m violations=${violations} (bar <= 0.03, 0 violations); descent frames=${descent}`);

  // Bar 7: settling duration within 0.3 s of control 1.567.
  const dur = stats(fm.map((m) => m.settlingS));
  console.log(`bar7 duration: mean=${fmt(dur.mean, 3)}s range=[${fmt(dur.min, 3)},${fmt(dur.max, 3)}]s (bar 1.267..1.867)`);
}

await main();
