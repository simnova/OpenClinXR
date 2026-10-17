/**
 * Standing-pitch measure (DENSE_v1 standing-foot-pitch slice, STEPs 1+3).
 *
 * Reads slide-phase captures (with the heel-contact probe fields added by
 * slide-phase-capture.ts: heelContactL/R = heel-sole world, vs
 * legWorlds.heelL/R = the foot-bone origin = ankle joint) and reports, per
 * config and per run, for idle (preWalk rest-pose record), arrival (last
 * frame) and walking mid-stance (per foot: most-planted stance-labelled
 * walking frame):
 *   per foot: heel-contact height above floor, toe height above floor, foot
 *   pitch angle (heel-toe line vs floor).
 *
 * DEFINITIONS (brief-literal):
 * - Floor[foot] = min toe-joint Y over the run (frames + preWalk records).
 * - pitchDeg[foot] = atan2(heelContactY - toeY, heelToeXZ) in degrees,
 *   signed; positive = heel above the toe line = plantarflexed.
 * - DEFECT iff at arrival either foot has heel contact > 0.015 m above the
 *   floor while its toe is <= 0.01 m above the floor (heel lifted), or foot
 *   pitch > 8 deg.
 *
 * STEP 3 writer tap (same file, no product edits): per run, pitch continuity
 * idle -> turn-end (last walking frame) -> arrival per foot, plus arrival
 * pitch across flag cells (default vs plan-only vs plan+footBase). The writer
 * whose output the arrival frames carry is read off these numbers in
 * RESULT.json, not asserted here.
 *
 * INSTRUMENT ONLY. Reads captures; writes one JSON.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/standing-pitch-measure.ts \
 *     --config=default:.openclinxr/evidence/standing-pitch/captures/default \
 *     --config=plan-only:.openclinxr/evidence/standing-pitch/captures/plan-only \
 *     --config=plan-footbase:.openclinxr/evidence/standing-pitch/captures/plan-footbase \
 *     --out=.openclinxr/evidence/standing-pitch/measure.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PITCH_DEFECT_DEG = 8;
export const HEEL_LIFT_M = 0.015;
export const TOE_DOWN_M = 0.01;

export const STANDING_PITCH_DEFINITION =
  "floor[foot] = min toe-joint world Y over the run (frames + preWalk); " +
  "heelAbove = heelContactY - floor (heelContact = heel-sole world from the foot-bone-local point); " +
  "toeAbove = toeY - floor; " +
  "pitchDeg = atan2(heelContactY - toeY, heelToeXZ) in degrees, signed, + = heel up (plantarflexed); " +
  "DEFECT iff at arrival either foot has heelAbove > 0.015 m while toeAbove <= 0.01 m, or pitchDeg > 8.";

type Vec3 = { x: number; y: number; z: number };
type Side = "left" | "right";

type CapFrame = {
  step?: number;
  preStep?: number;
  phase: string | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  legWorlds: Record<string, Vec3 | null> | null;
  heelContactL?: Vec3 | null;
  heelContactR?: Vec3 | null;
};

type CapRun = {
  urlQuery?: string;
  frames?: CapFrame[];
  preWalk?: CapFrame[];
};

export type FootPitch = {
  heelContactY: number | null;
  heelAboveFloorM: number | null;
  toeY: number | null;
  toeAboveFloorM: number | null;
  /** The raw heel-BONE (ankle) Y, so the joint-vs-contact artefact reads off directly. */
  ankleY: number | null;
  ankleAboveFloorM: number | null;
  heelToeDxzM: number | null;
  pitchDeg: number | null;
};

export type MomentPitch = {
  frameLabel: string;
  left: FootPitch;
  right: FootPitch;
};

function toeOf(f: CapFrame, foot: Side): Vec3 | null {
  return foot === "left" ? f.leftToe : f.rightToe;
}

function contactOf(f: CapFrame, foot: Side): Vec3 | null {
  const c = foot === "left" ? f.heelContactL : f.heelContactR;
  return c ?? null;
}

function ankleOf(f: CapFrame, foot: Side): Vec3 | null {
  const key = foot === "left" ? "heelL" : "heelR";
  return f.legWorlds?.[key] ?? null;
}

function pitchOf(foot: FootPitch): void {
  if (
    foot.heelContactY === null || foot.toeY === null || foot.heelToeDxzM === null
  ) {
    foot.pitchDeg = null;
    return;
  }
  foot.pitchDeg =
    (Math.atan2(foot.heelContactY - foot.toeY, Math.max(foot.heelToeDxzM, 1e-9)) * 180) / Math.PI;
}

