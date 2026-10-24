import type { Stage2AudioPosition, Stage2Envelope } from "./types.js";

/** Receiver-only getStats observation. These are not channel-0 PCM/tone/physical-output measurements.
 * totalSamplesReceived INCLUDES concealedSamples; use positive received-minus-concealed DELTA.
 * Energy follows receiving-track stats semantics (highest channel for multichannel).
 */
export interface Stage2ReceiverDecodeSnapshot {
  observedAtBrowserMs: number; receiverTrackId: string; ssrc: number;
  totalSamplesReceived: number; concealedSamples: number;
  totalAudioEnergy: number; totalSamplesDuration: number;
}
export interface Stage2ReceiverDecodeEvidence {
  /** A retained COMPLETE healthy 700Hz monitor bin observed BEFORE intentional disconnection. */
  healthyMonitor: { sequence: number; observedAtBrowserMs: number };
  /** Both observations AFTER injection, same actual receiver-track/SSRC. Missing/reset is UNEXERCISED. */
  start: Stage2ReceiverDecodeSnapshot; end: Stage2ReceiverDecodeSnapshot;
}
/** Early-close prerequisite uses actual positions already received before injection, not final totals.
 * Browser times share environment.browser.timeOriginMs; serverAtMs uses named serverClockId only.
 * Server position is copied from matching /stats snapshot; browser position from actual monitor snapshot.
 */
export interface Stage2PreInjectionCheckpoint extends Stage2Envelope {
  requestedAtBrowserMs: number; receivedAtBrowserMs: number; browserObservedAtMs: number;
  serverClockId: string; serverAtMs: number;
  uplinkDecoded: Stage2AudioPosition; downlinkMonitor: Stage2AudioPosition;
}

/** Receiver progression prerequisite only: NEVER a content, post-gain, duration, or run verdict. */
export function stage2ReceiverDecodeAdvances(start: Stage2ReceiverDecodeSnapshot, end: Stage2ReceiverDecodeSnapshot): boolean {
  const valid = (s: Stage2ReceiverDecodeSnapshot) => typeof s.receiverTrackId === "string" && s.receiverTrackId.length > 0
    && Number.isSafeInteger(s.ssrc) && s.ssrc > 0 && Number.isFinite(s.observedAtBrowserMs)
    && Number.isSafeInteger(s.totalSamplesReceived) && s.totalSamplesReceived >= 0
    && Number.isSafeInteger(s.concealedSamples) && s.concealedSamples >= 0 && s.concealedSamples <= s.totalSamplesReceived
    && Number.isFinite(s.totalAudioEnergy) && s.totalAudioEnergy >= 0
    && Number.isFinite(s.totalSamplesDuration) && s.totalSamplesDuration >= 0;
  return valid(start) && valid(end) && start.receiverTrackId === end.receiverTrackId && start.ssrc === end.ssrc
    && end.observedAtBrowserMs > start.observedAtBrowserMs && end.totalSamplesReceived >= start.totalSamplesReceived
    && end.concealedSamples >= start.concealedSamples
    && end.totalSamplesReceived - start.totalSamplesReceived - (end.concealedSamples - start.concealedSamples) > 0
    && end.totalAudioEnergy > start.totalAudioEnergy && end.totalSamplesDuration > start.totalSamplesDuration;
}
