import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Apple Speech Synthesis default for `say` (words per minute). */
export const MACOS_SAY_DEFAULT_WPM = 175;

export type LipSyncFixtureWavOptions = {
  /** Frozen-plan mapper speed (0.7–1.5). Omit to keep historical `say` argv (no `-r`). */
  prosodySpeed?: number;
  /** `say -v` voice name. Omit for the system default. */
  voice?: string;
};

/** Map mapper speed onto `say -r` WPM. Pain 0.85 → 149; anxious 0.95 → 166; 1.0 → 175. */
export function sayRateWpmFromProsodySpeed(speed: number): number {
  const clamped = Math.min(1.5, Math.max(0.7, speed));
  return Math.round(MACOS_SAY_DEFAULT_WPM * clamped);
}

/** Argv for fixture `say`. Does not include the binary name. */
export function sayFixtureArgv(
  aiffPath: string,
  utterance: string,
  options: LipSyncFixtureWavOptions = {},
): string[] {
  const args: string[] = [];
  if (options.voice !== undefined && options.voice.length > 0) {
    args.push("-v", options.voice);
  }
  if (options.prosodySpeed !== undefined) {
    args.push("-r", String(sayRateWpmFromProsodySpeed(options.prosodySpeed)));
  }
  args.push("-o", aiffPath, utterance);
  return args;
}

/**
 * Offline fixture TTS for local macOS. Production `runLipSync` takes a wav path
 * and never shells the system speech synthesizer.
 */
export async function writeLipSyncFixtureWav(
  utterance: string,
  outDir: string,
  options: LipSyncFixtureWavOptions = {},
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const rateKey =
    options.prosodySpeed === undefined ? "" : `\0r${sayRateWpmFromProsodySpeed(options.prosodySpeed)}`;
  const voiceKey = options.voice ? `\0v${options.voice}` : "";
  const base = `utterance-${createHash("sha1").update(`${utterance}${rateKey}${voiceKey}`).digest("hex").slice(0, 10)}`;
  const aiffPath = path.join(outDir, `${base}.aiff`);
  const wavPath = path.join(outDir, `${base}.wav`);
  await execFileAsync("say", sayFixtureArgv(aiffPath, utterance, options));
  await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiffPath, wavPath]);
  return wavPath;
}

/**
 * Deterministic local wav stand-in for CI/dark-factory lip_sync bakes.
 * 16-bit little-endian mono PCM WAVE, 22050 Hz, ~1.0 s 440 Hz sine.
 * Never shells `say` or `afconvert`; writes bytes synchronously.
 */
export function writeDeterministicLipSyncWav(utterance: string, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const base = `deterministic-${createHash("sha1").update(utterance).digest("hex").slice(0, 10)}`;
  const wavPath = path.join(outDir, `${base}.wav`);
  const sampleRate = 22050;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const data = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i += 1) {
    const sample = Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    data.writeInt16LE(sample, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(wavPath, Buffer.concat([header, data]));
  return wavPath;
}
