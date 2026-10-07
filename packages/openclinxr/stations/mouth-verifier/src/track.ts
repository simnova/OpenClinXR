/**
 * Cue-track loading for the mouth verifier (MADR 0061 verifier).
 *
 * The track file carries the fixed-capture line, its cue spans and the
 * ground-truth tooth samples the projection compares against.
 */
import { readFileSync } from "node:fs";
import type { CueTrackCue, ToothSample } from "./verifier-types.js";

/** Evaluator cue track: the fixed-capture line plus samples. */
export type EvaluatorTrack = {
  /** Source line the cues were derived from. */
  line: string;
  /** Fixed evaluator clock, frames per second. */
  frameRate: number;
  /** Frames to evaluate. */
  frameCount: number;
  /** Cue spans in track order. */
  canonicalTrack: CueTrackCue[];
  /** Ground-truth tooth samples per frame. */
  toothSamples: ToothSample[];
};

/** Read and validate an evaluator track file. */
export function readEvaluatorTrack(trackPath: string): EvaluatorTrack {
  const raw = JSON.parse(readFileSync(trackPath, "utf8")) as {
    line?: unknown;
    frameRate?: unknown;
    frameCount?: unknown;
    canonicalTrack?: unknown;
    toothSamples?: unknown;
  };
  if (typeof raw.line !== "string" || !Array.isArray(raw.canonicalTrack) || !Array.isArray(raw.toothSamples)) {
    throw new Error(`track file missing line/canonicalTrack/toothSamples: ${trackPath}`);
  }
  if (raw.frameRate !== 30) throw new Error(`evaluator runs at a fixed 30 fps clock, track says ${String(raw.frameRate)}`);
  if (typeof raw.frameCount !== "number") throw new Error(`track file missing frameCount: ${trackPath}`);
  return {
    line: raw.line,
    frameRate: raw.frameRate,
    frameCount: raw.frameCount,
    canonicalTrack: raw.canonicalTrack as CueTrackCue[],
    toothSamples: raw.toothSamples as ToothSample[],
  };
}
