import { type Object3D, Quaternion, Vector3 } from "three";
import type { FootBaseSide } from "./foot-base-schedule-mod.js";
import type { FootBaseApproachState, FootBaseState } from "./foot-base-state-mod.js";
import { heelWorldNow, seedFirstPlantAtTouchdown, toeWorldNow } from "./foot-base-state-mod.js";
import {
  findSteppingLegChain,
  heelTargetForToeTargetStable,
  type SteppingLegChain,
  solveSteppingLegHinge,
} from "./stepping-turn-leg-ik-mod.js";

/**
 * Split-stance final-handover pin (2-half short plans only; split out of
 * `./foot-base-stride-retarget-mod.js` to hold that file's 500-line zone
 * budget — same pattern as the state/schedule/route-gate splits. Not
 * re-exported from `./foot-base` (no new public symbol).
 *
 * Cause (measured per-substep taps, `.openclinxr/evidence/split-stance/`
 * measure.json): at the final handover the old-stance foot's hinge solve
 * reorients the hip/knee chain, so the foot's world direction no longer
 * matches the captured heel->toe offset — the heel reads ~1 mm while the
 * toe lands cm off (12.6 mm physician/0.8 m at substep 43). Re-solving
 * cannot converge this (each pass moves the heel by ~the error and
 * regenerates it; measured 0.44x per pass, oscillating). The sequential
 * pin then strands the last correction on the rendered in-window toe
 * (11.52 mm at frame 17), and the missM order key (3D heel residual,
 * height-dominated on fresh plants) does not predict the XZ correction.
 * The 1.31 m control carries the same latent residuals (15.65 mm) on
 * substeps the frame lattice never probes — pass/fail is probe-parity
 * luck — so the fix is gated to exactly-2-half plans and the control
 * keeps the miss-order single-pass path byte-identical.
 *
 * One mechanism in three parts, all gated on steps === 2: per-foot
 * capture→solve→ankle-restore→pin makes the captured offset exact by
 * construction (corrections ~0.1 mm); smallest-refined-last order strands
 * only the minimum residual on the earlier foot; the hold tolerance keeps
 * the converged co-stance toe pinned through the final double-support
 * (its target Y sits ~1 mm over the band while still rolling: measured
 * 0.0608 vs 0.06).
 */

export type SplitStancePin = { side: FootBaseSide; missM: number };

export type SplitStanceCorrection = SplitStancePin & { dx: number; dz: number };

/** Hold band for 2-half plans (+2 mm tolerance); the exact band otherwise. */
export function splitStanceHoldBandM(contactBandMeters: number, steps: number): number {
  return steps === 2 ? contactBandMeters + 0.002 : contactBandMeters;
}

/**
 * Counter-rotate the ankle (foot bone local) to restore the captured
 * foot-world direction after the hinge solve. Mixer orientation preserved;
 * hip/knee untouched; no iteration, slot fixed.
 */
export function restoreSplitStanceAnkle(
  chain: SteppingLegChain,
  capturedOffset: { x: number; y: number; z: number },
): void {
  const post = heelWorldNow(chain);
  const ox = capturedOffset.x;
  const oy = capturedOffset.y;
  const oz = capturedOffset.z;
  const px = post.toe.x - post.heel.x;
  const py = post.toe.y - post.heel.y;
  const pz = post.toe.z - post.heel.z;
  const ol = Math.hypot(ox, oy, oz);
  const pl = Math.hypot(px, py, pz);
  if (!(ol > 1e-9 && pl > 1e-9)) return;
  if ((ox * px + oy * py + oz * pz) / (ol * pl) >= 1 - 1e-9) return;
  const delta = new Quaternion().setFromUnitVectors(
    new Vector3(px / pl, py / pl, pz / pl),
    new Vector3(ox / ol, oy / ol, oz / ol),
  );
  const footW = chain.heel.getWorldQuaternion(new Quaternion());
  const parent = chain.heel.parent;
  if (parent === null) return;
  const parentW = parent.getWorldQuaternion(new Quaternion());
  chain.heel.quaternion.copy(parentW.invert().multiply(delta.multiply(footW)));
  chain.heel.updateMatrixWorld(true);
}

