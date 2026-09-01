import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

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
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const { utterance, outDir } = options;
  const binary = resolveRhubarbBinary();
  await mkdir(outDir, { recursive: true });
  const base = `utterance-${createHash("sha1").update(utterance).digest("hex").slice(0, 10)}`;
  const aiffPath = path.join(outDir, `${base}.aiff`);
  const wavPath = path.join(outDir, `${base}.wav`);
  const cueArtifactPath = path.join(outDir, `${base}.mouth-cues.json`);
  await execFileAsync("say", ["-o", aiffPath, utterance]);
  await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiffPath, wavPath]);
  await execFileAsync(binary, ["--exportFormat", "json", "-o", cueArtifactPath, wavPath]);
  const raw = JSON.parse(await readFile(cueArtifactPath, "utf8")) as {
    metadata?: { duration?: number };
    mouthCues?: Array<{ start: number; end: number; value: string }>;
  };
  await writeFile(
    path.join(outDir, "lip-sync-manifest.json"),
    `${JSON.stringify({ stationId: "lip_sync", tool: "rhubarb", binary, utterance, cueCount: (raw.mouthCues ?? []).length }, null, 2)}\n`,
  );
  return {
    ...planned.plan,
    status: "invoked",
    tool: "rhubarb",
    binary,
    cueArtifactPath,
    audioDurationSeconds: raw.metadata?.duration ?? 0,
    cues: raw.mouthCues ?? [],
  };
}

export const lipSyncRunner: StationRunner = {
  stationId: "lip_sync",
  validate: (value) => factoryStationSchemas.lip_sync["~standard"].validate(value),
  plan: planLipSync,
  run: (value) => runLipSync(value, { utterance: "", outDir: "." }),
};
