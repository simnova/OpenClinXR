import type { Group } from "three";
import { resolveConversationEyeFrame, type ConversationEyeRuntimeSlot } from "./conversation-eye-runtime-state.js";
import type { HumanoidConversationEyeState } from "./conversational-eye-schedule.js";
import {
  applyHumanoidMorphTargetCue,
  applyHumanoidRestBlink,
  resetHumanoidFaceRigControls,
} from "./face-rig.js";

export type IsolatedHumanoidEyeMotionState = Extract<HumanoidConversationEyeState, "listening" | "rest">;

type IsolatedEyeMotionSlot = ConversationEyeRuntimeSlot & {
  actorId: string;
  root: Group;
};

const slots = new WeakMap<Group, IsolatedEyeMotionSlot>();

/**
 * Product conversational-eye adapter for the isolated-subject lab. The one-subject lab has no
 * full animation slot constructor, so this retains only the fields consumed by the production
 * state resolver and rest/listening eye path. Schedule, blink curve, gaze bouts, morph resolution,
 * and MPFB eye-bone rotation all remain owned by the ordinary product functions.
 */
export function applyIsolatedHumanoidEyeMotion(
  root: Group,
  requestedState: IsolatedHumanoidEyeMotionState,
  nowMs: number,
): number {
  let slot = slots.get(root);
  if (!slot) {
    // The lab contains one subject, so phase zero makes its capture clock begin at the product
    // schedule origin while remaining deterministic. Multi-actor de-synchronisation is irrelevant.
    slot = { actorId: "", root, activeSpeech: undefined };
    slots.set(root, slot);
  }
  const frame = resolveConversationEyeFrame(slot, requestedState === "listening", nowMs);
  resetHumanoidFaceRigControls(slot);
  applyHumanoidMorphTargetCue(
    slot,
    0,
    "rest",
    { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
    () => ({ activeTargetName: null }),
  );
  return applyHumanoidRestBlink(slot, nowMs, frame.state, frame.elapsedMs);
}
