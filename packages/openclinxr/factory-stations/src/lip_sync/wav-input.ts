import { readdirSync } from "node:fs";
import path from "node:path";
import { writeDeterministicLipSyncWav } from "./fixture-wav.js";

type LipSyncWavOptions = {
  utterance: string;
  outDir: string;
  wavPath?: string;
  fixtureWavPath?: string;
};

/**
 * Typed resolution failures. Explicit-blank input is a caller error and must
 * never trigger the deterministic PCM fallback, even with the flag set; only
 * the missing-audio resolution funnels into it. The code (not the message)
 * is the discriminator so the outer catch stays narrow instead of catching
 * every error, including unexpected I/O failures.
 */
const LIP_SYNC_EXPLICIT_BLANK_AUDIO = "LIP_SYNC_EXPLICIT_BLANK_AUDIO";
const LIP_SYNC_MISSING_AUDIO = "LIP_SYNC_MISSING_AUDIO";

function lipSyncWavInputError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function lipSyncWavInputErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code: unknown = (err as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isMissingLipSyncAudioError(err: unknown): boolean {
  return lipSyncWavInputErrorCode(err) === LIP_SYNC_MISSING_AUDIO;
}

export { isMissingLipSyncAudioError, lipSyncWavInputErrorCode };

/**
 * Resolve the wav for the lip-sync bake. Production takes a provided wavPath
 * (e.g. Grok unary TTS bytes) and never shells system TTS. A recorded *.wav
 * already in outDir (the chain mkdir's stageDir before asking) resolves as
 * "provided". The fixture helper writeLipSyncFixtureWav runs only when
 * OPENCLINXR_LIP_SYNC_FIXTURE=1 or an explicit fixtureWavPath is given;
 * otherwise a missing wavPath throws.
 */
function resolveLipSyncWavPath(options: LipSyncWavOptions): {
  kind: "provided" | "fixture-flag" | "fixture-path";
  wavPath: string;
} {
  // An explicitly blank path is a caller error, never a fallback trigger:
  // it is rejected even when a fixture fallback or deterministic PCM is enabled.
  if (options.wavPath !== undefined) {
    if (options.wavPath.trim().length === 0) {
      throw lipSyncWavInputError(
        LIP_SYNC_EXPLICIT_BLANK_AUDIO,
        "lip_sync wavPath is required (explicit blank wavPath); provide wavPath audio, fixtureWavPath, a single recorded *.wav in outDir, or a speech source for the build-time speech-synth (kokoro) step",
      );
    }
    return { kind: "provided", wavPath: options.wavPath };
  }
  if (options.fixtureWavPath !== undefined) {
    if (options.fixtureWavPath.trim().length === 0) {
      throw lipSyncWavInputError(
        LIP_SYNC_EXPLICIT_BLANK_AUDIO,
        "lip_sync wavPath is required (explicit blank fixtureWavPath); provide wavPath audio, a fixtureWavPath, a single recorded *.wav in outDir, or a speech source for the build-time speech-synth (kokoro) step",
      );
    }
    return { kind: "fixture-path", wavPath: options.fixtureWavPath };
  }
  if (process.env["OPENCLINXR_LIP_SYNC_FIXTURE"] === "1") return { kind: "fixture-flag", wavPath: "" };
  try {
    const wavs = readdirSync(options.outDir)
      .filter((entry) => entry.toLowerCase().endsWith(".wav"))
      .sort();
    const [wav] = wavs;
    if (wavs.length === 1 && wav !== undefined) return { kind: "provided", wavPath: path.join(options.outDir, wav) };
  } catch (readErr) {
    // Only a missing outDir falls through to the typed missing-audio throw
    // below. Unexpected I/O failures (EACCES, EPERM, EIO, …) propagate so
    // they are never masked as missing audio.
    const code =
      typeof readErr === "object" && readErr !== null && "code" in readErr
        ? (readErr as { code: unknown }).code
        : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw readErr;
  }
  throw lipSyncWavInputError(
    LIP_SYNC_MISSING_AUDIO,
    "lip_sync needs wavPath (Grok unary bytes); fixture TTS requires OPENCLINXR_LIP_SYNC_FIXTURE=1 or fixtureWavPath",
  );
}

/**
 * Resolve the wav for the lip-sync bake, writing a deterministic PCM sine
 * stand-in when the outDir is empty and OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM=1.
 * Shared by runLipSyncStation and runLipSyncStage so the S6 fallback is one
 * code path, not two copies. Without the flag an empty outDir still throws.
 * Explicit-blank caller errors rethrow regardless of the flag, and
 * unexpected I/O failures are never masked by the PCM write either: only
 * the typed missing-audio resolution falls into the fallback.
 */
export function resolveLipSyncWavPathAllowingDeterministicPcm(
  options: LipSyncWavOptions,
): { kind: "provided" | "fixture-flag" | "fixture-path"; wavPath: string } {
  try {
    return resolveLipSyncWavPath(options);
  } catch (resolveErr) {
    if (
      process.env["OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM"] !== "1" ||
      !isMissingLipSyncAudioError(resolveErr)
    ) {
      throw resolveErr;
    }
    const wavPath = writeDeterministicLipSyncWav(options.utterance, options.outDir);
    return { kind: "provided", wavPath };
  }
}