function measureFoot(f: CapFrame, foot: Side, floor: number | null): FootPitch {
  const heel = contactOf(f, foot);
  const toe = toeOf(f, foot);
  const ankle = ankleOf(f, foot);
  const out: FootPitch = {
    heelContactY: heel?.y ?? null,
    heelAboveFloorM: heel && floor !== null ? heel.y - floor : null,
    toeY: toe?.y ?? null,
    toeAboveFloorM: toe && floor !== null ? toe.y - floor : null,
    ankleY: ankle?.y ?? null,
    ankleAboveFloorM: ankle && floor !== null ? ankle.y - floor : null,
    heelToeDxzM:
      heel && toe ? Math.hypot(heel.x - toe.x, heel.z - toe.z) : null,
    pitchDeg: null,
  };
  pitchOf(out);
  return out;
}

function floorOf(all: CapFrame[], foot: Side): number | null {
  let min: number | null = null;
  for (const f of all) {
    const t = toeOf(f, foot);
    if (t === null || !Number.isFinite(t.y)) continue;
    if (min === null || t.y < min) min = t.y;
  }
  return min;
}

function labelOf(f: CapFrame): string {
  if (typeof f.step === "number") return `step${f.step}`;
  if (typeof f.preStep === "number") return `pre${f.preStep}`;
  return "unknown";
}

function pickIdle(preWalk: CapFrame[]): CapFrame | null {
  // The rest-pose record: last preWalk entry carrying a skeleton.
  for (let i = preWalk.length - 1; i >= 0; i -= 1) {
    const f = preWalk[i];
    if (f && f.legWorlds !== null) return f;
  }
  return null;
}

function pickMidStance(frames: CapFrame[], foot: Side): CapFrame | null {
  const side = foot === "left" ? "left" : "right";
  const labelled = frames.filter(
    (f) => f.phase === "walking" && f.stanceFoot === side && toeOf(f, foot) !== null,
  );
  const pool =
    labelled.length > 0
      ? labelled
      : frames.filter((f) => f.phase === "walking" && toeOf(f, foot) !== null);
  const first = pool[0];
  if (first === undefined) return null;
  let best = first;
  for (const f of pool) {
    if ((toeOf(f, foot)?.y ?? Infinity) < (toeOf(best, foot)?.y ?? Infinity)) best = f;
  }
  return best;
}

function pickTurnEnd(frames: CapFrame[]): CapFrame | null {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (f?.phase === "walking") return f;
  }
  return null;
}

export type RunPitch = {
  file: string;
  urlQuery: string | null;
  floors: { left: number | null; right: number | null };
  idle: MomentPitch | null;
  midStance: MomentPitch | null;
  turnEnd: MomentPitch | null;
  arrival: MomentPitch | null;
  /** Per-foot arrival DEFECT inputs, for the decision audit trail. */
  arrivalDefect: {
    foot: Side;
    heelAboveFloorM: number | null;
    toeAboveFloorM: number | null;
    pitchDeg: number | null;
    heelLifted: boolean;
    pitchHigh: boolean;
  }[];
  defect: boolean;
  nullContact: boolean;
};

function moment(f: CapFrame | null, floors: { left: number | null; right: number | null }): MomentPitch | null {
  if (!f) return null;
  return {
    frameLabel: `${labelOf(f)}:phase=${f.phase ?? "?"}`,
    left: measureFoot(f, "left", floors.left),
    right: measureFoot(f, "right", floors.right),
  };
}

