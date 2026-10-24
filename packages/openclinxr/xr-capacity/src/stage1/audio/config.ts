import type { DuplexAudioConfiguration } from "./types.js";
export const DUPLEX_AUDIO_CONFIG: Readonly<DuplexAudioConfiguration> = Object.freeze({
  construction: "muted-oscillator-bootstrap-before-permission",
  sampleRateRequested: 48000, channelCountRequested: 1, latencyHint: "interactive",
  echoCancellation: false, noiseSuppression: false, autoGainControl: false,
  frequencyHz: 440, speakerPeak: 0.002, rampSeconds: 0.025, reportSeconds: 0.5,
  maximumRowsPerNode: 512, mediaPermissionDeadlineMs: 30000, graphReadinessDeadlineMs: 10000,
  readyToXRDeadlineMs: 30000, graphLifetimeMs: 150000, contextLifetimeMs: 180000, drainDeadlineMs: 5000, markDeadlineMs: 1000,
});
export async function sha256AudioBytes(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((n) => n.toString(16).padStart(2, "0")).join("");
}
export function duplexAudioConfigHash(): Promise<string> {
  return sha256AudioBytes(new TextEncoder().encode(JSON.stringify(DUPLEX_AUDIO_CONFIG)));
}
