import type {
  StopClipTrigger,
} from "@openclinxr/xr-runtime-state/bedside-approach-execution";
import type {
  CaseOwnedBedsideApproach,
} from "./case-owned-approach-runtime-mod.js";
import {
  type LocomotionStanceLabels,
  resolveLocomotionStanceLabels,
  stanceAtTime,
} from "./locomotion-stance-labels.js";
import {
  STOP_CROSSFADE_SECONDS,
  resolveStopWiring,
} from "./stop-clip-wiring-mod.js";

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
 * The stop take's stance reading for this frame: the wiring's own labels at the executor's stop
 * elapsed time. The mixer action's time is NOT read: both actions advance one dt per frame at
 * rate 1 through the handoff, so the executor's elapsed time and the playing action agree, and
 * the headless assay (which poses markers without advancing a stop action) reads the same value.
 */
export function resolveStopStanceForFrame(
  approach: CaseOwnedBedsideApproach,
): { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined {
  const wiring = approach.stopWiring;
  if (!wiring) return undefined;
  const elapsedSeconds = approach.execution.stopElapsedSeconds ?? 0;
  return { labels: wiring.labels, actionTimeSeconds: elapsedSeconds };
}

/**
 * The baked-stop handoff inputs, resolved only while walking. The wiring is measured once per
 * actor from its own bound stop take (null while the actor carries none, which keeps the legacy
 * ending); the walk stance is this frame's label reading off the playing walk action.
 */
export function resolveStopTriggerInput(approach: CaseOwnedBedsideApproach): {
  stop: StopClipTrigger | null;
  walkStance: { left: boolean; right: boolean } | null;
} {
  if (approach.execution.phase !== "walking") return { stop: null, walkStance: null };
  if (approach.stopWiring === undefined) {
    approach.stopWiring = resolveStopWiring({
      labelSlot: approach.stanceLabelSlot,
      travelHeadingRadians: approach.travelHeadingRadians,
    });
  }
  const wiring = approach.stopWiring;
  if (wiring === null || wiring === undefined) return { stop: null, walkStance: null };
  const stance = resolveClipStanceForFrame(approach);
  return {
    stop: {
      clipName: wiring.clipName,
      displacementMeters: wiring.displacementMeters,
      durationSeconds: wiring.durationSeconds,
      entryStance: wiring.entryStance,
      rootTrackXz: wiring.rootTrackXz,
      routeYawRadians: wiring.routeYawRadians,
    },
    walkStance: stance ? stanceAtTime(stance.labels, stance.actionTimeSeconds) : null,
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
 * Stopping entry: play the root-removed stop take at weight 0 and claim the mixer. The consumer
 * skips its own walk playback while the flag is set; the per-frame blend below raises the stop
 * weight while lowering the walk weight across STOP_CROSSFADE_SECONDS, then stops the walk
 * action. The walk-phase chain claim stays in place through the handoff: the same locomotion
 * owner keeps driving the legs.
 */
export function startStopClipPlayback(approach: CaseOwnedBedsideApproach): void {
  const slot = approach.stanceLabelSlot;
  const wiring = approach.stopWiring;
  if (slot?.mixer === undefined || !wiring) return;
  const action = slot.mixer.clipAction(wiring.noRootClip);
  action.reset();
  action.timeScale = 1;
  action.setEffectiveWeight(0);
  action.play();
  (slot.root.userData as Record<string, unknown>)[STOP_PLAYING_FLAG] = true;
}

export function blendStopClipPlayback(approach: CaseOwnedBedsideApproach, elapsedSeconds: number): void {
  const weight = Math.min(1, elapsedSeconds / STOP_CROSSFADE_SECONDS);
  const stopAction = stopMixerAction(approach);
  if (stopAction) stopAction.setEffectiveWeight(weight);
  const walkAction = walkMixerAction(approach);
  if (walkAction) {
    if (weight >= 1) {
      walkAction.stop();
    } else {
      walkAction.setEffectiveWeight(1 - weight);
    }
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
}
