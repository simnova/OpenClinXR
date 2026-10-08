/**
 * Data-only bake helper for evidence captures (card tsk_103fae4032cebc86).
 *
 * Evidence drives the live path in replay mode through a process boundary
 * (no cross-package src import): evidence decodes the cached Grok mp3 with
 * ffmpeg, passes f32le samples + STT words + transcript + pronunciations in,
 * and reads {cues, anchors, mismatches, oovWords} on stdout. The arithmetic
 * is bakeLiveSttCueTrack itself, so the capture cannot drift from the player.
 *
 * Spawn: tsx src/cli/live-stt-bake.ts --input /tmp/bake-in.json
 * Input: { sampleRate, samplesB64 (f32le), sttWords, transcript, pronunciations }
 */
import { readFileSync } from "node:fs";
import { bakeLiveSttCueTrack, type SttWord } from "../live-stt-plan.js";

/** Bake a cue track from a JSON input document; returns the JSON result. */
export function bakeTrackFromJson(inputJson: string): string {
  const input = JSON.parse(inputJson) as {
    sampleRate: number;
    samplesB64: string;
    sttWords: SttWord[];
    transcript: string;
    pronunciations: Record<string, string[]>;
  };
  const bytes = Buffer.from(input.samplesB64, "base64");
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  const result = bakeLiveSttCueTrack({
    samples,
    sampleRate: input.sampleRate,
    sttWords: input.sttWords,
    transcript: input.transcript,
    pronunciations: input.pronunciations,
  });
  return JSON.stringify(result);
}

function argValue(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`missing-arg:${name}`);
  return value;
}

const invokedAsMain = process.argv[1] !== undefined && process.argv[1].endsWith("live-stt-bake.ts");
if (invokedAsMain) {
  process.stdout.write(`${bakeTrackFromJson(readFileSync(argValue("--input"), "utf8"))}\n`);
}
