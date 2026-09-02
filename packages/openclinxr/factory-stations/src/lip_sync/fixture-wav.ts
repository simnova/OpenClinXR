import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Offline fixture TTS for local macOS. Production `runLipSync` takes a wav path
 * and never shells the system speech synthesizer.
 */
export async function writeLipSyncFixtureWav(utterance: string, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const base = `utterance-${createHash("sha1").update(utterance).digest("hex").slice(0, 10)}`;
  const aiffPath = path.join(outDir, `${base}.aiff`);
  const wavPath = path.join(outDir, `${base}.wav`);
  await execFileAsync("say", ["-o", aiffPath, utterance]);
  await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiffPath, wavPath]);
  return wavPath;
}
