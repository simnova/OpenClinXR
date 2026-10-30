import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { factoryStationSchemas } from "@openclinxr/factory-station-core";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "@openclinxr/factory-station-core";
import {
  SPEECH_SYNTH_MODEL_REVISION,
  synthesizeSpeechWav,
  voiceIdForActor,
  type SpeechProvenance,
} from "./speech-synth.js";
import { isMissingLipSyncAudioError, resolveLipSyncWavPathAllowingDeterministicPcm } from "./wav-input.js";

const execFileAsync = promisify(execFile);

export function planLipSync(input: unknown): StationPlanResult {
  return planFromCatalog("lip_sync", input, (value) => ({
    actorId: value["actorId"],
    visemeBank: value["visemeBank"],
    bakerId: "rhubarb",
    tool: "rhubarb",
    exportFormat: "json",
    processIsolation: "fresh_subprocess",
    network: false,
  }));
}

export type LipSyncRunOptions = {
  utterance: string;
  outDir: string;
  /**
   * Provided baker audio (e.g. Grok unary TTS bytes). Optional: when omitted
   * the producer resolves fixtureWavPath, a single recorded *.wav already in
   * outDir, or the explicit deterministic PCM stand-in. A non-blank wavPath
   * always wins over every other source, including speech. An explicitly
   * blank wavPath is rejected unless a speech source is present (it then
   * synthesises, preserving the speech-synth flow).
   */
  wavPath?: string;
  /**
   * Explicit fixture audio. Supported without enabling fixture synthesis;
   * loses to a non-blank wavPath.
   */
  fixtureWavPath?: string;
  /**
   * Build-time speech source (Kokoro-82M, Apache-2.0). When no provided audio
   * resolves and speech is present, runLipSync synthesises the utterance to
   * the shared content cache and bakes visemes from it. Without any source it
   * throws and names the speech-synth step. Provided wavPath always wins.
   */
  speech?: LipSyncSpeechSource;
};

/** Case actor context for deterministic voice mapping (voiceIdForActor). */
export type LipSyncSpeechSource = {
  caseId: string;
  actorId: string;
  role: string;
  genderPresentation?: string | undefined;
  displayName?: string | undefined;
  /** Explicit voice; defaults to voiceIdForActor({role, genderPresentation, displayName, actorId}). */
  voiceId?: string | undefined;
};

export type LipSyncCue = { start: number; end: number; value: string };

export type LipSyncRunResult = Record<string, unknown> & {
  cueArtifactPath: string;
  /** Real manifest artifact path already written alongside the cues. */
  manifestArtifactPath: string;
  cues: LipSyncCue[];
  tool: string;
  binary: string;
  /** Speech provenance when the utterance was synthesised; absent for provided wavs. */
  speech?: SpeechProvenance | undefined;
};

function resolveRhubarbBinary(): string {
  const home = process.env["HOME"] ?? "/Users/patrick";
  return process.env["OPENCLINXR_RHUBARB_BIN"] ?? path.join(home, ".openclinxr-tools", "rhubarb", "rhubarb");
}