/**
 * Double-support pin pass. 2-half plans: pin the deepest actual foot last.
 * The slide meter windows maximal runs of consecutive frames by the
 * observe-only lock's stanceFoot with the toe in band — i.e. the foot
 * riding lowest — so the deepest post-first-solve toe is the metered foot
 * at (almost) every substep, and pinning it last renders it exactly on its
 * constant foothold. The one exception is lock lag at liftoff: the
 * band-hold reads lastToeY (one substep stale) and releases the trailing
 * foot while the lock still meters it (physician 0.85 m: released at
 * substep 43 with the toe at 0.055 m, unpinned solve drifts 11 mm on the
 * metered foot). The lock-lag hold re-pins the lock-named foot while its
 * CURRENT toe is in band and pins it last (it is the metered foot by
 * construction); flap-added feet only ever strand their translate on the
 * unmetered foot for that substep. Earlier feet carry only the last
 * translate, which is sub-mm wherever the refine converges. Fresh plants
 * arrive HIGH (child 0.8 m: 0.106 m, physician: 0.072 m) and settle as the refine converges,
 * so depth never pins a cm-correction foot last; the crossover to
 * deepest happens after convergence. Two earlier keys failed: target-Y
 * grade inverted (the lifting foot's plant-relative target reads in-band
 * while its actual toe rides 0.058 m, stranding 5.6 mm on the metered
 * foot at probed substep 14), and lock-stance order flapped (the
 * observe-only lock reads left at pin time while the frame records right
 * for the same substep). Depth is flap-immune (smooth actuals, no lock
 * read) and band-exact (pins are XZ-only, so post-solve Y is the metered
 * Y). Each foot is refined just before its own pin (fresh offset capture,
 * hinge re-solve, ankle restore); a refine that does not shrink the XZ
 * correction is reverted (bone poses + hinge normal + miss restored), so
 * no correction ever exceeds the single-pass baseline — at the reach edge
 * the re-solve can diverge from a mediocre first solve (13.4 mm refined
 * to 16.9 mm from the unmoved slot). Exact depth ties go
 * schedule-crown-last. Other plans: the untouched miss-order sort, single
 * pass, no refine. Applies the slot translates; returns the applied
 * corrections in pin order.
 */
