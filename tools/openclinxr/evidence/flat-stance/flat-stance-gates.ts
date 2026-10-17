/**
 * DENSE_v1 flat-stance slice, STEP 3 gates (F1-F7).
 *
 * Reads slide-phase captures (before = pre-fix baselines, after = this
 * slice's flat-stance captures) and evaluates every capture-derived gate.
 * F8 (package tests + arch + Biome) is recorded from the session, not
 * measured here. Writes a gates JSON fragment; RESULT.json assembly (images,
 * videos, commits, notes) happens beside it.
 *
 * Floor datum (same as standing-pitch-measure.ts): floor[foot] = min
 * toe-joint world Y over the run (frames + preWalk). pitchDeg[foot] =
 * atan2(heelContactY - toeY, heelToeXZ), + = heel up.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/flat-stance/flat-stance-gates.ts \
 *     --after=.openclinxr/evidence/flat-stance \
 *     --out=.openclinxr/evidence/flat-stance/gates.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeSlidePhase } from "../slide-phase/slide-phase-analyze.js";
import { measureRun } from "../slide-phase/standing-pitch-measure.js";

type Vec3 = { x: number; y: number; z: number };

const STEP_DT_S = 1 / 30;
const AFTER_CONFIGS = ["default", "plan-only", "plan-footbase", "2.0", "3.7", "6.0"] as const;
/** Pre-fix baseline capture dirs per after-config. */
const BEFORE_DIRS: Record<string, string[]> = {
  default: [".openclinxr/evidence/standing-pitch/captures/default"],
  "plan-only": [".openclinxr/evidence/standing-pitch/captures/plan-only"],
  "plan-footbase": [
    ".openclinxr/evidence/standing-pitch/captures/plan-footbase",
    ".openclinxr/evidence/foot-base-routes/sc05",
  ],
  "2.0": [".openclinxr/evidence/foot-base-routes/2.0"],
  "3.7": [".openclinxr/evidence/foot-base-routes/3.7"],
  "6.0": [".openclinxr/evidence/foot-base-routes/6.0"],
};

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

type Frame = {
  phase: string | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  heelContactL?: Vec3 | null;
  heelContactR?: Vec3 | null;
  slot?: { x: number; y: number; z: number; yaw: number } | null;
  targetWorld?: Vec3 | null;
  kneeFlexionDeg?: { left: number | null; right: number | null } | null;
};

type Run = { frames?: Frame[]; preWalk?: Frame[]; urlQuery?: string };

async function readRuns(dir: string): Promise<Array<{ file: string; run: Run }>> {
  const files = (await readdir(dir))
    .filter((f) => /^sc05-run\d+\.json$/.test(f))
    .sort();
  const out: Array<{ file: string; run: Run }> = [];
  for (const f of files) {
    out.push({ file: `${dir}/${f}`, run: JSON.parse(await readFile(path.join(dir, f), "utf8")) as Run });
  }
  return out;
}

function mean(xs: number[]): number | null {
  const fin = xs.filter((x) => Number.isFinite(x));
  return fin.length === 0 ? null : fin.reduce((a, b) => a + b, 0) / fin.length;
}

function arrivedFrames(run: Run): Frame[] {
  return (run.frames ?? []).filter((f) => f.phase === "arrived");
}

function floorOf(run: Run, foot: "left" | "right"): number | null {
  let min: number | null = null;
  const toe = (f: Frame): Vec3 | null => (foot === "left" ? f.leftToe : f.rightToe);
  for (const f of [...(run.preWalk ?? []), ...(run.frames ?? [])]) {
    const t = toe(f);
    if (t === null || !Number.isFinite(t.y)) continue;
    if (min === null || t.y < min) min = t.y;
  }
  return min;
}

function pitchOf(heel: Vec3 | null | undefined, toe: Vec3 | null): number | null {
  if (!heel || !toe) return null;
  const dxz = Math.hypot(heel.x - toe.x, heel.z - toe.z);
  if (!(dxz > 1e-9)) return null;
  return (Math.atan2(heel.y - toe.y, dxz) * 180) / Math.PI;
}

function lastOf<T>(xs: T[]): T | null {
  return xs.length > 0 ? (xs[xs.length - 1] as T) : null;
}

