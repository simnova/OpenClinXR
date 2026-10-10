/**
 * kimodo-stop-oneshot measurement: world-space foot-plant metrics for a bound one-shot
 * STOP clip beside the SAME rig's shipped walk clip (knownGood), from an identical
 * instrument.
 *
 * Tracks come from boundClipJointTrack (gltf-transform FK over the bound GLB, world
 * space including root translation) and measureBoundClipFootPlant (whose
 * clip.rootTravelMeters cross-checks the root track: nonzero on a root-motion stop clip,
 * ~0 on the stripped shipped walk). A foot measured in hips-local space would hide slide
 * by construction; this instrument does not do that.
 *
 * Stance windows: per-foot contact = toe height within STANCE_FLOOR_M (0.01 m) of that
 * toe's own clip minimum. Maximal runs, gaps <= 2 samples merged, runs < 0.15 s dropped.
 * The 0.01 m floor is stated (not fitted): the knownGood tolerance half-band (0.005 m)
 * derives from it.
 *
 * Metrics per clip: plantedSlideStopM (toe XZ bbox-diagonal travel per stance window;
 * median + max pooled over both feet; final hold window = last 1.0 s reported per foot),
 * maxToeStepPerFrameM (max consecutive-sample XZ step, both toes), rootDisplacementM
 * (first-to-last horizontal root travel), finalRootSpeedMps (mean horizontal root speed
 * over the last 0.3 s), steadyWalkRootSpeedMps (mean over the first 1.0 s, context for
 * the 10% bar whose denominator is the clip's input speed, passed as --input-speed-mps).
 *
 * Usage:
 *   mise exec -- tsx tools/openclinxr/factory/kimodo-loop/measure_stop_oneshot.ts \
 *     --glb <stop.glb> --stop-clip <name> --walk-clip openclinxr_retarget_walk_source \
 *     --input-speed-mps 1.03 --out <metrics.json>
 */
import { writeFileSync, readFileSync } from "node:fs";
import { boundClipJointTrack } from "../../evidence/foot-plant/bound-clip-foot-track.js";
import { measureBoundClipFootPlant } from "../../evidence/foot-plant/bound-clip-foot-plant.js";
import { HOLD_SLIDE_MAX_METERS } from "../../evidence/foot-plant/walk-quality-metrics.js";
import { MAX_TOE_STEP_PER_FRAME_FLAG_METERS } from "../../evidence/foot-plant/turn-quality-metrics.js";

const STANCE_FLOOR_M = 0.01;
const MIN_WINDOW_S = 0.15;
const MERGE_GAP_SAMPLES = 2;
const HOLD_S = 1.0;
const FINAL_SPEED_S = 0.3;
const STEADY_S = 1.0;
const TOES = ["toe1-1.L", "toe1-1.R"] as const;

type Sample = { atMs: number; position: { x: number; y: number; z: number } };

function xz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function bboxTravel(samples: Sample[]): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.position.x); maxX = Math.max(maxX, s.position.x);
    minZ = Math.min(minZ, s.position.z); maxZ = Math.max(maxZ, s.position.z);
  }
  return Math.hypot(maxX - minX, maxZ - minZ);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** Maximal contact runs for one toe track. Contact = within STANCE_FLOOR_M of own minimum. */
function stanceWindows(track: Sample[]): Sample[][] {
  const minY = Math.min(...track.map((s) => s.position.y));
  const contact = track.map((s) => s.position.y <= minY + STANCE_FLOOR_M);
  const runs: Sample[][] = [];
  let current: Sample[] = [];
  let gap = 0;
  const pending: Sample[] = [];
  for (let i = 0; i < track.length; i += 1) {
    const sample = track[i]!;
    if (contact[i]) {
      if (gap > 0 && gap <= MERGE_GAP_SAMPLES) current.push(...pending);
      else if (gap > MERGE_GAP_SAMPLES && current.length > 0) { runs.push(current); current = []; }
      gap = 0; pending.length = 0;
      current.push(sample);
    } else {
      gap += 1; pending.push(sample);
      if (gap > MERGE_GAP_SAMPLES && current.length > 0) { runs.push(current); current = []; pending.length = 0; gap = 0; }
    }
  }
  if (current.length > 0) runs.push(current);
  return runs.filter((w) => (w[w.length - 1]!.atMs - w[0]!.atMs) / 1000 >= MIN_WINDOW_S);
}

function meanSpeed(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  let dist = 0;
  for (let i = 1; i < samples.length; i += 1) dist += xz(samples[i - 1]!.position, samples[i]!.position);
  const dt = (samples[samples.length - 1]!.atMs - samples[0]!.atMs) / 1000;
  return dt > 0 ? dist / dt : 0;
}