export function runSplitStancePinPass(
  slot: Object3D,
  state: FootBaseState,
  approach: FootBaseApproachState,
  pinQueue: Array<SplitStancePin>,
  steps: number,
  pinTargetFor: (side: FootBaseSide) => { x: number; y: number; z: number },
): Array<SplitStanceCorrection> {
  // Lock-lag hold (2-half only): re-pin the lock-named foot while its
  // CURRENT post-first-solve toe is in band. Uses a local extended queue
  // (the caller's pinQueue is never mutated); the added foot pins last.
  let addedLockFoot: FootBaseSide | null = null;
  let queue: Array<SplitStancePin> = pinQueue;
  if (
    steps === 2 &&
    (approach.lock.stanceFoot === "left" || approach.lock.stanceFoot === "right") &&
    !pinQueue.some((e) => e.side === approach.lock.stanceFoot)
  ) {
    const lf = approach.lock.stanceFoot;
    const toeNow = toeWorldNow(lf === "left" ? approach.leftToe : approach.rightToe);
    if (toeNow !== null && toeNow.y <= approach.contactBandMeters) {
      queue = [...pinQueue, { side: lf, missM: 0 }];
      addedLockFoot = lf;
    }
  }
  const shortDouble = steps === 2 && queue.length >= 2;
  if (!shortDouble) queue.sort((a, b) => b.missM - a.missM);
  const yawNow = slot.rotation.y;
  const poleWorld = { x: Math.sin(yawNow), y: 0, z: Math.cos(yawNow) };
  // Depth order (2-half double support only): the deepest post-first-solve
  // toe pins last and renders exact. Depth is read here, before any refine
  // or pin moves anything, so all feet rank from the same slot. A null toe
  // reads +Infinity (shallowest, pins first; the pin phase skips it anyway).
  const depthY = new Map<FootBaseSide, number>();
  if (shortDouble) {
    for (const entry of queue) {
      const toeNow = toeWorldNow(entry.side === "left" ? approach.leftToe : approach.rightToe);
      depthY.set(entry.side, toeNow === null ? Number.POSITIVE_INFINITY : toeNow.y);
    }
  }
  // Deepest last (exact); the lock-lag-added foot always last (it is the
  // metered foot); exact ties go schedule-crown-last.
  const order: Array<SplitStancePin> = shortDouble
    ? [
        ...queue
          .filter((e) => e.side !== addedLockFoot)
          .sort((a, b) => {
            const depth = (depthY.get(b.side) ?? 0) - (depthY.get(a.side) ?? 0);
            if (depth !== 0) return depth;
            return (a.side === state.stance ? 1 : 0) - (b.side === state.stance ? 1 : 0);
          }),
        ...queue.filter((e) => e.side === addedLockFoot),
      ]
    : queue;
  const corrections: Array<SplitStanceCorrection> = [];
  for (const entry of order) {
    const side = entry.side;
    const toeBone = side === "left" ? approach.leftToe : approach.rightToe;
    const foothold = state.foothold[side];
    if (shortDouble) {
      // Refine just before this foot's own pin: fresh offset capture from
      // the current slot (which already carries earlier pins' translates),
      // hinge re-solve, ankle restore. A refine that does not shrink the
      // XZ correction is reverted (bone poses + hinge normal + miss
      // restored): at the reach edge the re-solve can diverge from a
      // mediocre first solve, and the ankle restore then levers the toe
      // further off. Revert keeps the best-available pose, so no
      // correction ever exceeds the single-pass baseline.
      const correctionMag = (): number => {
        const toeNow = toeWorldNow(toeBone);
        return toeNow === null
          ? Number.POSITIVE_INFINITY
          : Math.hypot(foothold.x - toeNow.x, foothold.z - toeNow.z);
      };
      const firstMag = correctionMag();
      const firstMissM = entry.missM;
      const chain = findSteppingLegChain(slot, side);
      if (chain !== null) {
        const savedQuats = [chain.hip, chain.upperMid, chain.knee, chain.lowerMid, chain.heel, chain.toe].map(
          (bone) => bone.quaternion.clone(),
        );
        const savedNormal = state.hingeNormal[side];
        const toeTarget = pinTargetFor(side);
        const ends = heelWorldNow(chain);
        const offset = {
          x: ends.toe.x - ends.heel.x,
          y: ends.toe.y - ends.heel.y,
          z: ends.toe.z - ends.heel.z,
        };
        const heelTarget = heelTargetForToeTargetStable({
          toeTargetWorld: toeTarget,
          slotYawRadians: yawNow,
          offsetEntry: offset,
          offsetYawRadians: yawNow,
        });
        const solved = solveSteppingLegHinge({
          chain,
          heelTargetWorld: heelTarget,
          poleWorld,
          midRestQuats: null,
          previousBendNormal: state.hingeNormal[side],
        });
        if (solved.bendNormal !== null) state.hingeNormal[side] = solved.bendNormal;
        entry.missM = solved.missM;
        restoreSplitStanceAnkle(chain, offset);
        if (correctionMag() > firstMag) {
          // Diverged: restore the first-solve pose (and its hinge normal
          // and miss, so diagnostics report the kept pose).
          const bones = [chain.hip, chain.upperMid, chain.knee, chain.lowerMid, chain.heel, chain.toe];
          savedQuats.forEach((quat, i) => bones[i]?.quaternion.copy(quat));
          state.hingeNormal[side] = savedNormal;
          entry.missM = firstMissM;
          slot.updateMatrixWorld(true);
        }
      }
    }
    // THE SLOT PIN: exact rigid translate of the pinned toe onto its foothold.
    const toeNow = toeWorldNow(side === "left" ? approach.leftToe : approach.rightToe);
    const anchor = state.foothold[side];
    if (toeNow !== null) {
      const dx = anchor.x - toeNow.x;
      const dz = anchor.z - toeNow.z;
      corrections.push({ side, missM: entry.missM, dx, dz });
      slot.position.x += dx;
      slot.position.z += dz;
      slot.updateMatrixWorld(true);
    }
  }
  return corrections;
}

