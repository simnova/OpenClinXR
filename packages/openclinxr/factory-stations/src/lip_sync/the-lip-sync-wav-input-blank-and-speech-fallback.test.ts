import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLipSync } from "@openclinxr/factory-stations";
import { resolveLipSyncWavPathAllowingDeterministicPcm } from "./wav-input.js";

/**
 * Narrow regression pins for the lip-sync producer contract (R1/R2).
 *
 * R1: an omitted wavPath with an explicit speech source must reach the
 * speech-synth step, not throw for missing audio first. Proved with a bogus
 * OPENCLINXR_KOKORO_PYTHON and an empty cache: any cache MISS fails fast
 * naming the speech-synth step, so a /speech-synth/ rejection proves the
 * resolver fell through to synthesis. No real synthesis runs.
 *
 * R2: an explicitly blank wavPath/fixtureWavPath is a caller error even
 * with OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM=1: the deterministic PCM
 * fallback must not mask it with a synthesized stand-in.
 */

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "lip-sync-r1r2-"));
  directories.push(directory);
  return directory;
}

function caughtMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function caughtCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code: unknown = (err as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

describe("lip-sync wav input blank and speech fallback", () => {
  it("R1: omitted wavPath with a speech source reaches synthesis, not the missing-audio throw", async () => {
    const cacheDir = temporaryDirectory();
    vi.stubEnv("OPENCLINXR_SPEECH_WAV_CACHE", cacheDir);
    vi.stubEnv("OPENCLINXR_KOKORO_PYTHON", join(cacheDir, "no-such-python"));
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", undefined);
    vi.stubEnv("OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM", undefined);
    await expect(
      runLipSync(
        { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
        {
          utterance: "hello",
          outDir: temporaryDirectory(),
          speech: { caseId: "c", actorId: "a", role: "patient", voiceId: "af_heart" },
        },
      ),
    ).rejects.toThrow(/speech-synth/);
  });

  it("R2: explicit blank wavPath stays a caller error with the deterministic PCM flag set", () => {
    const outDir = temporaryDirectory();
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", "1");
    vi.stubEnv("OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM", "1");
    let caught: unknown;
    try {
      resolveLipSyncWavPathAllowingDeterministicPcm({ utterance: "hello", outDir, wavPath: "" });
    } catch (err) {
      caught = err;
    }
    expect(caughtCode(caught)).toBe("LIP_SYNC_EXPLICIT_BLANK_AUDIO");
    expect(caughtMessage(caught)).toMatch(/wavPath is required/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("R2: explicit blank fixtureWavPath stays a caller error with the deterministic PCM flag set", () => {
    const outDir = temporaryDirectory();
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", undefined);
    vi.stubEnv("OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM", "1");
    let caught: unknown;
    try {
      resolveLipSyncWavPathAllowingDeterministicPcm({ utterance: "hello", outDir, fixtureWavPath: "" });
    } catch (err) {
      caught = err;
    }
    expect(caughtCode(caught)).toBe("LIP_SYNC_EXPLICIT_BLANK_AUDIO");
    expect(caughtMessage(caught)).toMatch(/wavPath is required/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("PCM fallback still writes the deterministic stand-in for genuinely missing audio", () => {
    const outDir = temporaryDirectory();
    vi.stubEnv("OPENCLINXR_LIP_SYNC_FIXTURE", undefined);
    vi.stubEnv("OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM", "1");
    const resolved = resolveLipSyncWavPathAllowingDeterministicPcm({ utterance: "hello", outDir });
    expect(resolved.kind).toBe("provided");
    expect(resolved.wavPath.endsWith(".wav")).toBe(true);
    expect(readdirSync(outDir)).toHaveLength(1);
  });
});
