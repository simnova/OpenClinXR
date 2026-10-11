import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { bedsideClearanceViolations } from "@openclinxr/asset-registry";
import {
  intentFor,
  runApproach,
  stageWard,
} from "../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import {
  ARRIVAL_TURN_RIGS,
  decodeArrivalTurnRig,
} from "./arrival-turn-cagematch.js";

/**
 * Arrival-turn geometry analysis (2026-10-11): prior-art arc diagnosis + candidate-B
 * Dubins CSC feasibility, both from the live SC-05 intent (no hand-copied numbers).
 *
 * 1. PRIOR ART: reconstruct wt/turn-freeze's circular arc (2f8080585) — circle through
 *    `start` with tangent `startHeading` through `target` — and report its END tangent
 *    vs the target FACING. Expected: end tangent fixed by geometry, arrival heading
 *    unconstrained (residual gain ~0).
 * 2. CANDIDATE B: Dubins CSC paths from (start, startHeading) to (target, targetFacing)
 *    over radii [0.5, 0.75, 1.0, R_MIN]; per radius report length, arc angle, max lateral
 *    deviation from the chord, per-step yaw at measured step length, and swept-route
 *    violations via the PUBLIC `bedsideClearanceViolations` resampled every 0.04 m
 *    (same spacing as `sweptRouteViolations`, bedside-approach-path-mod.ts).
 * 3. R_MIN: stepLength / SETTLING_CLIP_TURN_MAX_PHASE_RADIANS, with stepLength measured
 *    off the shipped walk clip (mean stance-phase forward travel per footfall).
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/arrival-turn-geometry.ts \
 *   [--out .openclinxr/evidence/arrival-turn/geometry.json]
 */

const SETTLING_CLIP_TURN_MAX_PHASE_RADIANS = (30 * Math.PI) / 180;
const SWEEP_SPACING_M = 0.04;

type Xz = { x: number; z: number };

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}
const dirOf = (h: number): Xz => ({ x: Math.sin(h), z: Math.cos(h) });

/** Circle through p with tangent heading h, passing through q. Returns null if degenerate. */
function arcThroughPoint(
  p: Xz,
  h: number,
  q: Xz,
): { center: Xz; radius: number; endTangent: number; arcAngle: number } | null {
  const d = dirOf(h);
  const nx = d.z;
  const nz = -d.x;
  const vx = q.x - p.x;
  const vz = q.z - p.z;
  const denom = 2 * (vx * nx + vz * nz);
  if (Math.abs(denom) < 1e-9) return null;
  const t = (vx * vx + vz * vz) / denom;
  const center = { x: p.x + nx * t, z: p.z + nz * t };
  const radius = Math.abs(t);
  const a0 = Math.atan2(p.x - center.x, p.z - center.z);
  const a1 = Math.atan2(q.x - center.x, q.z - center.z);
  let sweep = a1 - a0;
  const side = t >= 0 ? 1 : -1;
  if (side > 0 && sweep < 0) sweep += 2 * Math.PI;
  if (side < 0 && sweep > 0) sweep -= 2 * Math.PI;
  const endTangent = Math.atan2(q.x - center.x, q.z - center.z) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { center, radius, endTangent, arcAngle: sweep };
}

type DubinsPath = { family: string; length: number; points: Xz[]; arcAngleTotal: number; endHeading: number };

/**
 * Turn-center Dubins CSC solver, first principles (circle tangents, no memorised
 * angle tables). Math plane is (x, y=z); heading h = atan2(x, z). L = CCW in that
 * plane. Every candidate is closure-verified (end position + heading); failures are
 * discarded, never trusted.
 */