async function measureClip(glbPath: string, clipName: string) {
  const toes = await Promise.all(
    TOES.map(async (boneName) => ({
      boneName,
      track: (await boundClipJointTrack({ glbPath, clipName, boneName })).samples as Sample[],
    })),
  );
  const root = (await boundClipJointTrack({ glbPath, clipName, boneName: "root" })).samples as Sample[];
  const plant = await measureBoundClipFootPlant({ glbPath, clipName });

  const windows = toes.flatMap((t) => stanceWindows(t.track).map((w) => ({ foot: t.boneName, travel: bboxTravel(w) })));
  const travels = windows.map((w) => w.travel);

  const endMs = root[root.length - 1]!.atMs;
  const holdTrack = (track: Sample[]) => track.filter((s) => s.atMs >= endMs - HOLD_S * 1000);
  const tailTrack = (track: Sample[], seconds: number) =>
    track.filter((s) => s.atMs >= endMs - seconds * 1000);
  const headTrack = (track: Sample[], seconds: number) => {
    const t0 = root[0]!.atMs;
    return track.filter((s) => s.atMs <= t0 + seconds * 1000);
  };

  let maxStep = 0;
  let maxStepAt: { foot: string; atMs: number } | null = null;
  for (const t of toes) {
    for (let i = 1; i < t.track.length; i += 1) {
      const step = xz(t.track[i - 1]!.position, t.track[i]!.position);
      if (step > maxStep) { maxStep = step; maxStepAt = { foot: t.boneName, atMs: t.track[i]!.atMs }; }
    }
  }

  return {
    clipName,
    frameCount: root.length,
    durationSeconds: (endMs - root[0]!.atMs) / 1000,
    plantedSlideStopM: {
      windowCount: windows.length,
      median: median(travels),
      max: travels.length > 0 ? Math.max(...travels) : 0,
      perFootMedian: Object.fromEntries(
        TOES.map((f) => [f, median(windows.filter((w) => w.foot === f).map((w) => w.travel))]),
      ),
    },
    finalHoldToeTravelM: Object.fromEntries(
      toes.map((t) => [t.boneName, bboxTravel(holdTrack(t.track))]),
    ),
    maxToeStepPerFrameM: maxStep,
    maxToeStepAt: maxStepAt,
    rootDisplacementM: xz(root[0]!.position, root[root.length - 1]!.position),
    rootTravelMetersInstrument: plant.clip.rootTravelMeters,
    finalRootSpeedMps: meanSpeed(tailTrack(root, FINAL_SPEED_S)),
    steadyWalkRootSpeedMps: meanSpeed(headTrack(root, STEADY_S)),
  };
}

/**
 * Source-side knownGood: the same four metrics computed on Kimodo's own exported joints
 * (meters, Z-up after the export conversion, 30 fps) instead of on a bound GLB. Stance
 * windows come from the export's own foot-contact labels (toe or toeEnd true per foot),
 * runs >= 0.15 s; the same XZ bbox-travel metric. This is the INPUT of the causal chain,
 * so the knownGood-relative bar asks whether the retarget preserves the plant the
 * generator produced. The shipped in-place loop stays in the report as context only.
 */
