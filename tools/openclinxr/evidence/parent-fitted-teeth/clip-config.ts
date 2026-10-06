/**
 * Clip selection for mouth-dynamics-capture.ts (viseme-eval slice).
 *
 * Step3 is the legacy default: its audio bytes, line, output dir, sampler
 * geometry, and metrics schema are pinned here and asserted by
 * clip-config.test.ts, so generalizing the capture cannot move them.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");

export const STEP3_LINE = "I feel the pain is better now.";
export const STEP3_AUDIO_REL = "tools/openclinxr/evidence/parent-fitted-teeth/visemes/i-feel-the-pain-is-better-now.aiff";

export const PANGRAM_LINE =
  "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos.";
export const WORDS_LINE = "put. fat. think. tip. call. chair. sir. lot. red. car. bed. toe. book.";
export const WORDS_TRANSCRIPT = "put fat think tip call chair sir lot red car bed toe book";

export type ClipId = "step3" | "pangram" | "viseme-words";

export type ClipConfig = {
  clip: ClipId;
  /** Spoken line (display + prepared-runtime response text). */
  line: string;
  /** Transcript handed to the MFA aligner (differs from line for viseme-words). */
  transcript: string;
  audioFile: string;
  /** Subdir under docs/openclinxr/mouth-dynamics/. */
  outSubdir: string;
  /** True only for step3: legacy sampler (no upper/lower split in the
   * default view) and legacy metrics schema. */
  legacy: boolean;
  /** Basename used for the MFA job dir. */
  mfaBasename: string;
};

const CLIPS: Record<ClipId, Omit<ClipConfig, "clip" | "audioFile"> & { audioRel: string }> = {
  step3: {
    line: STEP3_LINE,
    transcript: STEP3_LINE,
    audioRel: STEP3_AUDIO_REL,
    outSubdir: "step3",
    legacy: true,
    mfaBasename: "step3",
  },
  pangram: {
    line: PANGRAM_LINE,
    transcript: PANGRAM_LINE,
    audioRel: "tools/openclinxr/evidence/parent-fitted-teeth/visemes/pangram.aiff",
    outSubdir: "viseme-eval/pangram",
    legacy: false,
    mfaBasename: "pangram",
  },
  "viseme-words": {
    line: WORDS_LINE,
    transcript: WORDS_TRANSCRIPT,
    audioRel: "tools/openclinxr/evidence/parent-fitted-teeth/visemes/viseme-words.aiff",
    outSubdir: "viseme-eval/viseme-words",
    legacy: false,
    mfaBasename: "words",
  },
};

export function resolveClipConfig(argv: readonly string[]): ClipConfig {
  const at = argv.indexOf("--clip");
  const named = at >= 0 ? argv[at + 1] : undefined;
  const clip: ClipId = named === "pangram" || named === "viseme-words" ? named : "step3";
  const base = CLIPS[clip]!;
  return { clip, line: base.line, transcript: base.transcript, audioFile: path.join(REPO, base.audioRel), outSubdir: base.outSubdir, legacy: base.legacy, mfaBasename: base.mfaBasename };
}