export function measureRun(file: string, run: CapRun): RunPitch {
  const frames = Array.isArray(run.frames) ? run.frames : [];
  const preWalk = Array.isArray(run.preWalk) ? run.preWalk : [];
  const all = [...preWalk, ...frames];
  const floors = { left: floorOf(all, "left"), right: floorOf(all, "right") };
  const idleF = pickIdle(preWalk);
  const lastFrame = frames.length > 0 ? frames[frames.length - 1] : undefined;
  const arrivalF = lastFrame ?? null;
  const turnEndF = pickTurnEnd(frames);
  const midL = pickMidStance(frames, "left");
  const midR = pickMidStance(frames, "right");
  const idle = moment(idleF, floors);
  const arrival = moment(arrivalF, floors);
  const turnEnd = moment(turnEndF, floors);
  const midStance: MomentPitch | null =
    midL ?? midR
      ? {
          frameLabel: `midStance L=${midL ? labelOf(midL) : "n/a"} R=${midR ? labelOf(midR) : "n/a"}`,
          left: midL ? measureFoot(midL, "left", floors.left) : emptyFoot(),
          right: midR ? measureFoot(midR, "right", floors.right) : emptyFoot(),
        }
      : null;
  const arrivalDefect = (["left", "right"] as const).map((foot) => {
    const p = arrival ? (foot === "left" ? arrival.left : arrival.right) : emptyFoot();
    const heelLifted =
      p.heelAboveFloorM !== null &&
      p.toeAboveFloorM !== null &&
      p.heelAboveFloorM > HEEL_LIFT_M &&
      p.toeAboveFloorM <= TOE_DOWN_M;
    const pitchHigh = p.pitchDeg !== null && p.pitchDeg > PITCH_DEFECT_DEG;
    return {
      foot,
      heelAboveFloorM: p.heelAboveFloorM,
      toeAboveFloorM: p.toeAboveFloorM,
      pitchDeg: p.pitchDeg,
      heelLifted,
      pitchHigh,
    };
  });
  const nullContact =
    (arrival?.left.heelContactY === null && arrival?.right.heelContactY === null) ||
    arrival === null;
  return {
    file,
    urlQuery: run.urlQuery ?? null,
    floors,
    idle,
    midStance,
    turnEnd,
    arrival,
    arrivalDefect,
    defect: arrivalDefect.some((d) => d.heelLifted || d.pitchHigh),
    nullContact,
  };
}

function emptyFoot(): FootPitch {
  return {
    heelContactY: null,
    heelAboveFloorM: null,
    toeY: null,
    toeAboveFloorM: null,
    ankleY: null,
    ankleAboveFloorM: null,
    heelToeDxzM: null,
    pitchDeg: null,
  };
}

function mean(xs: (number | null)[]): number | null {
  const fin = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (fin.length === 0) return null;
  return fin.reduce((a, b) => a + b, 0) / fin.length;
}

export type ConfigPitch = {
  query: string | null;
  nRuns: number;
  runs: RunPitch[];
  meanArrival: { left: FootPitchMean; right: FootPitchMean };
  meanIdle: { left: FootPitchMean; right: FootPitchMean };
  defectRuns: number;
};

type FootPitchMean = {
  heelAboveFloorM: number | null;
  toeAboveFloorM: number | null;
  pitchDeg: number | null;
  ankleAboveFloorM: number | null;
};

function meanMoment(runs: RunPitch[], pick: (r: RunPitch) => MomentPitch | null): { left: FootPitchMean; right: FootPitchMean } {
  const L = runs.map((r) => pick(r)?.left ?? emptyFoot());
  const R = runs.map((r) => pick(r)?.right ?? emptyFoot());
  const avg = (fs: FootPitch[]): FootPitchMean => ({
    heelAboveFloorM: mean(fs.map((f) => f.heelAboveFloorM)),
    toeAboveFloorM: mean(fs.map((f) => f.toeAboveFloorM)),
    pitchDeg: mean(fs.map((f) => f.pitchDeg)),
    ankleAboveFloorM: mean(fs.map((f) => f.ankleAboveFloorM)),
  });
  return { left: avg(L), right: avg(R) };
}

function configOf(runs: RunPitch[]): ConfigPitch {
  return {
    query: runs[0]?.urlQuery ?? null,
    nRuns: runs.length,
    runs,
    meanArrival: meanMoment(runs, (r) => r.arrival),
    meanIdle: meanMoment(runs, (r) => r.idle),
    defectRuns: runs.filter((r) => r.defect).length,
  };
}

function configsFromArgv(): Array<{ name: string; dir: string }> {
  const pairs = process.argv
    .filter((a) => a.startsWith("--config="))
    .map((a) => a.slice("--config=".length));
  if (pairs.length === 0)
    throw new Error("usage: standing-pitch-measure.ts --config=name:dir [--config=name:dir] --out=measure.json");
  return pairs.map((p) => {
    const cut = p.indexOf(":");
    if (cut < 0) throw new Error(`bad --config=${p}, want name:dir`);
    return { name: p.slice(0, cut), dir: p.slice(cut + 1) };
  });
}

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

