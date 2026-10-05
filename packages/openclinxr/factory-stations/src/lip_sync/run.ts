import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import {
  SPEECH_SYNTH_MODEL_REVISION,
  synthesizeSpeechWav,
  voiceIdForActor,
  type SpeechProvenance,
} from "./speech-synth.js";

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
  wavPath: string;
  /**
   * Build-time speech source (Kokoro-82M, Apache-2.0). When wavPath is empty
   * and speech is present, runLipSync synthesises the utterance to the shared
   * content cache and bakes visemes from it. Without either, it throws and
   * names the speech-synth step. Provided wavPath always wins.
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
  cues: LipSyncCue[];
  tool: string;
  binary: string;
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
  let { wavPath } = options;
  let speech: SpeechProvenance | undefined;
  if (!wavPath || wavPath.trim().length === 0) {
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
  await writeFile(
    path.join(outDir, "lip-sync-manifest.json"),
    `${JSON.stringify({ stationId: "lip_sync", tool: "rhubarb", binary, utterance, wavPath, cueCount: (raw.mouthCues ?? []).length, modelRevision: SPEECH_SYNTH_MODEL_REVISION, speech }, null, 2)}\n`,
  );
  return {
    ...planned.plan,
    status: "invoked",
    tool: "rhubarb",
    binary,
    cueArtifactPath,
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