function dubinsClosing(p0: Xz, h0: number, p1: Xz, h1: number, rho: number): DubinsPath[] {
  const TAU = Math.PI * 2;
  const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
  const add = (a: Xz, b: Xz): Xz => ({ x: a.x + b.x, z: a.z + b.z });
  const sub = (a: Xz, b: Xz): Xz => ({ x: a.x - b.x, z: a.z - b.z });
  const mul = (a: Xz, s: number): Xz => ({ x: a.x * s, z: a.z * s });
  const len = (a: Xz): number => Math.hypot(a.x, a.z);
  const ang = (a: Xz): number => Math.atan2(a.z, a.x);
  const nL = (h: number): Xz => ({ x: -Math.cos(h), z: Math.sin(h) });
  const nR = (h: number): Xz => ({ x: Math.cos(h), z: -Math.sin(h) });
  type Arc = { c: Xz; a0: number; sweep: number; dir: 1 | -1 };
  type Cand = { family: string; arcs: [Arc, Arc]; t0: Xz; t1: Xz };
  const cands: Cand[] = [];
  // External tangents (same-side circles): single tangent, travel = centre line.
  {
    const C0 = add(p0, mul(nL(h0), rho));
    const C1 = add(p1, mul(nL(h1), rho));
    const Dv = sub(C1, C0);
    const D = len(Dv) || 1e-12;
    const Dh = mul(Dv, 1 / D);
    const n: Xz = { x: Dh.z, z: -Dh.x }; // right normal of travel: centres ride on the left
    cands.push({
      family: "LSL",
      arcs: [
        { c: C0, a0: ang(sub(p0, C0)), sweep: norm(ang(n) - ang(sub(p0, C0))), dir: 1 },
        { c: C1, a0: ang(n), sweep: norm(ang(sub(p1, C1)) - ang(n)), dir: 1 },
      ],
      t0: add(C0, mul(n, rho)),
      t1: add(C1, mul(n, rho)),
    });
  }
  {
    const C0 = add(p0, mul(nR(h0), rho));
    const C1 = add(p1, mul(nR(h1), rho));
    const Dv = sub(C1, C0);
    const D = len(Dv) || 1e-12;
    const Dh = mul(Dv, 1 / D);
    const n: Xz = { x: -Dh.z, z: Dh.x }; // left normal of travel: centres ride on the right
    cands.push({
      family: "RSR",
      arcs: [
        { c: C0, a0: ang(sub(p0, C0)), sweep: norm(ang(sub(p0, C0)) - ang(n)), dir: -1 },
        { c: C1, a0: ang(n), sweep: norm(ang(n) - ang(sub(p1, C1))), dir: -1 },
      ],
      t0: add(C0, mul(n, rho)),
      t1: add(C1, mul(n, rho)),
    });
  }
  // Internal tangents (opposite-side circles): (C1-C0).n = 2*rho, two solutions.
  const internal = (
    family: "LSR" | "RSL",
    C0: Xz,
    C1: Xz,
    firstDir: 1 | -1,
  ): void => {
    const Dv = sub(C1, C0);
    const D = len(Dv);
    if (D < 2 * rho || D < 1e-12) return;
    const Dh = mul(Dv, 1 / D);
    const c = (2 * rho) / D;
    const s = Math.sqrt(Math.max(0, 1 - c * c));
    const perp: Xz = { x: -Dh.z, z: Dh.x };
    for (const sign of [1, -1]) {
      const n = add(mul(Dh, c), mul(perp, sign * s));
      const secondDir = (firstDir === 1 ? -1 : 1) as 1 | -1;
      cands.push({
        family,
        arcs: [
          { c: C0, a0: ang(sub(p0, C0)), sweep: firstDir === 1 ? norm(ang(n) - ang(sub(p0, C0))) : norm(ang(sub(p0, C0)) - ang(n)), dir: firstDir },
          { c: C1, a0: ang(mul(n, -1)), sweep: secondDir === 1 ? norm(ang(sub(p1, C1)) - ang(mul(n, -1))) : norm(ang(mul(n, -1)) - ang(sub(p1, C1))), dir: secondDir },
        ],
        t0: add(C0, mul(n, rho)),
        t1: add(C1, mul(n, -rho)),
      });
    }
  };
  internal("LSR", add(p0, mul(nL(h0), rho)), add(p1, mul(nR(h1), rho)), 1);
  internal("RSL", add(p0, mul(nR(h0), rho)), add(p1, mul(nL(h1), rho)), -1);

  // Sample every candidate; return all whose closure verifies, shortest first.
  const step = 0.02;
  const closing: DubinsPath[] = [];
  for (const cand of cands) {
    const points: Xz[] = [{ ...p0 }];
    let hdg = h0;
    let arcTotal = 0;
    for (const arc of cand.arcs.slice(0, 1)) {
      const n = Math.max(1, Math.ceil((arc.sweep * rho) / step));
      for (let i = 1; i <= n; i += 1) {
        const a = arc.a0 + arc.dir * arc.sweep * (i / n);
        points.push({ x: arc.c.x + rho * Math.cos(a), z: arc.c.z + rho * Math.sin(a) });
      }
      hdg -= arc.dir * arc.sweep; // L (CCW in math plane) decreases heading h
      arcTotal += arc.sweep;
    }
    const straightLen = len(sub(cand.t1, cand.t0));
    {
      const a = cand.t0;
      const b = cand.t1;
      const n = Math.max(1, Math.ceil(straightLen / step));
      for (let i = 1; i <= n; i += 1) {
        points.push({ x: a.x + (b.x - a.x) * (i / n), z: a.z + (b.z - a.z) * (i / n) });
      }
    }
    for (const arc of cand.arcs.slice(1)) {
      const n = Math.max(1, Math.ceil((arc.sweep * rho) / step));
      for (let i = 1; i <= n; i += 1) {
        const a = arc.a0 + arc.dir * arc.sweep * (i / n);
        points.push({ x: arc.c.x + rho * Math.cos(a), z: arc.c.z + rho * Math.sin(a) });
      }
      hdg -= arc.dir * arc.sweep;
      arcTotal += arc.sweep;
    }
    const endPoint = points[points.length - 1]!;
    const closureErrM = len(sub(endPoint, p1));
    const closureYawErr = Math.abs(wrapPi(hdg - h1));
    if (closureErrM > 0.01 || closureYawErr > toDeg(1) * (Math.PI / 180)) continue;
    const length = arcTotal * rho + straightLen;
    closing.push({ family: cand.family, length, points, arcAngleTotal: arcTotal, endHeading: hdg });
  }
  closing.sort((a, b) => a.length - b.length);
  return closing;
}

