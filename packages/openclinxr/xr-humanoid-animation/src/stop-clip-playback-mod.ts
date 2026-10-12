import {
  SETTLING_FADE_SETTLE_SECONDS,
  SETTLING_LEG_WEIGHT_TARGET,
  type StopClipTrigger,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import { LoopOnce } from "three";
import type {
  CaseOwnedBedsideApproach,
} from "./case-owned-approach-runtime-mod.js";
import {
  type LocomotionStanceLabels,
  resolveLocomotionStanceLabels,
} from "./locomotion-stance-labels.js";
import {
  STOP_CROSSFADE_SECONDS,
  type StopClipWiring,
  resolveStopWiring,
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
 * The slice of the case-owned approach the stop mixer touches. Narrower than the full
 * approach type on purpose: `CaseOwnedBedsideApproach` carries a REMOVE disposition in the
 * frozen surface review and must not be republished, while headless tests still need a
 * named, admitted type to fabricate. The frame module passes the whole approach, which stays
 * assignable; every function in this module takes exactly this.
 */
export type StopClipPlaybackState = Pick<
  CaseOwnedBedsideApproach,
  | "stanceLabelSlot"
  | "stanceLabels"
  | "stopWiring"
  | "execution"
  | "lock"
  | "lockArmed"
  | "stopFired"
  | "stopSettleBlendT"
  | "travelHeadingRadians"
  | "clipCycleSeconds"
>;

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
  approach: StopClipPlaybackState,
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
 * The stopping lock's stance reading for this frame. Across the entry crossfade
 * (STOP_CROSSFADE_SECONDS) the pose is still mostly the walk take, so the lock reads the walk
 * labels; after the fade it reads the stop take's own labels at the distance-indexed clip
 * time. The mixer action's time is NOT read: the stop action is distance-driven (timeScale 0
 * with an explicit set per frame), and the headless assay poses markers without a stop
 * action at all — the executor's clip time is the single source in both paths.
 */
export function resolveStopStanceForFrame(
  approach: StopClipPlaybackState,
): { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined {
  const wiring = approach.stopWiring;
  if (!wiring) return undefined;
  const elapsedSeconds = approach.execution.stopElapsedSeconds ?? 0;
  if (elapsedSeconds < STOP_CROSSFADE_SECONDS) return resolveClipStanceForFrame(approach);
  const clipTimeS = approach.execution.stopClipTimeS ?? wiring.tEarliestS;
  return { labels: wiring.labels, actionTimeSeconds: clipTimeS };
}

/**
 * The baked-stop handoff input. The wiring is measured once per actor from its own bound stop
 * take (null while the actor carries none, which keeps the legacy ending). No stance gate, no
 * rate steering: the executor engages as soon as remaining fits inside the R range, with the
 * clip time derived from remaining. Resolved while walking AND while stopping: the executor
 * needs the trigger config on every stopping frame, not just the entry.
 */
export function resolveStopTriggerInput(approach: StopClipPlaybackState): {
  stop: StopClipTrigger | null;
} {
  const phase = approach.execution.phase;
  if (phase !== "walking" && phase !== "stopping") {
    return { stop: null };
  }
  if (approach.stopWiring === undefined) {
    approach.stopWiring = resolveStopWiring({
      labelSlot: approach.stanceLabelSlot,
      travelHeadingRadians: approach.travelHeadingRadians,
      cycleSeconds: approach.clipCycleSeconds,
    });
  }
  const wiring: StopClipWiring | null | undefined = approach.stopWiring;
  if (wiring === null || wiring === undefined) return { stop: null };
  return {
    stop: {
      clipName: wiring.clipName,
      durationSeconds: wiring.durationSeconds,
      rootTrackXz: wiring.rootTrackXz,
      routeYawRadians: wiring.routeYawRadians,
      distCurve: wiring.distCurve,
      tEarliestS: wiring.tEarliestS,
      rMaxM: wiring.rMaxM,
      rDecelM: wiring.rDecelM,
      decelOnsetS: wiring.decelOnsetS,
      holdOnsetS: wiring.holdOnsetS,
    },
  };
}

function stopMixerAction(approach: StopClipPlaybackState) {
  const slot = approach.stanceLabelSlot;
  const wiring = approach.stopWiring;
  if (slot?.mixer === undefined || !wiring) return null;
  return slot.mixer.existingAction(wiring.noRootClip);
}

function walkMixerAction(approach: StopClipPlaybackState) {
  const slot = approach.stanceLabelSlot;
  if (slot?.mixer === undefined) return null;
  const clipName = slot.locomotionClipName;
  const clip = clipName ? slot.responseClips?.find((candidate) => candidate.name === clipName) : undefined;
  return clip ? slot.mixer.existingAction(clip) : null;
}

/**
 * Stopping entry: play the root-removed stop take from the entry time at weight 0 and claim the
 * mixer. The action is DISTANCE-DRIVEN (timeScale 0 with an explicit time set every stopping
 * frame from the executor's clip time), so the mixer never integrates it past the pose the
 * remaining distance prescribes; the walk take keeps advancing at its own loop rate through
 * the crossfade, and both poses morph across STOP_CROSSFADE_SECONDS. The consumer skips its
 * own walk playback while the flag is set; the walk take itself is never stopped, so its time
 * stays continuous for the settling turn. The walk-phase chain claim stays in place through
 * the handoff: the same locomotion owner keeps driving the legs.
 */
export function startStopClipPlayback(approach: StopClipPlaybackState, entryTimeS: number): void {
  const slot = approach.stanceLabelSlot;
  const wiring = approach.stopWiring;
  if (slot?.mixer === undefined || !wiring) return;
  const action = slot.mixer.clipAction(wiring.noRootClip);
  action.reset();
  action.time = entryTimeS;
  // Distance-driven: the per-frame set below owns the time, so the mixer's own integration
  // must not also advance it (that double advance is what walked the pose off the slot).
  action.timeScale = 0;
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

export function blendStopClipPlayback(approach: StopClipPlaybackState, elapsedSeconds: number): void {
  const weight = Math.min(1, elapsedSeconds / STOP_CROSSFADE_SECONDS);
  const stopAction = stopMixerAction(approach);
  // Distance drive: the pose follows the remaining distance, set explicitly every frame.
  const clipTimeS = approach.execution.stopClipTimeS ?? approach.stopWiring?.tEarliestS ?? 0;
  if (stopAction) {
    stopAction.time = Math.min(clipTimeS, approach.stopWiring?.durationSeconds ?? clipTimeS);
    stopAction.setEffectiveWeight(weight);
  }
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
  approach: StopClipPlaybackState,
  previousPhase: string,
  deltaSeconds: number,
  fired: { trigger: StopClipTrigger } | null,
): void {
  const phase = approach.execution.phase;
  if (previousPhase !== "stopping" && phase === "stopping") {
    // First stopping frame's pose predates the stop take (same discipline as the walk start):
    // re-anchor the lock and disarm for one frame rather than reading the pose change as slide.
    approach.lock = createStanceLockState();
    approach.lockArmed = false;
    const entryTimeS = approach.execution.stopClipTimeS ?? approach.stopWiring?.tEarliestS ?? 0;
    startStopClipPlayback(approach, entryTimeS);
    if (fired) {
      approach.stopFired = {
        t0S: entryTimeS,
        rMaxM: fired.trigger.rMaxM,
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
export function teardownStopClipPlayback(approach: StopClipPlaybackState): void {
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
export function beginStopSettleBlend(approach: StopClipPlaybackState): void {
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
export function updateStopSettleBlend(approach: StopClipPlaybackState, deltaSeconds: number): void {
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