/**
 * Post-solve pin-phase tail (moved verbatim out of
 * `./foot-base-stride-retarget-mod.js` to hold that file's 500-line zone
 * budget; behaviour is unchanged. Not re-exported from `./foot-base`, so no
 * new public symbol.
 *
 * Order is load-bearing and preserved exactly: the pin pass first, then the
 * first-plant seed and the band-hold signal (both read post-pin toes), then
 * the TEMP SPLIT-STANCE TAP record (its foothold snapshot must post-date the
 * seed). The tap itself is geometry-neutral: reads only, no slot/bone
 * writes.
 */
export function finishSplitStancePin(input: {
  slot: Object3D;
  state: FootBaseState;
  approach: FootBaseApproachState;
  pinQueue: Array<SplitStancePin>;
  steps: number;
  pinTargetFor: (side: FootBaseSide) => { x: number; y: number; z: number };
  sub: number;
  scheduled: FootBaseSide;
  stance: FootBaseSide;
  pinned: FootBaseSide[];
  swingMissM: number | null;
  unitX: number;
  unitZ: number;
  floorY: number;
}): void {
  const {
    slot, state, approach, pinQueue, steps, pinTargetFor,
    sub, scheduled, stance, pinned, swingMissM, unitX, unitZ, floorY,
  } = input;
  // TEMP SPLIT-STANCE TAP (measurement only, reverted before the fix
  // commit): geometry-neutral pin-mechanics read (post-solve, pre-pin).
  // Reads only, no slot/bone writes.
  const tapPrePin: Record<string, { x: number; y: number; z: number } | null> = {
    left: toeWorldNow(approach.leftToe),
    right: toeWorldNow(approach.rightToe),
  };
  const tapCorrections: Array<SplitStanceCorrection> = [];
  const pinTarget = (side: FootBaseSide) => pinTargetFor(side);
  for (const correction of runSplitStancePinPass(slot, state, approach, pinQueue, steps, pinTarget)) {
    // THE SLOT PIN is applied in the module; recorded here for the tap only.
    tapCorrections.push(correction);
  }
  // First-plant seed (handover slice): snap the provisional grid plant to the
  // actual touchdown once (gated at 1 mm; the miss is re-anchored next plant).
  seedFirstPlantAtTouchdown({
    state,
    stance,
    leftToe: approach.leftToe,
    rightToe: approach.rightToe,
    startX: approach.start.x,
    startZ: approach.start.z,
    unitX,
    unitZ,
    floorY,
    bandM: approach.contactBandMeters,
  });
  // Band-hold signal for the next substep (consumed one frame later).
  for (const side of ["left", "right"] as const) {
    const toe = toeWorldNow(side === "left" ? approach.leftToe : approach.rightToe);
    state.lastToeY[side] = toe?.y ?? null;
  }
  // TEMP SPLIT-STANCE TAP (measurement only): post-pin toe worlds.
  const tapHost = globalThis as unknown as { __openClinXrFootBaseTap?: unknown[] };
  if (!Array.isArray(tapHost.__openClinXrFootBaseTap)) tapHost.__openClinXrFootBaseTap = [];
  tapHost.__openClinXrFootBaseTap.push({
      sub,
      scheduled,
      stance,
      lockFoot: approach.lock.stanceFoot,
      pinned: [...pinned],
      foothold: {
        left: { ...state.foothold.left },
        right: { ...state.foothold.right },
      },
      prePin: tapPrePin,
      corrections: tapCorrections,
      postPin: {
        left: toeWorldNow(approach.leftToe),
        right: toeWorldNow(approach.rightToe),
      },
      swingMissM,
    });
}
