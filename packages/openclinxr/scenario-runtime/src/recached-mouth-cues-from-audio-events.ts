import type { AudioEvent } from "@openclinxr/voice-gateway";
import type { RecachedMouthCue } from "./runtime-types.js";

/** Replay artifact for audio-owned speech. Mock/empty visemeCue → AA; real tokens kept. */
export function recachedMouthCuesFromAudioEvents(audioEvents: readonly AudioEvent[]): RecachedMouthCue[] {
  const cues: RecachedMouthCue[] = [];
  let atSecond = 0;
  for (const event of audioEvents) {
    const durationMs = Number(event?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
    const raw = String(event?.visemeCue ?? "").trim();
    const phoneme = raw === "" || raw === "neutral-pain" ? "AA" : raw;
    const durationSeconds = durationMs / 1000;
    cues.push({ phoneme, atSecond, durationSeconds });
    atSecond += durationSeconds;
  }
  return cues;
}