function measureSource(jointsPath: string, contactsPath: string) {
  const SOURCE_FPS = 30;
  const joints = JSON.parse(readFileSync(jointsPath, "utf-8")) as Record<string, number[][]>;
  const contacts = JSON.parse(readFileSync(contactsPath, "utf-8")) as number[][];
  const names = Object.keys(joints).filter((k) => k !== "_frames");
  const frameCount = (joints[names[0]!] ?? []).length;
  const toTrack = (name: string): Sample[] =>
    (joints[name] ?? []).map((p, i) => ({
      atMs: (i * 1000) / SOURCE_FPS,
      position: { x: p[0]!, y: p[1]!, z: p[2]! },
    }));
  const toes = [
    { boneName: "LeftToeBase", track: toTrack("LeftToeBase") },
    { boneName: "RightToeBase", track: toTrack("RightToeBase") },
  ];
  const root = toTrack("Hips");
  // Contact columns per the export script: [L_heel, L_toe, L_toeEnd, R_heel, R_toe, R_toeEnd].
  const contactFor = (foot: 0 | 1, i: number): boolean => {
    const row = contacts[i] ?? [];
    const o = foot === 0 ? 0 : 3;
    return (row[o + 1] ?? 0) !== 0 || (row[o + 2] ?? 0) !== 0;
  };
  const windows: Array<{ foot: string; travel: number }> = [];
  (["LeftToeBase", "RightToeBase"] as const).forEach((foot, fi) => {
    const track = toTrack(foot);
    let current: Sample[] = [];
    const flush = () => {
      if (current.length >= 2 &&
        (current[current.length - 1]!.atMs - current[0]!.atMs) / 1000 >= MIN_WINDOW_S) {
        windows.push({ foot, travel: bboxTravel(current) });
      }
      current = [];
    };
    for (let i = 0; i < track.length; i += 1) {
      if (contactFor(fi as 0 | 1, i)) current.push(track[i]!);
      else flush();
    }
    flush();
  });
  const travels = windows.map((w) => w.travel);
  const endMs = root[root.length - 1]!.atMs;
  let maxStep = 0;
  let maxStepAt: { foot: string; atMs: number } | null = null;
  for (const t of toes) {
    for (let i = 1; i < t.track.length; i += 1) {
      const step = xz(t.track[i - 1]!.position, t.track[i]!.position);
      if (step > maxStep) { maxStep = step; maxStepAt = { foot: t.boneName, atMs: t.track[i]!.atMs }; }
    }
  }
  const disp = xz(root[0]!.position, root[root.length - 1]!.position);
  return {
    clipName: "kimodo_source",
    frameCount,
    durationSeconds: frameCount / SOURCE_FPS,
    plantedSlideStopM: {
      windowCount: windows.length,
      median: median(travels),
      max: travels.length > 0 ? Math.max(...travels) : 0,
      perFootMedian: {
        LeftToeBase: median(windows.filter((w) => w.foot === "LeftToeBase").map((w) => w.travel)),
        RightToeBase: median(windows.filter((w) => w.foot === "RightToeBase").map((w) => w.travel)),
      },
    },
    finalHoldToeTravelM: Object.fromEntries(
      toes.map((t) => [t.boneName, bboxTravel(t.track.filter((s) => s.atMs >= endMs - HOLD_S * 1000))]),
    ),
    maxToeStepPerFrameM: maxStep,
    maxToeStepAt: maxStepAt,
    rootDisplacementM: disp,
    rootTravelMetersInstrument: disp,
    finalRootSpeedMps: meanSpeed(root.filter((s) => s.atMs >= endMs - FINAL_SPEED_S * 1000)),
    steadyWalkRootSpeedMps: meanSpeed(root.filter((s) => s.atMs <= root[0]!.atMs + STEADY_S * 1000)),
  };
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i]!.replace(/^--/, "")] = argv[i + 1] ?? "";
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const glb = args["glb"] ?? "";
  const stopClip = args["stop-clip"] ?? "";
  const walkClip = args["walk-clip"] ?? "openclinxr_retarget_walk_source";
  const inputSpeed = Number(args["input-speed-mps"] ?? "0");
  const outPath = args["out"] ?? "";
  const sourceJoints = args["source-joints"] ?? "";
  const sourceContacts = args["source-contacts"] ?? "";
  if (!glb || !stopClip || !outPath || !(inputSpeed > 0)) {
    throw new Error("required: --glb --stop-clip --out --input-speed-mps (>0); optional: --walk-clip --source-joints --source-contacts");
  }

  const stop = await measureClip(glb, stopClip);
  const walk = await measureClip(glb, walkClip);
  // knownGood defaults to the shipped loop for backward compatibility; the cagematch
  // passes --source-joints/--source-contacts so the bar compares bound vs generator.
  const knownGood = (sourceJoints && sourceContacts)
    ? measureSource(sourceJoints, sourceContacts)
    : walk;

  const stopMedian = stop.plantedSlideStopM.median;
  const knownMedian = (knownGood.plantedSlideStopM as { median: number | null }).median;
  const bars = {
    slideMedianLe002: stopMedian !== null && stopMedian <= HOLD_SLIDE_MAX_METERS,
    // Bound vs generator input: does the retarget preserve the plant Kimodo produced?
    // False (not fabricated 0) when either side yields no >= 0.15 s windows.
    slideMedianWithinKnownGoodPlus0005:
      stopMedian !== null && knownMedian !== null && stopMedian <= knownMedian + 0.005,
    finalHoldPerFootLe002: Object.values(stop.finalHoldToeTravelM as Record<string, number>)
      .every((v) => v <= HOLD_SLIDE_MAX_METERS),
    maxToeStepLe008: stop.maxToeStepPerFrameM <= MAX_TOE_STEP_PER_FRAME_FLAG_METERS,
    finalRootSpeedLe10pct: stop.finalRootSpeedMps <= 0.1 * inputSpeed,
  };

  const report = {
    schemaVersion: "openclinxr.kimodo-stop-oneshot-metrics.v1",
    glbPath: glb,
    stopClip: stopClip,
    knownGoodClip: (sourceJoints && sourceContacts) ? "kimodo_source" : walkClip,
    knownGoodSource: (sourceJoints && sourceContacts)
      ? { joints: sourceJoints, contacts: sourceContacts, units: "meters", axis: "Z-up", fps: 30 }
      : null,
    stanceFloorM: STANCE_FLOOR_M,
    inputSpeedMps: inputSpeed,
    stop,
    knownGood,
    shippedWalkContext: walk,
    bars: {
      HOLD_SLIDE_MAX_METERS,
      MAX_TOE_STEP_PER_FRAME_FLAG_METERS,
      finalRootSpeedCapMps: 0.1 * inputSpeed,
      results: bars,
      allPass: Object.values(bars).every(Boolean),
    },
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    stopMedian: stop.plantedSlideStopM.median,
    stopMax: stop.plantedSlideStopM.max,
    finalHold: stop.finalHoldToeTravelM,
    maxStep: stop.maxToeStepPerFrameM,
    rootDisp: stop.rootDisplacementM,
    finalRootSpeed: stop.finalRootSpeedMps,
    knownGoodMedian: knownGood.plantedSlideStopM.median,
    allPass: report.bars.allPass,
  }));
}

await main();
