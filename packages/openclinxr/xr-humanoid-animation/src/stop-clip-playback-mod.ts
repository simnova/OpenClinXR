import {
  SETTLING_FADE_SETTLE_SECONDS,
  SETTLING_LEG_WEIGHT_TARGET,
  type StopClipFoot,
  type StopClipTrigger,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { LoopOnce } from "three";
import type {
  CaseOwnedBedsideApproach,
} from "./case-owned-approach-runtime-mod.js";
import {
  type LocomotionStanceLabels,
  pairRunStarts,
  resolveLocomotionStanceLabels,
  stanceAtTime,
} from "./locomotion-stance-labels.js";
import {
  STOP_CROSSFADE_SECONDS,
  type StopClipWiring,
  resolveStopWiring,
  spanStraightDeviationM,
} from "./stop-clip-wiring-mod.js";
import { createStanceLockState } from "./stance-lock-mod.js";

/**
 * Stop-take playback for the case-owned approach, split out of
 * `case-owned-approach-frame-mod.ts` to keep that file's 500-line budget. The frame module owns
 * the phase transitions; this module owns the stop mixer and the handoff inputs.
 */

/** userData flag telling the animation loop the frame module owns the mixer this phase. */
export const STOP_PLAYING_FLAG = "openClinXrStopClipPlaying";

/**
 * The walk clip's stance reading for this frame. Resolved lazily and cached on the approach the
 * first frame either the walking lock or the stop trigger needs it.
 *
 * RESOLVES AT THE SOURCE (moved here from the frame module with its contract intact).
 * Previously the caller had to have populated `approach.stanceLabels` itself; any other consumer
 * of the shared approach that populated `stanceLabelSlot` without that separate call got null
 * labels forever and the settling turn never closed. Every caller supplying a real slot gets
 * labels for free on first use; the userData cache makes repeat calls a read, not a measurement.
 */
export function resolveClipStanceForFrame(
  approach: CaseOwnedBedsideApproach,
): { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined {
  const stanceSlot = approach.stanceLabelSlot;
  if (stanceSlot === null || stanceSlot.mixer === undefined) return undefined;
  const labels = approach.stanceLabels ?? resolveLocomotionStanceLabels(stanceSlot);
  if (labels === null) return undefined;
  approach.stanceLabels = labels;
  const clipName = stanceSlot.locomotionClipName;
  const clip = clipName ? stanceSlot.responseClips?.find((candidate) => candidate.name === clipName) : undefined;
  const action = clip && stanceSlot.mixer ? stanceSlot.mixer.existingAction(clip) : null;
  return action ? { labels, actionTimeSeconds: action.time } : undefined;
}

/**
 * The stop take's stance reading for this frame: the wiring's own labels at the played clip
 * time (entry offset plus executor elapsed). The mixer action's time is NOT read: both actions
 * advance one dt per frame at rate 1 through the handoff, so the executor's elapsed time and
 * the playing action agree, and the headless assay (which poses markers without advancing a
 * stop action) reads the same value.
 */
export function resolveStopStanceForFrame(
  approach: CaseOwnedBedsideApproach,
): { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined {
  const wiring = approach.stopWiring;
  if (!wiring) return undefined;
  const elapsedSeconds = approach.execution.stopElapsedSeconds ?? 0;
  return { labels: wiring.labels, actionTimeSeconds: wiring.entryTimeS + elapsedSeconds };
}

/**
 * Distance-matching rate bounds. Both directions stay available, but steering applies ONLY
 * when the computed factor lands inside them (actionable meeting); otherwise the walk coasts
 * at unity and the legacy ending runs byte-identical. Rationale, measured across four law
 * variants on the assay: unconditional clamp-steering from frame 0 reshuffles alignments
 * (physician miss becomes hit, nurse hit becomes miss with a harmed path), and slow-only
 * collapses to 1/3 engagement — while coast-when-out engages wherever alignment permits with
 * zero harm otherwise. Guaranteed engagement is out of reach regardless (see the write-up:
 * sub-cycle trigger window, exact-pair gate, straight-only usable spans, bounded authority).
 */
const MATCH_RATE_MIN = 0.8;
const MATCH_RATE_MAX = 1.2;

/**
 * Action-time until the walk loop next reads the given stance pair: the next window start
 * strictly after now (run-length filtered against calibration speckle). Null when the pair
 * never occurs. The caller divides by the base (unsteered) rate for wall seconds, so the
 * factor never feeds back into its own measurement.
 */
export function actionTimeToStancePair(
  labels: LocomotionStanceLabels,
  fromActionTimeS: number,
  cycleS: number,
  pair: { left: boolean; right: boolean },
): number | null {
  if (!(cycleS > 0)) return null;
  const wrappedFrom = ((fromActionTimeS % cycleS) + cycleS) % cycleS;
  const starts = pairRunStarts(labels, pair, 3);
  for (const start of starts) {
    if (start > wrappedFrom) return start - wrappedFrom;
  }
  if (starts.length === 0) return null;
  return starts[0]! + cycleS - wrappedFrom;
}

/**
 * Distance matching (per-approach): on the final leg, steer the SLOT rate so the entry stance
 * phase lands at the trigger distance. The clip rate stays constant (the drive carries no
 * factor), so walk phase free-runs while the slot hurries or drags — that relative motion is
 * what moves the meeting; scaling both sides together would freeze it. Recomputed every frame
 * until the trigger. Outside the one-cycle window, or when no candidate fits, the default
 * (latest-entry) trigger applies unsteered, preserving long-route behavior. Earlier entry
 * candidates compete only when the default would clamp, and only when fireable (D within
 * remaining, so firing cannot overshoot by construction) and straight (span deviation within
 * 0.1 m — a veering span maps laterally into the route and the stance pin eats the advance,
 * measured 1.4 m swallowed on the nurse).
 */
function resolveMatchedTrigger(
  approach: CaseOwnedBedsideApproach,
  wiring: NonNullable<CaseOwnedBedsideApproach["stopWiring"]>,
  walkStance: { left: boolean; right: boolean } | null,
  actionTimeS: number | null,
): { stop: StopClipTrigger; speedFactor: number } | null {
  const remaining = approach.execution.routeLengthMeters - approach.execution.travelledMeters;
  const v = approach.walkSpeedMetersPerSecond;
  const cycle = approach.clipCycleSeconds;
  if (!(v > 0) || !(cycle > 0)) return null;
  const windowM = v * cycle;
  if (remaining > wiring.displacementMeters + windowM) return null;
  // The clip rate is never steered (slot-only matching), so the live walk rate is clean.
  const walkAction = walkMixerAction(approach);
  const baseRate = walkAction?.timeScale && walkAction.timeScale > 0 ? walkAction.timeScale : 1;
  const walkLabels = approach.stanceLabels;
  const actionTime = actionTimeS;
  const rawS = (displacementM: number, pair: { left: boolean; right: boolean }): number | null => {
    if (walkLabels === null || walkLabels === undefined || actionTime === null) return null;
    const dtAction = actionTimeToStancePair(walkLabels, actionTime, cycle, pair);
    if (dtAction === null || dtAction <= 0) return null;
    return (remaining - displacementM) / (v * (dtAction / baseRate));
  };
  const defaultRaw = rawS(wiring.displacementMeters, wiring.entryStance);
  const inBounds = (s: number | null): s is number => s !== null && s >= MATCH_RATE_MIN && s <= MATCH_RATE_MAX;
  const buildTrigger = (t0S: number, entryStance: StopClipFoot, displacementM: number): StopClipTrigger => ({
    clipName: wiring.clipName,
    displacementMeters: displacementM,
    durationSeconds: wiring.durationSeconds,
    entryStance,
    entryTimeS: t0S,
    rootTrackXz: wiring.rootTrackXz,
    routeYawRadians: wiring.routeYawRadians,
  });
  if (inBounds(defaultRaw)) {
    return {
      stop: buildTrigger(wiring.entryTimeS, wiring.entryStance, wiring.displacementMeters),
      speedFactor: defaultRaw,
    };
  }
  // Default would clamp: earlier entries compete, fireable and straight only; the winner
  // applies only when in bounds. Otherwise coast at unity (default trigger, unsteered) so an
  // un-actionable frame leaves the legacy trajectory untouched.
  type Candidate = { t0S: number; entryStance: StopClipFoot; displacementMeters: number };
  let best: { candidate: Candidate; rawS: number } | null = null;
  for (const candidate of wiring.entryCandidates) {
    if (candidate.displacementMeters > remaining) continue;
    if (spanStraightDeviationM(wiring.rootTrackXz, candidate.t0S) > 0.1) continue;
    if (candidate.t0S === wiring.entryTimeS && candidate.displacementMeters === wiring.displacementMeters) continue;
    const s = rawS(candidate.displacementMeters, candidate.entryStance);
    if (s === null) continue;
    if (best === null || Math.abs(s - 1) < Math.abs(best.rawS - 1)) {
      best = { candidate, rawS: s };
    }
  }
  if (best !== null && inBounds(best.rawS)) {
    return {
      stop: buildTrigger(best.candidate.t0S, best.candidate.entryStance, best.candidate.displacementMeters),
      speedFactor: best.rawS,
    };
  }
  return {
    stop: buildTrigger(wiring.entryTimeS, wiring.entryStance, wiring.displacementMeters),
    speedFactor: 1,
  };
}

/**
 * The baked-stop handoff inputs. The wiring is measured once per actor from its own bound stop
 * take (null while the actor carries none, which keeps the legacy ending); the walk stance is
 * this frame's label reading off the playing walk action. Resolved while walking AND while
 * stopping: the executor needs the trigger config on every stopping frame, not just the entry.
 * While walking inside the matching window the trigger comes from distance matching (steered
 * rate plus winning entry candidate) instead of the default latest entry.
 */
export function resolveStopTriggerInput(approach: CaseOwnedBedsideApproach): {
  stop: StopClipTrigger | null;
  walkStance: { left: boolean; right: boolean } | null;
  speedFactor: number;
} {
  const phase = approach.execution.phase;
  if (phase !== "walking" && phase !== "stopping") {
    return { stop: null, walkStance: null, speedFactor: 1 };
  }
  if (approach.stopWiring === undefined) {
    approach.stopWiring = resolveStopWiring({
      labelSlot: approach.stanceLabelSlot,
      travelHeadingRadians: approach.travelHeadingRadians,
    });
  }
  const wiring = approach.stopWiring;
  if (wiring === null || wiring === undefined) return { stop: null, walkStance: null, speedFactor: 1 };
  const stance = phase === "walking" ? resolveClipStanceForFrame(approach) : undefined;
  const walkStance = stance ? stanceAtTime(stance.labels, stance.actionTimeSeconds) : null;
  if (phase === "walking") {
    const matched = resolveMatchedTrigger(
      approach,
      wiring,
      walkStance,
      stance ? stance.actionTimeSeconds : null,
    );
    if (matched) return { ...matched, walkStance };
  }
  return {
    stop: {
      clipName: wiring.clipName,
      displacementMeters: wiring.displacementMeters,
      durationSeconds: wiring.durationSeconds,
      entryStance: wiring.entryStance,
      entryTimeS: wiring.entryTimeS,
      rootTrackXz: wiring.rootTrackXz,
      routeYawRadians: wiring.routeYawRadians,
    },
    walkStance,
    speedFactor: 1,
  };
}

function stopMixerAction(approach: CaseOwnedBedsideApproach) {
  const slot = approach.stanceLabelSlot;
  const wiring = approach.stopWiring;
  if (slot?.mixer === undefined || !wiring) return null;
  return slot.mixer.existingAction(wiring.noRootClip);
}

function walkMixerAction(approach: CaseOwnedBedsideApproach) {
  const slot = approach.stanceLabelSlot;
  if (slot?.mixer === undefined) return null;
  const clipName = slot.locomotionClipName;
  const clip = clipName ? slot.responseClips?.find((candidate) => candidate.name === clipName) : undefined;
  return clip ? slot.mixer.existingAction(clip) : null;
}

/**
 * Stopping entry: play the root-removed stop take from the entry time at weight 0 and claim the
 * mixer. The consumer skips its own walk playback while the flag is set; the per-frame blend
 * below raises the stop weight while lowering the walk weight across STOP_CROSSFADE_SECONDS
 * (the walk take itself is never stopped, so its time stays continuous for the settling turn).
 * The walk-phase chain claim stays in place through the handoff:
 * the same locomotion owner keeps driving the legs.
 */
export function startStopClipPlayback(approach: CaseOwnedBedsideApproach): void {
  const slot = approach.stanceLabelSlot;
  const wiring = approach.stopWiring;
  if (slot?.mixer === undefined || !wiring) return;
  const action = slot.mixer.clipAction(wiring.noRootClip);
  action.reset();
  action.time = wiring.entryTimeS;
  action.timeScale = 1;
  // One shot, clamped at the hold: the default LoopRepeat wraps past the end back into the
  // take's opening walk, and the settle-blend would morph (and the stance lock would read)
  // looped walk poses instead of the hold (measured: stop time wrapped 5.46 -> 0.0x on the
  // nurse while the blend faded it in).
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.setEffectiveWeight(0);
  action.play();
  (slot.root.userData as Record<string, unknown>)[STOP_PLAYING_FLAG] = true;
}

export function blendStopClipPlayback(approach: CaseOwnedBedsideApproach, elapsedSeconds: number): void {
  const weight = Math.min(1, elapsedSeconds / STOP_CROSSFADE_SECONDS);
  const stopAction = stopMixerAction(approach);
  if (stopAction) stopAction.setEffectiveWeight(weight);
  const walkAction = walkMixerAction(approach);
  // The walk take is only faded, never stopped: its time stays continuous through the handoff
  // so the settling turn reads unbroken walk phase afterwards.
  if (walkAction) walkAction.setEffectiveWeight(1 - weight);
}

/**
 * Per-frame stop mixer management, called after the executor step with the previous phase:
 * stopping entry (fresh lock, stop take from the entry time), crossfade, exits, and the
 * stopping-to-settling settle-blend with its per-frame advance.
 */
export function updateStopPlayback(
  approach: CaseOwnedBedsideApproach,
  previousPhase: string,
  deltaSeconds: number,
  fired: { trigger: StopClipTrigger; speedFactor: number } | null,
): void {
  const phase = approach.execution.phase;
  if (previousPhase !== "stopping" && phase === "stopping") {
    // First stopping frame's pose predates the stop take (same discipline as the walk start):
    // re-anchor the lock and disarm for one frame rather than reading the pose change as slide.
    approach.lock = createStanceLockState();
    approach.lockArmed = false;
    startStopClipPlayback(approach);
    if (fired) {
      approach.stopFired = {
        displacementMeters: fired.trigger.displacementMeters,
        entryTimeS: fired.trigger.entryTimeS ?? 0,
        entryStance: { ...fired.trigger.entryStance },
        speedFactor: fired.speedFactor,
      };
    }
  } else if (phase === "stopping") {
    approach.lockArmed = true;
    blendStopClipPlayback(approach, approach.execution.stopElapsedSeconds ?? 0);
  }
  if (previousPhase === "stopping" && phase === "settling") {
    beginStopSettleBlend(approach);
  } else if (previousPhase === "stopping" && phase !== "stopping") {
    teardownStopClipPlayback(approach);
  }
  if (phase === "settling") {
    updateStopSettleBlend(approach, deltaSeconds);
  }
}

/** Any exit from stopping: park the stop action and hand the mixer back to the consumer. */
export function teardownStopClipPlayback(approach: CaseOwnedBedsideApproach): void {
  const stopAction = stopMixerAction(approach);
  if (stopAction) {
    stopAction.setEffectiveWeight(0);
    stopAction.stop();
  }
  const slot = approach.stanceLabelSlot;
  if (slot) delete (slot.root.userData as Record<string, unknown>)[STOP_PLAYING_FLAG];
  approach.stopSettleBlendT = null;
}

/**
 * Stopping-to-settling entry: grow the settle-blend over the fade window. The walk take is
 * already running (silenced, phase-continuous through the stop — see the blend above), so it
 * is only (re)started here as a defensive fallback; the seed drops its weight to zero and the
 * blend below grows it back to the settling weight while the stop take fades out. The consumer
 * stands down until the blend ends (flag stays set) and resumes from the synced ramp. The walk
 * clip's frame 0 is its symmetric rest frame, so even the fallback opens near standing.
 */
export function beginStopSettleBlend(approach: CaseOwnedBedsideApproach): void {
  const slot = approach.stanceLabelSlot;
  if (slot?.mixer === undefined) return;
  const walkAction = walkMixerAction(approach);
  if (walkAction && !walkAction.isRunning()) {
    walkAction.reset();
    walkAction.play();
  }
  // Seed the consumer's ramp at zero (its key, owned by locomotion-clip-playback-mod): without
  // the seed the consumer's first settling frame snaps the restarted take to full weight — and
  // on the drive-zero entry frame it stops the take outright.
  (slot.root.userData as Record<string, unknown>)["openClinXrLocomotionLegWeight"] = { current: 0 };
  approach.stopSettleBlendT = 0;
}

/**
 * One settling frame of the settle-blend. After the window the stop action parks, the flag
 * clears with the consumer's ramp synced to the blend end, and the consumer owns the mixer
 * again. Any exit from settling mid-blend finishes immediately.
 */
export function updateStopSettleBlend(approach: CaseOwnedBedsideApproach, deltaSeconds: number): void {
  const started = approach.stopSettleBlendT;
  if (started === null || started === undefined) return;
  if (approach.execution.phase !== "settling") {
    teardownStopClipPlayback(approach);
    return;
  }
  const t = started + deltaSeconds;
  const u = Math.min(1, t / SETTLING_FADE_SETTLE_SECONDS);
  const stopAction = stopMixerAction(approach);
  if (stopAction) stopAction.setEffectiveWeight(1 - u);
  const walkAction = walkMixerAction(approach);
  if (walkAction) walkAction.setEffectiveWeight(SETTLING_LEG_WEIGHT_TARGET * u);
  if (u >= 1) {
    const slot = approach.stanceLabelSlot;
    if (slot) {
      // Sync the consumer's ramp to the blend end: its first post-blend frame continues at the
      // settling leg weight instead of dipping back to the seed.
      (slot.root.userData as Record<string, unknown>)["openClinXrLocomotionLegWeight"] = {
        current: SETTLING_LEG_WEIGHT_TARGET,
      };
    }
    teardownStopClipPlayback(approach);
    return;
  }
  approach.stopSettleBlendT = t;
}
