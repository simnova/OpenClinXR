/**
 * Run the lip_sync station for every case in the shipped population WITHOUT
 * the full --all chain (which takes ~70 min of Blender bakes this slice does
 * not need). Writes docs/openclinxr/lipsync-speech/per-case.json plus three
 * listening samples. Stage work dirs stay under the system tmpdir; only
 * per-case.json + samples/ are committed.
 *
 * Usage: pnpm exec tsx tools/openclinxr/dark-factory/run-lipsync-speech-cases.ts
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateCasePopulation, findFixtureById, firstAuthoredSpeech, runLipSyncStage } from "./multi-case-runner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "docs", "openclinxr", "lipsync-speech");

type PerCaseRecord = {
  caseId: string;
  actorId: string;
  role: string;
  voice: string;
  text: string;
  wavSha256: string;
  wavBytes: number;
  modelRevision: string;
  cueCount: number;
  shapes: string[];
  classification: string;
  note: string;
};

async function main(): Promise<void> {
  const population = await enumerateCasePopulation();
  const workRoot = path.join(tmpdir(), `lipsync-speech-cases-${process.pid}`);
  const records: PerCaseRecord[] = [];
  for (const caseId of population) {
    const scenario = findFixtureById(caseId);
    const speech = firstAuthoredSpeech(scenario);
    if (!speech) {
      records.push({
        caseId, actorId: "", role: "", voice: "", text: "", wavSha256: "", wavBytes: 0,
        modelRevision: "", cueCount: 0, shapes: [],
        classification: "absent", note: "case authors no spoken line",
      });
      continue;
    }
    const stageDir = path.join(workRoot, caseId);
    await mkdir(stageDir, { recursive: true });
    const { row } = await runLipSyncStage(caseId, stageDir);
    if (row.classification !== "deterministic") {
      records.push({
        caseId, actorId: speech.actorId, role: speech.role, voice: "", text: speech.utterance,
        wavSha256: "", wavBytes: 0, modelRevision: "",
        cueCount: 0, shapes: [], classification: row.classification, note: row.notes.join(" "),
      });
      continue;
    }
    const cueFile = path.join(stageDir, row.artifactPaths.map((p) => path.basename(p))[0] ?? "");
    const cues = JSON.parse(await readFile(cueFile, "utf8")) as {
      metadata?: { duration?: number };
      mouthCues?: Array<{ start: number; end: number; value: string }>;
    };
    const mouthCues = cues.mouthCues ?? [];
    // The synth wav lives in the shared content cache; recover voice, model
    // revision, and wav bytes via the stage manifest rather than re-deriving
    // keys (this script must not bind package internals: reviewed surface).
    const manifest = JSON.parse(await readFile(path.join(stageDir, "lip-sync-manifest.json"), "utf8")) as {
      wavPath?: string;
      modelRevision?: string;
      speech?: { voice?: string; wavSha256?: string };
    };
    const wavBytes = await readFile(String(manifest.wavPath ?? ""));
    const voice = manifest.speech?.voice ?? "";
    records.push({
      caseId,
      actorId: speech.actorId,
      role: speech.role,
      voice,
      text: speech.utterance,
      wavSha256: createHash("sha256").update(wavBytes).digest("hex"),
      wavBytes: wavBytes.length,
      modelRevision: manifest.modelRevision ?? "",
      cueCount: mouthCues.length,
      shapes: [...new Set(mouthCues.map((c) => c.value))].sort(),
      classification: row.classification,
      note: row.notes.join(" "),
    });
    console.log(`OK ${caseId} voice=${voice} cues=${mouthCues.length} wav=${wavBytes.length}B`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "per-case.json"), `${JSON.stringify(records, null, 2)}\n`, "utf8");

  // Three short listening samples (<200 KB each): two adult + one child voice.
  const samples: Array<{ caseId: string; file: string }> = [
    { caseId: "peds_asthma_parent_anxiety_v1", file: "peds-asthma-af_heart" },
    { caseId: "psych_suicidal_ideation_safety_v1", file: "psych-safety-af_heart" },
    { caseId: "peds_fever_v1", file: "peds-fever-af_heart" },
  ];
  await mkdir(path.join(OUT_DIR, "samples"), { recursive: true });
  for (const sample of samples) {
    const rec = records.find((r) => r.caseId === sample.caseId);
    if (!rec || rec.classification !== "deterministic") throw new Error(`no deterministic bake for sample ${sample.caseId}`);
    const stageDir = path.join(workRoot, sample.caseId);
    const manifest = JSON.parse(await readFile(path.join(stageDir, "lip-sync-manifest.json"), "utf8")) as {
      wavPath?: string;
    };
    await copyFile(String(manifest.wavPath), path.join(OUT_DIR, "samples", `${sample.file}.wav`));
    const cueName = (await import("node:fs/promises").then((fs) => fs.readdir(stageDir))).find((f) => f.endsWith(".mouth-cues.json"));
    if (!cueName) throw new Error(`no cue artifact for sample ${sample.caseId}`);
    await copyFile(path.join(stageDir, cueName), path.join(OUT_DIR, "samples", `${sample.file}.mouth-cues.json`));
  }
  console.log(`WROTE ${path.join(OUT_DIR, "per-case.json")} (${records.length} cases)`);
}

void main().catch((err) => {
  console.error("LIPSYNC_CASES_FAIL", err);
  process.exit(1);
});