async function readRuns(dir: string): Promise<Array<{ file: string; run: CapRun }>> {
  const files = (await readdir(dir))
    .filter((f) => /^sc05-run\d+\.json$/.test(f))
    .sort();
  const out: Array<{ file: string; run: CapRun }> = [];
  for (const f of files) {
    const run = JSON.parse(await readFile(path.join(dir, f), "utf8")) as CapRun;
    out.push({ file: f, run });
  }
  return out;
}

async function main(): Promise<void> {
  const configs = configsFromArgv();
  const outPath = arg("out");
  if (!outPath) throw new Error("usage: standing-pitch-measure.ts --config=name:dir --out=measure.json");
  const result: Record<string, ConfigPitch> = {};
  for (const c of configs) {
    const runs = await readRuns(c.dir);
    const measured = runs.map(({ file, run }) => measureRun(`${c.name}:${file}`, run));
    result[c.name] = configOf(measured);
    for (const r of measured) {
      const fmt = (p: FootPitch): string =>
        `heel+${p.heelAboveFloorM === null ? "?" : (p.heelAboveFloorM * 1000).toFixed(1)}mm toe+${p.toeAboveFloorM === null ? "?" : (p.toeAboveFloorM * 1000).toFixed(1)}mm pitch${p.pitchDeg === null ? "?" : p.pitchDeg.toFixed(1)}deg`;
      process.stdout.write(
        `  ${r.file} idle[${r.idle?.frameLabel ?? "n/a"}] L(${idleStr(r, "left")}) R(${idleStr(r, "right")})\n` +
          `    arrival[${r.arrival?.frameLabel ?? "n/a"}] L(${r.arrival ? fmt(r.arrival.left) : "n/a"}) R(${r.arrival ? fmt(r.arrival.right) : "n/a"}) defect=${r.defect}${r.nullContact ? " NULL-CONTACT" : ""}\n`,
      );
    }
    const d = result[c.name];
    if (!d) throw new Error(`missing config result for ${c.name}`);
    const mfmt = (m: FootPitchMean): string =>
      `heel+${m.heelAboveFloorM === null ? "?" : (m.heelAboveFloorM * 1000).toFixed(1)}mm toe+${m.toeAboveFloorM === null ? "?" : (m.toeAboveFloorM * 1000).toFixed(1)}mm pitch${m.pitchDeg === null ? "?" : m.pitchDeg.toFixed(1)}deg`;
    process.stdout.write(
      `[${c.name}] n=${d.nRuns} defectRuns=${d.defectRuns} meanArrival L(${mfmt(d.meanArrival.left)}) R(${mfmt(d.meanArrival.right)})\n`,
    );
  }
  const allRuns = Object.values(result).flatMap((c) => c.runs);
  const anyNull = allRuns.some((r) => r.nullContact);
  const defectRuns = allRuns.filter((r) => r.defect).length;
  const doc = {
    schemaVersion: "openclinxr.standing-pitch.v1",
    measuredAt: new Date().toISOString(),
    definition: STANDING_PITCH_DEFINITION,
    bars: { heelLiftM: HEEL_LIFT_M, toeDownM: TOE_DOWN_M, pitchDeg: PITCH_DEFECT_DEG },
    configs: result,
    decision: {
      defect: defectRuns > 0,
      defectRuns,
      nRuns: allRuns.length,
      nullContact: anyNull,
      reason: anyNull
        ? "contact probe null on arrival frames; no verdict possible from this measure"
        : defectRuns > 0
          ? `DEFECT: ${defectRuns}/${allRuns.length} runs trip the pre-registered heel-lift or pitch bar at arrival`
          : `no defect: 0/${allRuns.length} runs trip the heel-lift or pitch bar at arrival`,
    },
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath} defect=${doc.decision.defect}\n`);
}

function idleStr(r: RunPitch, side: Side): string {
  const p = side === "left" ? r.idle?.left : r.idle?.right;
  if (!p) return "n/a";
  return `heel+${p.heelAboveFloorM === null ? "?" : (p.heelAboveFloorM * 1000).toFixed(1)}mm toe+${p.toeAboveFloorM === null ? "?" : (p.toeAboveFloorM * 1000).toFixed(1)}mm pitch${p.pitchDeg === null ? "?" : p.pitchDeg.toFixed(1)}deg`;
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("standing-pitch-measure.ts");

if (invokedAsScript) {
  await main();
}
