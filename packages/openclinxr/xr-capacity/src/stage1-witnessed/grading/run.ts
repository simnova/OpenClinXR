import { gradeRun } from "../../stage0/reducer.js";
import { gradeWitnessedAudio } from "./audio.js";
import { parseWitnessedStage1Record } from "./parse.js";
import type { WitnessedStage1Release } from "./types.js";

import { STAGE1_ORDER } from "../../stage1/grading/run.js";
export { STAGE1_ORDER } from "../../stage1/grading/run.js";
export const WITNESSED_PROTOCOL_SHA256 = "efc633be9fa8d8fb86e65951b7cd89be08498b7331d7c23eb2d8f37319a83245";
export const IMMUTABLE_TARGET_WORKLET_SHA256 = "bcfdec6d19b9b794e7915e21b79601e3f03e4124308192ec774c03c0949aebf4";
const hash = (v: string) => /^[a-f0-9]{64}$/.test(v);
export function witnessedReleaseReasons(release: WitnessedStage1Release): string[] {
  const reasons: string[] = [];
  try {
  if (release.schema !== "quest-stage1-witnessed-release.v1" || !release.releaseId || !hash(release.audioConfigSha256) || !hash(release.workletSha256) || !hash(release.witnessWorkletSha256) || !Object.values(release.identity).every(hash)) reasons.push("release-identity-invalid");
  if (release.identity.protocolSha256 !== WITNESSED_PROTOCOL_SHA256 || release.workletSha256 !== IMMUTABLE_TARGET_WORKLET_SHA256) reasons.push("release-protocol-or-immutable-target-mismatch");
  if (release.profile.selectedTargetHz !== 90 || release.profile.foveationRequested !== 1 || release.profile.framebufferScaleRequested !== 1) reasons.push("release-not-fixed-90Hz-profile");
  if (!(release.effectiveAudio.sampleRate >= 8000 && release.effectiveAudio.sampleRate <= 384000) || !Number.isFinite(release.effectiveAudio.sampleRate)) reasons.push("release-effective-audio-invalid");
  if (release.slots.length !== 6 || new Set(release.slots.map(s => s.nonce)).size !== 6 || release.slots.some((s, i) => s.mode !== STAGE1_ORDER[i] || s.pair !== Math.floor(i / 2) + 1 || s.position !== i % 2 + 1 || s.nonce.length < 16 || s.nonce.length > 256)) reasons.push("release-six-slot-schedule-invalid");
  } catch { reasons.push("release-structure-invalid"); }
  return reasons;
}
/** A malformed record fails explicitly; Stage0 policy and retained raw rows are unchanged. */
export function gradeWitnessedRun(value: unknown, release: WitnessedStage1Release) {
  const reasons = witnessedReleaseReasons(release);
  try {
    const r = parseWitnessedStage1Record(value), xr = gradeRun(r.xr, release), audio = gradeWitnessedAudio(r, release);
    const scheduled = release.slots.find(s => s.pair === r.slot.pair && s.position === r.slot.position);
    if (!scheduled || scheduled.mode !== r.mode || scheduled.nonce !== r.slot.nonce || r.slot.nonce !== r.xr.identity.nonce) reasons.push("slot-mode-or-nonce-not-released");
    if (!Number.isFinite(r.pageTimeOriginMs) || r.pageTimeOriginMs <= 0) reasons.push("page-clock-origin-invalid");
    const valid = reasons.length === 0 && xr.valid && audio.valid;
    return { valid, candidatePass: valid && xr.performancePass && audio.functionalPass, reasons: [...reasons, ...xr.reasons, ...audio.reasons], xr, audio };
  } catch (error) {
    return { valid: false, candidatePass: false, reasons: [...reasons, error instanceof Error ? error.message : String(error)], xr: null, audio: null };
  }
}
