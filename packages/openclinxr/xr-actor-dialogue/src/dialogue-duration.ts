import { humanoidDialogueDurationMs as packageHumanoidDialogueDurationMs } from "@openclinxr/xr-humanoid-animation";
import type { ActorDialogueSpeechDeps } from "./types.js";

export function humanoidDialogueDurationMs(
  deps: Pick<ActorDialogueSpeechDeps, "reviewCaptureMode">,
  phonemeCount: number,
): number {
  return packageHumanoidDialogueDurationMs(phonemeCount, deps.reviewCaptureMode());
}
