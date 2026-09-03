/**
 * THE CONTACT-WINDOW SCHEDULE — where `ContactConstraint` windows become key times.
 *
 * Issue #0 (contact windows vs the real-rig guard). `ContactConstraint` was declared in
 * `motion-program.ts` and carried by every guard fixture, but no primitive ever READ it: the
 * guard's 3-keyframe reach-and-settle holds its peak at a single key, so between the peak and the
 * settle the interpolated effector drifts off the contact. This module is the enforcement half of
 * the contact solver — it decides WHEN the driven effector must be at WHICH contact point, and it
 * REFUSES programs no single pose can satisfy. The pose geometry (arm solve per point, bind-frame
 * anchors) stays in the calling primitive; this module is deliberately free of rigs, chains and
 * quaternions so the window logic is owned once and testable without a skeleton.
 *
 * THE MODEL — precedence by `preserveWhileActive`, not by authoring order.
 *
 * A preserved contact (`preserveWhileActive: true`) is a HARD requirement for its window: the
 * effector must be within tolerance of that point at every instant of the window, so a competing
 * objective that would drag it away must yield. A releasable contact (`false`) PERMITS release —
 * it holds while no harder objective claims the effector, and yields where one does. The clip is
 * partitioned at every window boundary into maximal runs with one winning objective; inside a run
 * the effector holds that objective's point; between runs it travels. This is what makes the flag
 * observable: a fixture with two contacts 0.21 m apart and OVERLAPPING windows is satisfiable only
 * when the harder one wins the overlap, and is refused when both are preserved.
 *
 * REFUSALS (never a silent pick):
 *   - two preserved contacts whose points no one pose can satisfy within BOTH tolerances, in an
 *     overlap, throw — the compiler must not invent a precedence nobody authored;
 *   - two preserved contacts at different points with abutting windows throw the same way — the
 *     hand cannot hold the first until its window closes and be on the second at the same instant;
 *   - a window whose fractions are empty or out of [0, 1] throws.
 *
 * RELEASABLE YIELD HEADROOM: where a preserved window begins inside a releasable one at a
 * different point, the releasable hold must end early enough for the hand to arrive on time — a
 * linear interpolation cannot be at two points at once. The releasable run is truncated by
 * `YIELD_FRACTION` of the clip (0.04) before the preserved window's start; the yield is
 * deterministic and carries no velocity claim.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, production_animation_quality,
 * exam_equivalence, scoring, learner_readiness.
 */

export type ContactPoint = { x: number; y: number; z: number };

/** One parsed contact window, with everything the schedule decision needs and nothing else. */
export type ContactWindowInput = {
  startFraction: number;
  endFraction: number;
  /** The satisfiability yardstick: two points are one pose only within the SUM of their tolerances. */
  positionToleranceMeters: number;
  /** `preserveWhileActive` — hard requirements beat releasable ones in any overlap. */
  preserveWhileActive: boolean;
  /** Bind-frame metres, resolved by the caller against the rig's region anchors. */
  point: ContactPoint;
  /** Declaration order — the deterministic tie-break among equal-priority windows. */
  order: number;
};

/**
 * Which pose a scheduled key asks the caller to emit.
 *   - `bind`: the rig's rest pose (the effector starts and finishes away from every contact).
 *   - `point`: the solved pose that satisfies the referenced window's contact point.
 *   - `settle`: the relaxation pose the caller scales from its last emitted point pose.
 */
export type ContactKeyPose =
  | { kind: "bind" }
  | { kind: "point"; window: number }
  | { kind: "settle" };

export type ContactKey = { fraction: number; pose: ContactKeyPose };

/** Releasable hold truncated by this fraction of the clip before a preserved window it must yield to. */
export const CONTACT_YIELD_FRACTION = 0.04;

const EPS = 1e-9;

