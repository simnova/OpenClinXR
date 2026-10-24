import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLipSync } from "@openclinxr/factory-stations";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "lip-sync-resolution-"));
  directories.push(directory);
  return directory;
}

/** External binary fixture: input-selection tests do not grade phoneme recognition. */
function fakeRhubarb(): void {
  const binary = join(temporaryDirectory(), "rhubarb-fixture");
  writeFileSync(binary, `#!${process.execPath}\nconst fs = require("node:fs");\nconst output = process.argv[process.argv.indexOf("-o") + 1];\nfs.writeFileSync(output, JSON.stringify({ metadata: { duration: 1 }, mouthCues: [{ start: 0, end: 1, value: "X" }] }));\n`);
  chmodSync(binary, 0o755);
  vi.stubEnv("OPENCLINXR_RHUBARB_BIN", binary);
}

function manifestInput(path: string): { wavPath: unknown; actorId: unknown } {
  const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("wavPath" in manifest)) throw new Error("missing manifest input");
  return { wavPath: manifest.wavPath, actorId: "actorId" in manifest ? manifest.actorId : undefined };
}

describe("lip-sync station input resolution", () => {
  it("prioritizes supplied audio over both fixture paths and flags", async () => {
    fakeRhubarb();
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", "1");
    const outDir = temporaryDirectory();
    const wavPath = join(outDir, "spoken.wav");
    writeFileSync(wavPath, "RIFF-provided-input");
    const result = await runLipSync({ actorId: "case_patient", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir, wavPath, fixtureWavPath: "fixture.wav" });
    expect(manifestInput(result.manifestArtifactPath)).toEqual({ wavPath, actorId: "case_patient" });
  });

  it("accepts an explicit fixture without enabling fixture synthesis", async () => {
    fakeRhubarb();
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", undefined);
    const outDir = temporaryDirectory();
    const fixtureWavPath = join(outDir, "fixture.wav");
    writeFileSync(fixtureWavPath, "RIFF-fixture-input");
    const result = await runLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir, fixtureWavPath });
    expect(manifestInput(result.manifestArtifactPath)).toEqual({ wavPath: fixtureWavPath, actorId: "lip_sync" });
  });

  it("rejects explicit blank audio even when a fixture fallback is enabled", async () => {
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", "1");
    await expect(runLipSync(
      { actorId: "case_patient", visemeBank: "mpfb_phonemes" },
      { utterance: "hello", outDir: temporaryDirectory(), wavPath: "", fixtureWavPath: "fixture.wav" },
    )).rejects.toThrow(/wavPath is required/);
  });

  it("rejects ambiguous recorded audio instead of choosing an arbitrary wav", async () => {
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", undefined);
    vi.stubEnv("OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM", undefined);
    const outDir = temporaryDirectory();
    writeFileSync(join(outDir, "first.wav"), "RIFF");
    writeFileSync(join(outDir, "second.WAV"), "RIFF");
    await expect(runLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir })).rejects.toThrow(/needs wavPath/);
  });

  it("does not produce synthetic audio without the explicit deterministic flag", async () => {
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", undefined);
    vi.stubEnv("OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM", undefined);
    await expect(runLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir: temporaryDirectory() })).rejects.toThrow(/needs wavPath/);
  });
});
