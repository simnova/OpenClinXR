import { gradeRun } from "../../stage0/reducer.js";
import { gradeStage1Audio } from "./audio.js";
import { parseStage1Record } from "./parse.js";
import type { Stage1Release } from "./types.js";

export const STAGE1_ORDER = ["off", "duplex", "duplex", "off", "off", "duplex"] as const;
const hash = (v: string) => /^[a-f0-9]{64}$/.test(v);
export function stage1ReleaseReasons(release: Stage1Release): string[] {
  const reasons: string[] = [];
  try {
  if (release.schema !== "quest-stage1-release.v1" || !release.releaseId || !hash(release.audioConfigSha256) || !hash(release.workletSha256) || !Object.values(release.identity).every(hash)) reasons.push("release-identity-invalid");
  if (release.profile.selectedTargetHz !== 90 || release.profile.foveationRequested !== 1 || release.profile.framebufferScaleRequested !== 1) reasons.push("release-not-fixed-90Hz-profile");
  if (!(release.effectiveAudio.sampleRate >= 8000 && release.effectiveAudio.sampleRate <= 384000) || !Number.isFinite(release.effectiveAudio.sampleRate)) reasons.push("release-effective-audio-invalid");
  if (release.slots.length !== 6 || new Set(release.slots.map(s => s.nonce)).size !== 6 || release.slots.some((s, i) => s.mode !== STAGE1_ORDER[i] || s.pair !== Math.floor(i / 2) + 1 || s.position !== i % 2 + 1 || s.nonce.length < 16 || s.nonce.length > 256)) reasons.push("release-six-slot-schedule-invalid");
  } catch { reasons.push("release-structure-invalid"); }
  return reasons;
}
/** A malformed record fails explicitly; Stage0 policy and retained raw rows are unchanged. */
export function gradeStage1Run(value: unknown, release: Stage1Release) {
  const reasons = stage1ReleaseReasons(release);
  try {
    const r = parseStage1Record(value), xr = gradeRun(r.xr, release), audio = gradeStage1Audio(r, release);
    const scheduled = release.slots.find(s => s.pair === r.slot.pair && s.position === r.slot.position);
    if (!scheduled || scheduled.mode !== r.mode || scheduled.nonce !== r.slot.nonce || r.slot.nonce !== r.xr.identity.nonce) reasons.push("slot-mode-or-nonce-not-released");
    if (!Number.isFinite(r.pageTimeOriginMs) || r.pageTimeOriginMs <= 0) reasons.push("page-clock-origin-invalid");
    const valid = reasons.length === 0 && xr.valid && audio.valid;
    return { valid, candidatePass: valid && xr.performancePass && audio.functionalPass, reasons: [...reasons, ...xr.reasons, ...audio.reasons], xr, audio };
  } catch (error) {
    return { valid: false, candidatePass: false, reasons: [...reasons, error instanceof Error ? error.message : String(error)], xr: null, audio: null };
  }
}