function distance3(a: ContactPoint, b: ContactPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function assertFinitePoint(point: ContactPoint, at: string): void {
  if (![point.x, point.y, point.z].every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error(`planContactWindowKeys: ${at} carries a non-finite contact point`);
  }
}

type Segment = { start: number; end: number; window: number | null; hard: boolean };
type Phase = { start: number; end: number; window: number | null; hard: boolean };

function samePoint(a: ContactWindowInput, b: ContactWindowInput): boolean {
  return distance3(a.point, b.point) <= EPS;
}

/**
 * Plan the effector's key schedule from the action's contact windows.
 *
 * Returns strictly increasing key fractions in [0, 1]. Throws when the windows are unbuildable —
 * see the module header for the refusal conditions. The caller multiplies the fractions by the
 * clip duration and resolves each `ContactKeyPose` to rotations on its own rig.
 */
export function planContactWindowKeys(windows: readonly ContactWindowInput[]): ContactKey[] {
  if (windows.length === 0) {
    throw new Error("planContactWindowKeys: no contact windows to schedule");
  }
  for (const [i, w] of windows.entries()) {
    const at = `window ${i}`;
    if (!Number.isFinite(w.startFraction) || !Number.isFinite(w.endFraction)) {
      throw new Error(`planContactWindowKeys: ${at} carries a non-finite fraction`);
    }
    if (w.startFraction < 0 || w.startFraction > 1 || w.endFraction < 0 || w.endFraction > 1) {
      throw new Error(`planContactWindowKeys: ${at} fraction outside [0, 1] (${w.startFraction}..${w.endFraction})`);
    }
    if (!(w.endFraction > w.startFraction)) {
      throw new Error(`planContactWindowKeys: ${at} window is empty (${w.startFraction}..${w.endFraction})`);
    }
    if (!Number.isFinite(w.positionToleranceMeters) || w.positionToleranceMeters < 0) {
      throw new Error(`planContactWindowKeys: ${at} positionToleranceMeters must be a non-negative finite number`);
    }
    assertFinitePoint(w.point, at);
  }

  // ── segment partition: every maximal open interval between window boundaries has one winner ──
  const boundarySet = new Set<number>([0, 1]);
  for (const w of windows) {
    boundarySet.add(w.startFraction);
    boundarySet.add(w.endFraction);
  }
  const bounds = [...boundarySet].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const start = bounds[i]!;
    const end = bounds[i + 1]!;
    if (end - start <= EPS) continue;

    const active = windows
      .map((w, idx) => ({ w, idx }))
      .filter(({ w }) => w.startFraction <= start + EPS && w.endFraction >= end - EPS);
    const hardActive = active.filter(({ w }) => w.preserveWhileActive);
    const candidates = hardActive.length > 0 ? hardActive : active;

    if (candidates.length === 0) {
      segments.push({ start, end, window: null, hard: false });
      continue;
    }

    // One pose can satisfy every WINNING window only when each pair sits within the sum of the
    // pair's tolerances. A pair beyond that is unbuildable — refusing beats picking a winner.
    for (let a = 0; a < candidates.length; a += 1) {
      for (let b = a + 1; b < candidates.length; b += 1) {
        const pa = candidates[a]!.w;
        const pb = candidates[b]!.w;
        const apart = distance3(pa.point, pb.point);
        const room = pa.positionToleranceMeters + pb.positionToleranceMeters;
        if (apart > room + EPS) {
          const kind = hardActive.length > 0 ? "preserved" : "active";
          throw new Error(
            `planContactWindowKeys: two ${kind} contacts claim the effector in [${start.toFixed(3)}, ${end.toFixed(3)}] ` +
              `but their points are ${apart.toFixed(3)} m apart against ${room.toFixed(3)} m of combined tolerance — ` +
              `no single pose satisfies both; the program is unbuildable`,
          );
        }
      }
    }

    const winner = candidates.reduce((best, cur) => {
      const startsEarlier = cur.w.startFraction < best.w.startFraction - EPS;
      const sameStartEarlierOrder =
        Math.abs(cur.w.startFraction - best.w.startFraction) <= EPS && cur.idx < best.idx;
      return startsEarlier || sameStartEarlierOrder ? cur : best;
    });
    segments.push({ start, end, window: winner.idx, hard: candidates.some((c) => c.w.preserveWhileActive) });
  }

  // ── merge: adjacent segments with the same winning POINT (or both travel) are one run ──
  const phases: Phase[] = [];
  for (const seg of segments) {
    const last = phases[phases.length - 1];
    if (last !== undefined && last.window !== null && seg.window !== null && samePoint(windows[last.window]!, windows[seg.window]!)) {
      last.end = seg.end;
      last.hard = last.hard || seg.hard;
      continue;
    }
    if (last !== undefined && last.window === null && seg.window === null) {
      last.end = seg.end;
      continue;
    }
    phases.push({ ...seg });
  }

  // ── zero-gap handoffs between DIFFERENT points: truncate the releasable side ──
  for (let i = 0; i + 1 < phases.length; i += 1) {
    const prev = phases[i]!;
    const next = phases[i + 1]!;
    if (prev.window === null || next.window === null) continue;
    const gap = next.start - prev.end;
    if (gap > EPS) continue; // a travel gap exists — the hand moves in it
    if (samePoint(windows[prev.window]!, windows[next.window]!)) continue; // no transition needed

    if (prev.hard && next.hard) {
      throw new Error(
        `planContactWindowKeys: preserved contacts at different points abut at ${prev.end.toFixed(3)} ` +
          `with no travel room — the hand cannot hold the first until its window closes and be on the second at the same instant`,
      );
    }
    if (prev.hard) {
      // The earlier hold is a hard requirement; the LATER (releasable) run yields its start.
      next.start = Math.min(next.end, next.start + CONTACT_YIELD_FRACTION);
    } else {
      // The earlier (releasable) run yields its end so the hand arrives at the next point on time.
      prev.end = Math.max(prev.start, prev.end - CONTACT_YIELD_FRACTION);
    }
  }

  // ── emit keys: every demand run gets identical pose keys across its whole width ──
  const keys: ContactKey[] = [];
  const push = (fraction: number, pose: ContactKeyPose): void => {
    const last = keys[keys.length - 1];
    if (last !== undefined && last.fraction > fraction + EPS) {
      throw new Error(`planContactWindowKeys: schedule produced a non-increasing key time (${last.fraction} -> ${fraction})`);
    }
    if (last !== undefined && Math.abs(last.fraction - fraction) <= EPS) {
      if (last.pose.kind === pose.kind && last.pose.kind !== "point") return; // identical — nothing to add
      if (last.pose.kind === "point" && pose.kind === "point" && last.pose.window === pose.window) return;
      throw new Error(
        `planContactWindowKeys: schedule produced two different poses at fraction ${fraction.toFixed(3)} — the hand cannot be in two places`,
      );
    }
    keys.push({ fraction, pose });
  };

  const firstDemand = phases.find((p) => p.window !== null);
  if (firstDemand !== undefined && firstDemand.start <= EPS) {
    push(0, { kind: "point", window: firstDemand.window as number });
  } else {
    push(0, { kind: "bind" });
  }

  for (const phase of phases) {
    if (phase.window === null) continue; // travel — the neighbouring demand keys bound it
    if (phase.end - phase.start <= EPS) continue; // truncated away — nothing can be held
    push(phase.start, { kind: "point", window: phase.window });
    push(phase.end, { kind: "point", window: phase.window });
  }

  const lastKey = keys[keys.length - 1]!;
  if (lastKey.fraction < 1 - EPS) {
    push(1, { kind: "settle" });
  }
  return keys;
}