type GateValue = { value: number | boolean | null; pass: boolean; detail: string };

async function main(): Promise<void> {
  const afterRoot = arg("after");
  const outPath = arg("out");
  if (!afterRoot || !outPath) throw new Error("usage: flat-stance-gates.ts --after=root --out=gates.json");
  const gates: Record<string, Record<string, GateValue & { perConfig?: unknown }>> = {};
  const perConfig: Record<string, Record<string, unknown>> = {};

  for (const config of AFTER_CONFIGS) {
    const afterRuns = await readRuns(path.join(afterRoot, config));
    if (afterRuns.length === 0) throw new Error(`no runs in ${afterRoot}/${config}`);
    const beforeRuns = (
      await Promise.all((BEFORE_DIRS[config] ?? []).map((d) => readRuns(d).catch(() => [])))
    ).flat();
    if (beforeRuns.length === 0) throw new Error(`no baseline runs for ${config}`);
    const cfg: Record<string, unknown> = { nAfter: afterRuns.length, nBefore: beforeRuns.length };
    perConfig[config] = cfg;

    // ---- F1: arrival heel <= 8 mm above floor + pitch <= 5 deg, every run, both feet.
    const f1Runs = afterRuns.map(({ file, run }) => {
      const measured = measureRun(file, run as never);
      const feet = [
        { side: "left", p: measured.arrival?.left ?? null },
        { side: "right", p: measured.arrival?.right ?? null },
      ];
      const ok = feet.every(
        (f) =>
          f.p !== null &&
          f.p.heelAboveFloorM !== null &&
          f.p.pitchDeg !== null &&
          f.p.heelAboveFloorM <= 0.008 &&
          Math.abs(f.p.pitchDeg) <= 5,
      );
      return {
        file,
        ok,
        left: { heel: measured.arrival?.left.heelAboveFloorM ?? null, pitch: measured.arrival?.left.pitchDeg ?? null },
        right: { heel: measured.arrival?.right.heelAboveFloorM ?? null, pitch: measured.arrival?.right.pitchDeg ?? null },
      };
    });
    cfg["F1runs"] = f1Runs;
    const f1Pass = f1Runs.every((r) => r.ok);

    // ---- F2: toe arrival moves <= 5 mm vs before; plan cells toe-mid-to-target <= 2 mm.
    const toeOf = (run: Run, foot: "left" | "right"): Vec3 | null => {
      const last = lastOf(arrivedFrames(run));
      return last ? (foot === "left" ? last.leftToe : last.rightToe) : null;
    };
    const beforeL = beforeRuns.map((r) => toeOf(r.run, "left")).filter((t): t is Vec3 => t !== null);
    const beforeR = beforeRuns.map((r) => toeOf(r.run, "right")).filter((t): t is Vec3 => t !== null);
    const meanL = { x: mean(beforeL.map((t) => t.x)) ?? NaN, z: mean(beforeL.map((t) => t.z)) ?? NaN };
    const meanR = { x: mean(beforeR.map((t) => t.x)) ?? NaN, z: mean(beforeR.map((t) => t.z)) ?? NaN };
    const targetOf = (run: Run): Vec3 | null => {
      const frames = run.frames ?? [];
      for (let i = frames.length - 1; i >= 0; i -= 1) {
        const t = frames[i]?.targetWorld ?? null;
        if (t) return t;
      }
      return null;
    };
    const f2Runs = afterRuns.map(({ file, run }) => {
      const L = toeOf(run, "left");
      const R = toeOf(run, "right");
      const tgt = targetOf(run);
      const dL = L ? Math.hypot(L.x - meanL.x, L.z - meanL.z) : NaN;
      const dR = R ? Math.hypot(R.x - meanR.x, R.z - meanR.z) : NaN;
      const mid = L && R ? { x: (L.x + R.x) / 2, z: (L.z + R.z) / 2 } : null;
      const toeMidToTarget = mid && tgt ? Math.hypot(mid.x - tgt.x, mid.z - tgt.z) : NaN;
      return { file, dL, dR, toeMidToTarget };
    });
    cfg["F2runs"] = f2Runs;
    const f2MoveOk = f2Runs.every((r) => r.dL <= 0.005 && r.dR <= 0.005);
    const isPlan = config === "plan-only" || config === "plan-footbase";
    const f2TargetOk = isPlan ? f2Runs.every((r) => r.toeMidToTarget <= 0.002) : true;
    const f2Pass = f2MoveOk && f2TargetOk;

    // ---- F3: no penetration over arrived frames (heel + toe >= -3 mm vs run-min-toe datum).
    const f3Runs = afterRuns.map(({ file, run }) => {
      const arr = arrivedFrames(run);
      let minHeel = Number.POSITIVE_INFINITY;
      let minToe = Number.POSITIVE_INFINITY;
      for (const foot of ["left", "right"] as const) {
        const floor = floorOf(run, foot) ?? NaN;
        for (const f of arr) {
          const h = foot === "left" ? f.heelContactL : f.heelContactR;
          const t = foot === "left" ? f.leftToe : f.rightToe;
          if (h && Number.isFinite(h.y)) minHeel = Math.min(minHeel, h.y - floor);
          if (t && Number.isFinite(t.y)) minToe = Math.min(minToe, t.y - floor);
        }
      }
      return { file, minHeelAboveM: minHeel, minToeAboveM: minToe, ok: minHeel >= -0.003 && minToe >= -0.003 };
    });
    cfg["F3runs"] = f3Runs;
    const f3Pass = f3Runs.every((r) => r.ok);

    // ---- F4: knee flexion 0-25 deg both legs at arrival; pelvis |dSlotY| <= 30 mm vs before.
    const flexAt = (run: Run, foot: "left" | "right"): number | null =>
      lastOf(arrivedFrames(run))?.kneeFlexionDeg?.[foot] ?? null;
    const slotYAt = (run: Run): number | null => lastOf(arrivedFrames(run))?.slot?.y ?? null;
    const beforeSlotY = mean(beforeRuns.map((r) => slotYAt(r.run)).filter((v): v is number => v !== null));
    const f4Runs = afterRuns.map(({ file, run }) => {
      const fL = flexAt(run, "left");
      const fR = flexAt(run, "right");
      return {
        file,
        flexL: fL,
        flexR: fR,
        slotY: slotYAt(run),
        ok: fL !== null && fR !== null && fL >= 0 && fL <= 25 && fR >= 0 && fR <= 25,
      };
    });
    const afterSlotY = mean(f4Runs.map((r) => r.slotY).filter((v): v is number => v !== null));
    const dSlotY = beforeSlotY !== null && afterSlotY !== null ? Math.abs(afterSlotY - beforeSlotY) : NaN;
    cfg["F4runs"] = f4Runs;
    cfg["slotY"] = { beforeM: beforeSlotY, afterM: afterSlotY, deltaM: dSlotY };
    const f4Pass = f4Runs.every((r) => r.ok) && dSlotY <= 0.03;

    // ---- F5: max foot pitch rate over settling-tail + arrived frames <= 200 deg/s.
    const f5Runs = afterRuns.map(({ file, run }) => {
      const frames = run.frames ?? [];
      const settledIdx = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.phase === "settling").map(({ i }) => i);
      const arrivedIdx = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.phase === "arrived").map(({ i }) => i);
      const tailSettled = settledIdx.slice(-10);
      const window = [...tailSettled, ...arrivedIdx].sort((a, b) => a - b);
      let maxRate = 0;
      for (const foot of ["left", "right"] as const) {
        let prev: number | null = null;
        for (const i of window) {
          const f = frames[i];
          if (!f) continue;
          const p = pitchOf(foot === "left" ? f.heelContactL : f.heelContactR, foot === "left" ? f.leftToe : f.rightToe);
          if (p !== null && prev !== null) maxRate = Math.max(maxRate, Math.abs(p - prev) / STEP_DT_S);
          if (p !== null) prev = p;
        }
      }
      return { file, maxPitchRateDegPerS: maxRate, ok: maxRate <= 200 };
    });
    cfg["F5runs"] = f5Runs;
    const f5Pass = f5Runs.every((r) => r.ok);

    // ---- F6/F7 via the slide-phase meter (before + after).
    const afterMetrics = afterRuns.map(({ file, run }) =>
      computeSlidePhase(file, run as never),
    );
    const beforeMetrics = beforeRuns.map(({ file, run }) => computeSlidePhase(`before:${file}`, run as never));
    const mOf = (ms: Array<{ walking: { slidePerMetre: number | null }; turn: { maxM: number | null } }>) => ({
      slide: mean(ms.map((m) => m.walking.slidePerMetre).filter((v): v is number => v !== null)),
      turnMax: ms.map((m) => m.turn.maxM).filter((v): v is number => v !== null),
    });
    const afterM = mOf(afterMetrics);
    const beforeM = mOf(beforeMetrics);
    cfg["slide"] = {
      beforeMean: beforeM.slide,
      afterMean: afterM.slide,
      delta: beforeM.slide !== null && afterM.slide !== null ? Math.abs(afterM.slide - beforeM.slide) : NaN,
    };
    cfg["turnMaxM"] = { afterPerRun: afterM.turnMax, beforePerRun: beforeM.turnMax };
    cfg["toeMidArrival"] = afterMetrics.map((m) => ({
      tag: m.tag,
      lastToeMidM: m.toeMidArrival.lastToeMidM,
      lastSlotM: m.toeMidArrival.lastSlotM,
    }));
    const f6Delta = cfg["slide"] as { delta: number };
    const f6Pass = Number.isFinite(f6Delta.delta) && f6Delta.delta <= 0.0005;
    const f7Pass = config === "plan-only" || config === "plan-footbase"
      ? afterM.turnMax.every((v) => v <= 0.002)
      : true;

    (gates as Record<string, Record<string, GateValue>>)[`F1:${config}`] = {
      [config]: { value: f1Runs.filter((r) => r.ok).length / f1Runs.length, pass: f1Pass, detail: `${f1Runs.filter((r) => r.ok).length}/${f1Runs.length} runs heel<=8mm+pitch<=5deg both feet` },
    };
    (gates as Record<string, Record<string, GateValue>>)[`F2:${config}`] = {
      [config]: { value: Math.max(...f2Runs.flatMap((r) => [r.dL, r.dR])), pass: f2Pass, detail: `max toe move vs before; plan toeMidToTarget max=${Math.max(...f2Runs.map((r) => r.toeMidToTarget)).toFixed(4)}m` },
    };
    (gates as Record<string, Record<string, GateValue>>)[`F3:${config}`] = {
      [config]: { value: Math.min(...f3Runs.map((r) => Math.min(r.minHeelAboveM, r.minToeAboveM))), pass: f3Pass, detail: "min heel/toe above floor over arrived frames" },
    };
    (gates as Record<string, Record<string, GateValue>>)[`F4:${config}`] = {
      [config]: { value: dSlotY, pass: f4Pass, detail: `flex in 0-25deg all runs; pelvis delta=${(dSlotY * 1000).toFixed(1)}mm` },
    };
    (gates as Record<string, Record<string, GateValue>>)[`F5:${config}`] = {
      [config]: { value: Math.max(...f5Runs.map((r) => r.maxPitchRateDegPerS)), pass: f5Pass, detail: "max foot pitch rate over settling-tail+arrived" },
    };
    (gates as Record<string, Record<string, GateValue>>)[`F6:${config}`] = {
      [config]: { value: f6Delta.delta, pass: f6Pass, detail: `|slide/m after-before| (before=${beforeM.slide?.toFixed(6)} after=${afterM.slide?.toFixed(6)})` },
    };
    (gates as Record<string, Record<string, GateValue>>)[`F7:${config}`] = {
      [config]: { value: Math.max(...afterM.turnMax, 0), pass: f7Pass, detail: `turn.maxM max over runs${isPlan ? "" : " (reported only; bar is plan-cells)"}` },
    };
  }

  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify({ measuredAt: new Date().toISOString(), gates, perConfig }, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath}\n`);
  for (const [k, v] of Object.entries(gates)) {
    const inner = Object.values(v)[0] as GateValue;
    process.stdout.write(`  ${k} pass=${inner.pass} value=${inner.value} :: ${inner.detail}\n`);
  }
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("flat-stance-gates.ts");

if (invokedAsScript) {
  await main();
}
