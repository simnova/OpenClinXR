/**
 * Foot-base divergence dump (DENSE_v1 handback, STEP 1): per-frame
 * slot/toe-mid comparison between one control run (footstepPlan, no
 * footBase) and one footBase run, plus the mixer's-own vs post-footBase
 * decomposition from the footstep tap.
 *
 * INSTRUMENT ONLY. Reads committed capture JSON; writes no product code.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/foot-base-divergence.ts \
 *     --before=.openclinxr/evidence/foot-base/before/sc05-run0.json \
 *     --after=.openclinxr/evidence/foot-base/after/sc05-run0.json \
 *     --tap=.openclinxr/evidence/foot-base/after/tap-sc05-run0.json \
 *     --out=.openclinxr/evidence/foot-base/divergence.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Vec3 = { x: number; y: number; z: number };
type Frame = {
  phase: string | null;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  clipTime?: number | null;
  walkSimSubsteps?: number | null;
  startWorld?: Vec3 | null;
  targetWorld?: Vec3 | null;
};
type RunFile = { urlQuery?: string; frames: Frame[] };
type TapRecord = {
  sub: number;
  scale: number | null;
  stanceLabel: string | null;
  mixer: { left: Vec3; right: Vec3; slotX: number; slotZ: number };
  blend: { left: Vec3; right: Vec3; slotX: number; slotZ: number };
};
type TapFile = { urlQuery?: string; records: TapRecord[] };

function arg(name: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!flag) throw new Error(`usage: --${name}=...`);
  return flag;
}

function toeMid(f: Frame): { x: number; z: number } | null {
  if (!f.slot || !f.leftToe || !f.rightToe) return null;
  return {
    x: (f.leftToe.x + f.rightToe.x) / 2,
    z: (f.leftToe.z + f.rightToe.z) / 2,
  };
}

function subOf(f: Frame): number | null {
  return typeof f.walkSimSubsteps === "number" ? f.walkSimSubsteps : null;
}

async function main(): Promise<void> {
  const before = JSON.parse(await readFile(arg("before"), "utf8")) as RunFile;
  const after = JSON.parse(await readFile(arg("after"), "utf8")) as RunFile;
  const tap = JSON.parse(await readFile(arg("tap"), "utf8")) as TapFile;
  const out = arg("out");

  const n = Math.min(before.frames.length, after.frames.length);
  const lines: string[] = [];
  lines.push("frame | phaseA stanceA | slotA | toeMidA | slotMinusToeMidA | slotMinusToeMidB | |deltaVec|");
  const dist: Array<number | null> = [];
  for (let i = 0; i < n; i += 1) {
    const a = after.frames[i]!;
    const b = before.frames[i]!;
    const ma = toeMid(a);
    const mb = toeMid(b);
    if (!ma || !mb || !a.slot || !b.slot) {
      dist.push(null);
      continue;
    }
    const va = { x: a.slot.x - ma.x, z: a.slot.z - ma.z };
    const vb = { x: b.slot.x - mb.x, z: b.slot.z - mb.z };
    const d = Math.hypot(va.x - vb.x, va.z - vb.z);
    dist.push(d);
    lines.push(
      `${i} | ${a.phase} ${a.stanceFoot} sub=${subOf(a) ?? "?"} clipT=${a.clipTime?.toFixed(3) ?? "?"} `
      + `| slot(${a.slot.x.toFixed(3)},${a.slot.z.toFixed(3)}) mid(${ma.x.toFixed(3)},${ma.z.toFixed(3)}) `
      + `| A(${va.x.toFixed(3)},${va.z.toFixed(3)}) B(${vb.x.toFixed(3)},${vb.z.toFixed(3)}) d=${d.toFixed(4)}`,
    );
  }

  // First frame where the after vector departs from the before vector by
  // more than 0.03 m, sustained for 3 frames (no single-frame blips).
  const THRESHOLD_M = 0.03;
  let divergenceFrame: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const w = [dist[i], dist[i + 1], dist[i + 2]];
    if (w.every((d) => d !== null && d !== undefined && (d as number) > THRESHOLD_M)) {
      divergenceFrame = i;
      break;
    }
  }

  // Tap decomposition: mixer (pre-footBase) -> blend (post-footBase) per
  // substep. Under footBase the amplitude blend and the closed loop are both
  // skipped, the stance lock is observe-only, so mixer->blend is footBase's
  // own slot SET + stance pin + IK solves, and blend->post is ~nothing.
  const start = after.frames[0]?.startWorld ?? null;
  const target = after.frames[0]?.targetWorld ?? null;
  let ux = 0;
  let uz = 1;
  if (start && target) {
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      ux = dx / len;
      uz = dz / len;
    }
  }
  const along = (x: number, z: number): number => (x - (start?.x ?? 0)) * ux + (z - (start?.z ?? 0)) * uz;
  const tapLines: string[] = [];
  tapLines.push("sub | stance | mixerSlotAlong blendSlotAlong footBaseSlotDeltaAlong | mixerToeMidAlong blendToeMidAlong");
  const slotDeltas: number[] = [];
  for (const r of tap.records) {
    const mSlot = along(r.mixer.slotX, r.mixer.slotZ);
    const bSlot = along(r.blend.slotX, r.blend.slotZ);
    const mMid = along((r.mixer.left.x + r.mixer.right.x) / 2, (r.mixer.left.z + r.mixer.right.z) / 2);
    const bMid = along((r.blend.left.x + r.blend.right.x) / 2, (r.blend.left.z + r.blend.right.z) / 2);
    slotDeltas.push(bSlot - mSlot);
    tapLines.push(
      `${r.sub} | ${r.stanceLabel} | ${mSlot.toFixed(3)} ${bSlot.toFixed(3)} ${(bSlot - mSlot).toFixed(3)} `
      + `| ${mMid.toFixed(3)} ${bMid.toFixed(3)}`,
    );
  }
  const last = tap.records[tap.records.length - 1]!;
  const mixerToeEnd = along((last.mixer.left.x + last.mixer.right.x) / 2, (last.mixer.left.z + last.mixer.right.z) / 2);
  const blendToeEnd = along((last.blend.left.x + last.blend.right.x) / 2, (last.blend.left.z + last.blend.right.z) / 2);
  const blendSlotEnd = along(last.blend.slotX, last.blend.slotZ);
  const footLagM = mixerToeEnd - blendToeEnd;
  const slotAheadOfFeetM = blendSlotEnd - blendToeEnd;

  const result = {
    beforeQuery: before.urlQuery ?? null,
    afterQuery: after.urlQuery ?? null,
    tapQuery: tap.urlQuery ?? null,
    thresholdM: THRESHOLD_M,
    divergenceFrame,
    divergence: divergenceFrame === null ? null : {
      frame: divergenceFrame,
      afterVec: (() => {
        const a = after.frames[divergenceFrame]!;
        const m = toeMid(a)!;
        return { x: a.slot!.x - m.x, z: a.slot!.z - m.z };
      })(),
      beforeVec: (() => {
        const f = before.frames[divergenceFrame]!;
        const m = toeMid(f)!;
        return { x: f.slot!.x - m.x, z: f.slot!.z - m.z };
      })(),
      distM: dist[divergenceFrame],
    },
    tapWalkSummary: {
      substeps: tap.records.length,
      footBaseSlotDeltaAlongMinM: Math.min(...slotDeltas),
      footBaseSlotDeltaAlongMaxM: Math.max(...slotDeltas),
      mixerToeMidAlongEndM: mixerToeEnd,
      blendToeMidAlongEndM: blendToeEnd,
      /** Positive = footBase holds the feet behind the clip's own feet. */
      footLagBehindClipM: footLagM,
      /** Positive = slot ahead of (its own) feet along the route at walk end. */
      slotAheadOfFeetAlongM: slotAheadOfFeetM,
    },
  };

  process.stdout.write(`${lines.join("\n")}\n\n${tapLines.join("\n")}\n`);
  process.stdout.write(`\nDIVERGENCE frame=${divergenceFrame} dist=${divergenceFrame === null ? "n/a" : (dist[divergenceFrame] as number).toFixed(4)}\n`);
  process.stdout.write(`TAP footLag=${footLagM.toFixed(3)}m slotAhead=${slotAheadOfFeetM.toFixed(3)}m pinFight=[${Math.min(...slotDeltas).toFixed(3)},${Math.max(...slotDeltas).toFixed(3)}]m/substep\n`);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(result, null, 2));
  process.stdout.write(`[divergence] wrote ${out}\n`);
}

await main();