/** Unique rhubarb spawn for lip_sync. Tests must call plan(), not run(). */
export async function runLipSync(input: unknown, options: LipSyncRunOptions): Promise<LipSyncRunResult> {
  const planned = planLipSync(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const { utterance, outDir } = options;
  let wavPath: string | undefined;
  let speech: SpeechProvenance | undefined;
  const explicitWav = options.wavPath;
  if (explicitWav !== undefined) {
    if (explicitWav.trim().length === 0) {
      if (!options.speech) {
        throw new Error(
          "lip_sync wavPath is required (explicit blank wavPath); provide wavPath audio, fixtureWavPath, a single recorded *.wav in outDir, or a speech source for the build-time speech-synth (kokoro) step",
        );
      }
      // Explicit blank wavPath plus a speech source: synthesise below.
      wavPath = undefined;
    } else {
      // Provided wavPath always wins over fixture, recorded, and speech sources.
      wavPath = explicitWav;
    }
  } else if (options.fixtureWavPath !== undefined) {
    if (options.fixtureWavPath.trim().length === 0) {
      throw new Error(
        "lip_sync wavPath is required (explicit blank fixtureWavPath); provide wavPath audio, a fixtureWavPath, a single recorded *.wav in outDir, or a speech source for the build-time speech-synth (kokoro) step",
      );
    }
    wavPath = options.fixtureWavPath;
  } else {
    // No explicit audio: the wav resolver stays the first producer (a
    // fixture/recorded/deterministic wav still wins over speech), but a
    // missing/ambiguous resolution falls through to the explicit speech
    // source below instead of throwing. Without speech it rethrows, so
    // missing/ambiguous audio is never silently replaced. An explicit
    // fixture-flag request still throws: production runLipSync never shells
    // fixture TTS itself (runLipSyncStation bakes it behind the flag).
    let resolved: ReturnType<typeof resolveLipSyncWavPathAllowingDeterministicPcm> | undefined;
    try {
      resolved = resolveLipSyncWavPathAllowingDeterministicPcm({ utterance, outDir });
    } catch (resolveErr) {
      // Only typed missing-audio falls through to the explicit speech source
      // below. Unexpected I/O failures propagate even when speech is present.
      if (!isMissingLipSyncAudioError(resolveErr)) throw resolveErr;
      if (!options.speech) throw resolveErr;
    }
    if (resolved !== undefined) {
      if (resolved.kind === "fixture-flag") {
        throw new Error(
          "lip_sync needs wavPath; fixture bake lives in writeLipSyncFixtureWav (run with OPENCLINXR_LIP_SYNC_FIXTURE=1 via runLipSyncStation) or pass fixtureWavPath explicitly",
        );
      }
      wavPath = resolved.wavPath;
    }
  }
  if (wavPath === undefined || wavPath.trim().length === 0) {
    if (!options.speech) {
      throw new Error(
        "lip_sync needs wavPath, or a speech source for the build-time speech-synth (kokoro) step; fixture TTS lives in writeLipSyncFixtureWav",
      );
    }
    const voiceId =
      options.speech.voiceId ??
      voiceIdForActor({
        role: options.speech.role,
        genderPresentation: options.speech.genderPresentation,
        displayName: options.speech.displayName,
        actorId: options.speech.actorId,
      });
    const synth = await synthesizeSpeechWav({
      caseId: options.speech.caseId,
      actorId: options.speech.actorId,
      text: utterance,
      voiceId,
    });
    wavPath = synth.wavPath;
    speech = synth.provenance;
  }
  const binary = resolveRhubarbBinary();
  await mkdir(outDir, { recursive: true });
  const base = `utterance-${createHash("sha1").update(utterance).digest("hex").slice(0, 10)}`;
  const cueArtifactPath = path.join(outDir, `${base}.mouth-cues.json`);
  await execFileAsync(binary, ["--exportFormat", "json", "-o", cueArtifactPath, wavPath]);
  const raw = JSON.parse(await readFile(cueArtifactPath, "utf8")) as {
    metadata?: { duration?: number };
    mouthCues?: Array<{ start: number; end: number; value: string }>;
  };
  const manifestArtifactPath = path.join(outDir, "lip-sync-manifest.json");
  await writeFile(
    manifestArtifactPath,
    `${JSON.stringify({ stationId: "lip_sync", tool: "rhubarb", binary, utterance, actorId: planned.plan["actorId"], wavPath, cueCount: (raw.mouthCues ?? []).length, modelRevision: SPEECH_SYNTH_MODEL_REVISION, speech }, null, 2)}\n`,
  );
  return {
    ...planned.plan,
    status: "invoked",
    tool: "rhubarb",
    binary,
    cueArtifactPath,
    manifestArtifactPath,
    audioDurationSeconds: raw.metadata?.duration ?? 0,
    cues: raw.mouthCues ?? [],
    speech,
  };
}

export const lipSyncRunner: StationRunner = {
  stationId: "lip_sync",
  validate: (value) => factoryStationSchemas.lip_sync["~standard"].validate(value),
  plan: planLipSync,
  run: (_value) => {
    throw new Error("lip_sync run requires wavPath via runLipSync(); station dry-run is plan()");
  },
};
