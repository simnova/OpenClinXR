/**
 * Settle-entry stage-1 loop analysis (2026-10-12 slice): compares two runs'
 * stepping-turn slot-update traces and names the feedback term.
 *
 * Per settling frame (first 20): |delta slot| between runs, each term's
 * difference (yaw set, pelvis dip, pin pass 0/1), and the per-frame gain
 * (difference_n / difference_n-1). Verdict: which term has gain > 1 and which
 * input it re-reads, with file:line.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/settle-entry/settle-entry-trace-analyze.ts \
 *     --a=.openclinxr/evidence/settle-entry/trace/sc05-run0 \
 *     --b=.openclinxr/evidence/settle-entry/trace/sc05-run3
 * (each prefix names a <prefix>.json run file and a <prefix>.trace.json trace).
 */
import { readFile } from "node:fs/promises";

type TracePass = {
  pass: number;
  dx: number;
  dz: number;
  targetX: number;
  targetZ: number;
  targetY: number;
  toeWorldX: number;
  toeWorldZ: number;
  toeWorldY: number;
  offsetCapturedThisFrame: boolean;
  footQuatCapturedThisFrame: boolean;
};

type TraceFrame = {
  frame: number;
  elapsedS: number;
  stepIndex: number;
  u: number;
  stanceFoot: string;
  swingFoot: string;
  yawPrev: number;
  yawNew: number;
  dipY: number;
  slotBeforeX: number;
  slotBeforeZ: number;
  slotAfterX: number;
  slotAfterZ: number;
  passes: TracePass[];
  toeLeftY: number | null;
  toeRightY: number | null;
  floorOriginY: number | null;
  pivot: {
    dx: number;
    dz: number;
    anchorX: number | null;
    anchorZ: number | null;
    anchorWindow: string | null;
    pendingWindow: string | null;
    legacy: boolean;
  } | null;
};

type Frame = {
  phase: string | null;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: { x: number; y: number; z: number } | null;
  rightToe: { x: number; y: number; z: number } | null;
};

function prefixFromArgv(name: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!flag) throw new Error(`usage: --${name}=runPrefix`);
  return flag;
}

const mm = (v: number): string => (v * 1000).toFixed(3);

async function main(): Promise<void> {
  const aPrefix = prefixFromArgv("a");
  const bPrefix = prefixFromArgv("b");
  const aRun = JSON.parse(await readFile(`${aPrefix}.json`, "utf8")) as { frames: Frame[] };
  const bRun = JSON.parse(await readFile(`${bPrefix}.json`, "utf8")) as { frames: Frame[] };
  const aTrace = JSON.parse(await readFile(`${aPrefix}.trace.json`, "utf8")) as TraceFrame[];
  const bTrace = JSON.parse(await readFile(`${bPrefix}.trace.json`, "utf8")) as TraceFrame[];

  const settling = (frames: Frame[]): Frame[] => frames.filter((f) => f.phase === "settling");
  const aSet = settling(aRun.frames);
  const bSet = settling(bRun.frames);
  const n = Math.min(aSet.length, bSet.length, aTrace.length, bTrace.length, 20);
  console.log(`settling frames: a=${aSet.length} b=${bSet.length} traceA=${aTrace.length} traceB=${bTrace.length}; table n=${n}`);

  // Entry toe heights above the floor (why airborne at entry).
  const t0a = aTrace[0]!;
  const t0b = bTrace[0]!;
  const floorA = t0a.floorOriginY ?? 0;
  console.log(
    `entry toe heights above floor: runA left=${mm((t0a.toeLeftY ?? NaN) - floorA)}mm right=${mm((t0a.toeRightY ?? NaN) - floorA)}mm stance=${t0a.stanceFoot}; ` +
      `runB left=${mm((t0b.toeLeftY ?? NaN) - floorA)}mm right=${mm((t0b.toeRightY ?? NaN) - floorA)}mm stance=${t0b.stanceFoot}`,
  );
  const capA = aTrace.map((t, i) => (t.passes.some((p) => p.offsetCapturedThisFrame) ? i : -1)).filter((i) => i >= 0);
  console.log(`anchor-capture trace frames (offset captured, runA): ${capA.join(",") || "none"}`);

  console.log("| n | |dslot| (mm) | yawDiff (urad) | dipDiff (um) | pin0diff (mm) | pin1diff (mm) | toeReadDiff (mm) | pivotDiff (mm) | gain |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    const fa = aSet[i]!;
    const fb = bSet[i]!;
    const dslot = fa.slot && fb.slot ? Math.hypot(fa.slot.x - fb.slot.x, fa.slot.z - fb.slot.z) : NaN;
    const ta = aTrace[i]!;
    const tb = bTrace[i]!;
    const yawDiff = Math.abs(ta.yawNew - tb.yawNew) * 1e6;
    const dipDiff = Math.abs(ta.dipY - tb.dipY) * 1e6;
    const pin = (k: number): number => {
      const pa = ta.passes[k];
      const pb = tb.passes[k];
      if (!pa || !pb) return NaN;
      return Math.hypot(pa.dx - pb.dx, pa.dz - pb.dz);
    };
    const p0 = pin(0);
    const p1 = pin(1);
    const ra = ta.passes[0];
    const rb = tb.passes[0];
    const toeDiff = ra && rb ? Math.hypot(ra.toeWorldX - rb.toeWorldX, ra.toeWorldZ - rb.toeWorldZ) : NaN;
    const pivDiff =
      ta.pivot && tb.pivot ? Math.hypot(ta.pivot.dx - tb.pivot.dx, ta.pivot.dz - tb.pivot.dz) : NaN;
    const gain = i === 0 ? NaN : prev > 0 ? dslot / prev : NaN;
    prev = dslot;
    const f = (v: number): string => (Number.isNaN(v) ? "—" : mm(v));
    console.log(
      `| ${i} | ${mm(dslot)} | ${yawDiff.toFixed(3)} | ${dipDiff.toFixed(3)} | ${f(p0)} | ${f(p1)} | ${f(toeDiff)} | ${f(pivDiff)} | ${Number.isNaN(gain) ? "—" : gain.toFixed(2)} |`,
    );
  }
  const wins = [...new Set(aTrace.slice(0, n).map((t) => t.pivot?.anchorWindow ?? "?"))];
  const pend = [...new Set(aTrace.slice(0, n).map((t) => t.pivot?.pendingWindow ?? "?"))];
  console.log(`pivot windows (runA): ${wins.join(",")}; pending: ${pend.join(",")}; legacy=${aTrace[0]?.pivot?.legacy ?? "?"}`);
  // Term totals over the table: which term moves the slot between runs.
  let yawTot = 0;
  let dipTot = 0;
  let pinTot = 0;
  for (let i = 0; i < n; i += 1) {
    const ta = aTrace[i]!;
    const tb = bTrace[i]!;
    yawTot += Math.abs(ta.yawNew - tb.yawNew);
    dipTot += Math.abs(ta.dipY - tb.dipY);
    for (let k = 0; k < 2; k += 1) {
      const pa = ta.passes[k];
      const pb = tb.passes[k];
      if (pa && pb) pinTot += Math.hypot(pa.dx - pb.dx, pa.dz - pb.dz);
    }
  }
  console.log(`term totals over ${n} frames: yaw=${(yawTot * 1e6).toFixed(2)}urad dip=${(dipTot * 1e6).toFixed(2)}um pin=${mm(pinTot)}mm`);
}

await main();