function maxLateralFromChord(points: Xz[], a: Xz, b: Xz): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let worst = 0;
  for (const p of points) {
    const lateral = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
    if (lateral > worst) worst = lateral;
  }
  return worst;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const outPath = flagValue("--out", ".openclinxr/evidence/arrival-turn/geometry.json");

  const ward = stageWard();
  const intent = intentFor(ward);
  if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
  const start: Xz = { x: intent.start.x, z: intent.start.z };
  const target: Xz = { x: intent.target.position.x, z: intent.target.position.z };
  const startHeading = Math.atan2(target.x - start.x, target.z - start.z);
  const targetFacing = intent.target.headingRadians;
  const requiredTurn = wrapPi(targetFacing - startHeading);
  const chordLen = Math.hypot(target.x - start.x, target.z - start.z);

  // Step length MEASURED: walk speed off one headless control run (route metres over
  // walking seconds) times half the decoded clip period (two stance phases per cycle).
  const physician = ARRIVAL_TURN_RIGS[0]!;
  const decoded = await decodeArrivalTurnRig(physician.glb);
  const run = runApproach({ ward, intent, seconds: 12, decoded });
  const walkSeconds = run.walkFrameCount / 60;
  const walkSpeedMps = chordLen / walkSeconds;
  const stepLengthM = walkSpeedMps * (decoded.periodMs / 1000 / 2);
  const rMinM = stepLengthM / SETTLING_CLIP_TURN_MAX_PHASE_RADIANS;

  // 1. Prior-art arc (bias fractions swept on wt/turn-freeze: 0.01..0.1, shipped 0.02).
  const priorArt: Array<Record<string, unknown>> = [];
  for (const bias of [0.0, 0.01, 0.02, 0.1]) {
    const biasedStart = startHeading - Math.sign(requiredTurn) * Math.abs(requiredTurn) * bias;
    const arc = arcThroughPoint(start, biasedStart, target);
    if (arc === null) {
      priorArt.push({ bias, degenerate: true });
      continue;
    }
    const endTangent = arc.endTangent;
    const residual = Math.abs(wrapPi(targetFacing - endTangent));
    priorArt.push({
      bias,
      degenerate: false,
      radiusM: arc.radius,
      startTangentDeg: toDeg(biasedStart),
      endTangentDeg: toDeg(endTangent),
      residualDeg: toDeg(residual),
      deliveredDeg: toDeg(Math.abs(requiredTurn)) - toDeg(residual),
    });
  }

  // 2. Candidate-B Dubins CSC family scan. Every closing family is swept and
  // reported (families array); the winner row carries the full detail.
  const obstacles = [...ward.geometry.obstacles];
  const floorY = ward.geometry.floorFrame?.originY;
  const sweepPath = (points: Xz[]): Array<{ obstacleId: string; overlapMeters: number }> => {
    const seen = new Map<string, number>();
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(segLen / SWEEP_SPACING_M));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        for (const v of bedsideClearanceViolations({
          standingPosition: { x: px, y: intent.start.y, z: pz },
          obstacles,
          ...(floorY === undefined || floorY === null ? {} : { floorY }),
        })) {
          if (v.kind !== "body_clearance") continue;
          const worst = seen.get(v.obstacleId) ?? 0;
          if (v.overlapMeters > worst) seen.set(v.obstacleId, v.overlapMeters);
        }
      }
    }
    return [...seen.entries()].map(([obstacleId, overlapMeters]) => ({ obstacleId, overlapMeters }));
  };
  const dubins: Array<Record<string, unknown>> = [];
  for (const rho of [0.5, 0.75, 1.0, rMinM]) {
    const closing = dubinsClosing(start, startHeading, target, targetFacing, rho);
    if (closing.length === 0) {
      dubins.push({ radiusM: rho, closingFamilies: 0 });
      continue;
    }
    const solved = closing[0]!;
    const endPoint = solved.points[solved.points.length - 1]!;
    const closureErrM = Math.hypot(endPoint.x - target.x, endPoint.z - target.z);
    const closureYawErrDeg = toDeg(Math.abs(wrapPi(solved.endHeading - targetFacing)));
    const lateralM = maxLateralFromChord(solved.points, start, target);
    const perStepYawDeg = toDeg(stepLengthM / rho);
    // Swept check: resample every 0.04 m, body_clearance only (mirrors sweptRouteViolations).
    dubins.push({
      radiusM: rho,
      family: solved.family,
      pathLengthM: solved.length,
      closureErrM,
      closureYawErrDeg,
      arcAngleTotalDeg: toDeg(solved.arcAngleTotal),
      maxLateralM: lateralM,
      perStepYawDeg,
      withinPhaseBudget: perStepYawDeg <= toDeg(SETTLING_CLIP_TURN_MAX_PHASE_RADIANS),
      sweptViolations: sweepPath(solved.points),
      families: closing.map((c) => ({
        family: c.family,
        pathLengthM: c.length,
        arcAngleTotalDeg: toDeg(c.arcAngleTotal),
        maxLateralM: maxLateralFromChord(c.points, start, target),
        sweptCount: sweepPath(c.points).length,
      })),
    });
  }

  // 3. Candidate C: (C1) start pushed back along the entry heading; (C2) deterministic
  // pre-arrival waypoint on the facing ray behind the target, two straight legs.
  const entryBack = dirOf(startHeading + Math.PI);
  const candidateC1: Array<Record<string, unknown>> = [];
  for (const pushback of [0.5, 1.0, 1.5]) {
    const s: Xz = { x: start.x + entryBack.x * pushback, z: start.z + entryBack.z * pushback };
    const h = Math.atan2(target.x - s.x, target.z - s.z);
    const closing = dubinsClosing(s, h, target, targetFacing, rMinM);
    const rows = closing.slice(0, 3).map((c) => ({
      family: c.family,
      pathLengthM: c.length,
      arcAngleTotalDeg: toDeg(c.arcAngleTotal),
      maxLateralM: maxLateralFromChord(c.points, s, target),
      sweptCount: sweepPath(c.points).length,
    }));
    const winner = closing[0];
    candidateC1.push({
      pushbackM: pushback,
      closingFamilies: closing.length,
      winnerFamily: winner?.family ?? null,
      winnerLengthM: winner?.length ?? null,
      winnerLateralM: winner ? maxLateralFromChord(winner.points, s, target) : null,
      winnerSwept: winner ? sweepPath(winner.points) : null,
      families: rows,
    });
  }
  const facingDir = dirOf(targetFacing);
  const candidateC2: Array<Record<string, unknown>> = [];
  for (const d of [0.5, 0.75, 1.0]) {
    const w: Xz = { x: target.x - facingDir.x * d, z: target.z - facingDir.z * d };
    const leg1: Xz[] = [];
    {
      const L = Math.hypot(w.x - start.x, w.z - start.z);
      const n = Math.max(2, Math.ceil(L / SWEEP_SPACING_M));
      for (let i = 0; i <= n; i += 1) {
        leg1.push({ x: start.x + (w.x - start.x) * (i / n), z: start.z + (w.z - start.z) * (i / n) });
      }
    }
    const leg2: Xz[] = [];
    {
      const n = Math.max(2, Math.ceil(d / SWEEP_SPACING_M));
      for (let i = 0; i <= n; i += 1) {
        leg2.push({ x: w.x + (target.x - w.x) * (i / n), z: w.z + (target.z - w.z) * (i / n) });
      }
    }
    const leg1Heading = Math.atan2(w.x - start.x, w.z - start.z);
    const cornerDeg = toDeg(Math.abs(wrapPi(targetFacing - leg1Heading)));
    candidateC2.push({
      waypointDM: d,
      cornerDeg,
      leg1Swept: sweepPath(leg1),
      leg2Swept: sweepPath(leg2),
    });
  }

  const report = {
    measuredAt: new Date().toISOString(),    route: {
      start, target,
      startHeadingDeg: toDeg(startHeading),
      targetFacingDeg: toDeg(targetFacing),
      requiredTurnDeg: toDeg(requiredTurn),
      chordLenM: chordLen,
      obstacleCount: obstacles.length,
      obstacleIds: obstacles.map((o) => o.id),
    },
    gait: {
      stepLengthM,
      walkSpeedMps,
      walkSeconds,
      clipPeriodMs: decoded.periodMs,
      phaseBudgetDeg: toDeg(SETTLING_CLIP_TURN_MAX_PHASE_RADIANS),
      rMinM,
    },
    priorArtArc: priorArt,
    candidateB: dubins,
    candidateC1: candidateC1,
    candidateC2: candidateC2,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
