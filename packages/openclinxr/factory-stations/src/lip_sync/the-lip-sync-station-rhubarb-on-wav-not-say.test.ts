import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planLipSync, runLipSync } from "./run.js";
import { writeLipSyncFixtureWav } from "@openclinxr/factory-stations";

/**
 * OBSERVABLE: runLipSync production path shells macOS `say` then afconvert then
 * Rhubarb. Direction 2026-09-02 DVA-4: Rhubarb runs on supplied wav / Grok unary
 * PCM; say is fixture-only.
 *
 * MEASURED 2026-09-02. lip_sync/run.ts:55 execFileAsync("say", ...).
 * LipSyncRunOptions is { utterance, outDir } with no wav path.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (DVA-4)
 * runLipSync takes wavPath and runs Rhubarb only. macOS TTS is writeLipSyncFixtureWav.
 *
 * ## FIXED (S4)
 * A recorded single *.wav already in outDir resolves as { kind: "provided" }
 * via readdirSync in resolveLipSyncWavPath; empty outDir still throws.
 *
 * MEASURED S6 2026-09-19. runLipSyncStage has no wav producer: S4
 * resolveLipSyncWavPath consumes a recorded wav but nothing writes one
 * (no Grok TTS in tree). A deterministic PCM sine is the local unary
 * stand-in for CI/dark-factory, behind OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM=1.
 *
 * ## FIXED (S6)
 * With OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM=1, runLipSyncStage writes a
 * deterministic PCM sine wav into stageDir before resolving; without the
 * flag an empty outDir still throws. writeDeterministicLipSyncWav writes
 * 16-bit mono 22050 Hz RIFF/WAVE bytes and never shells say/afconvert.
 *
 * ## FIXED (S7)
 * runLipSyncStage and runLipSyncStation share one fallback helper
 * (resolveLipSyncWavPathAllowingDeterministicPcm): same S6 PCM sine write
 * then resolve; unflagged empty outDir still throws in both.
 *
 * Do not invoke runLipSync here — that would shell say on this machine.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

// Clauses (5) and (6) spawn the real rhubarb binary: 4-6 s alone on this machine, longer under
// load. The vitest 5 s default timed them out on every factory-stations push.
const RHUBARB_SPAWN_TIMEOUT_MS = 60_000;

describe("the lip_sync station rhubarb on wav not say", () => {
  it("(0) COUNTERWEIGHT: planLipSync still names rhubarb as the baker", () => {
    const planned = planLipSync({ actorId: "actor_a", visemeBank: "mpfb_phonemes" });
    expect(planned).toMatchObject({ plan: { bakerId: "rhubarb", tool: "rhubarb" } });
    expect(typeof runLipSync).toBe("function");
    expect(runLipSync.toString().length).toBeGreaterThan(40);
  });

  it("(1) production runLipSync does not shell say", () => {
    expect(runLipSync.toString()).not.toMatch(/["']say["']/);
  });

  it("(2) LipSyncRunOptions accepts a wav path for the baker input", () => {
    const src = readFileSync(join(SRC, "run.ts"), "utf8");
    const start = src.indexOf("export type LipSyncRunOptions");
    const end = src.indexOf("export type LipSyncCue", start);
    const slice = src.slice(start, end === -1 ? undefined : end);
    expect(slice.length).toBeGreaterThan(20);
    expect(slice).toMatch(/wavPath|inputWav|audioPath/);
  });

  it("(3) runLipSyncStation with wavPath never defaults to writeLipSyncFixtureWav", () => {
    const runnerSrc = readFileSync(
      join(SRC, "..", "..", "..", "..", "..", "tools", "openclinxr", "dark-factory", "multi-case-runner.ts"),
      "utf8",
    );
    expect(runnerSrc).not.toMatch(/options\.wavPath\s*\?\?\s*\(?\s*await\s+writeLipSyncFixtureWav/);
    expect(readFileSync(join(SRC, "wav-input.ts"), "utf8")).toMatch(/OPENCLINXR_LIP_SYNC_FIXTURE/);
    expect(runnerSrc).toMatch(/runLipSyncStation/);
  });

  it("(5) recorded *.wav already in outDir resolves as provided", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "lip-sync-outdir-wav-"));
    const dummy = await writeLipSyncFixtureWav("hello", outDir);
    delete process.env["OPENCLINXR_LIP_SYNC_FIXTURE"];
    const result = await runLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir });
    expect(JSON.parse(readFileSync(result.manifestArtifactPath, "utf8"))).toMatchObject({ wavPath: dummy });
  }, RHUBARB_SPAWN_TIMEOUT_MS);

  it("(4) missing wavPath without fixture flag throws", async () => {
    delete process.env["OPENCLINXR_LIP_SYNC_FIXTURE"];
    delete process.env["OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM"];
    await expect(
      runLipSync({ actorId: "actor_a", visemeBank: "mpfb_phonemes" }, { utterance: "hi", outDir: "out", wavPath: "" }),
    ).rejects.toThrow(/wavPath/);
    const runnerSrc = readFileSync(
      join(SRC, "..", "..", "..", "..", "..", "tools", "openclinxr", "dark-factory", "multi-case-runner.ts"),
      "utf8",
    );
    const stationSrc = readFileSync(join(SRC, "wav-input.ts"), "utf8");
    const start = stationSrc.indexOf("function resolveLipSyncWavPath");
    expect(start).toBeGreaterThan(-1);
    const slice = stationSrc.slice(start, start + 1200);
    expect(slice).toMatch(/fixtureWavPath/);
    expect(slice).toMatch(/throw lipSyncWavInputError/);
    expect(slice).toMatch(/LIP_SYNC_EXPLICIT_BLANK_AUDIO/);
  });

  it("(6) PCM flag writes a RIFF/WAVE sine so resolve finds it; unflagged still throws", async () => {
    const helperSrc = readFileSync(join(SRC, "fixture-wav.ts"), "utf8");
    expect(helperSrc).toMatch(/RIFF/);
    expect(helperSrc).toMatch(/WAVE/);
    // Helper writes a .wav with RIFF/WAVE bytes synchronously; never shells say/afconvert.
    const detStart = helperSrc.indexOf("export function writeDeterministicLipSyncWav");
    expect(detStart).toBeGreaterThan(-1);
    const detSlice = helperSrc.slice(detStart, detStart + 2000);
    expect(detSlice).not.toMatch(/execFileAsync|say|afconvert/);
    const outDir = await mkdtemp(join(tmpdir(), "lip-sync-pcm-"));
    const wavPath = writeLipSyncFixtureWav("hello", outDir, { mode: "deterministic-pcm" });
    expect(wavPath.endsWith(".wav")).toBe(true);
    expect(readFileSync(wavPath, "utf8").slice(0, 4)).toBe("RIFF");
    delete process.env["OPENCLINXR_LIP_SYNC_FIXTURE"];
    const result = await runLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir });
    expect(JSON.parse(readFileSync(result.manifestArtifactPath, "utf8"))).toMatchObject({ wavPath });
    const runnerSrc = readFileSync(
      join(SRC, "..", "..", "..", "..", "..", "tools", "openclinxr", "dark-factory", "multi-case-runner.ts"),
      "utf8",
    );
    const stationSrc = readFileSync(join(SRC, "wav-input.ts"), "utf8");
    expect(stationSrc).toMatch(/OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM/);
    expect(stationSrc).toMatch(/writeDeterministicLipSyncWav/);
    expect(runnerSrc).toMatch(/runLipSyncStation/);
    // Unflagged path: empty outDir still throws.
    delete process.env["OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM"];
    const emptyDir = await mkdtemp(join(tmpdir(), "lip-sync-pcm-empty-"));
    await expect(runLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hi", outDir: emptyDir })).rejects.toThrow(/needs wavPath/);
  }, RHUBARB_SPAWN_TIMEOUT_MS);

  it("(7) PCM flag + empty outDir runs the real Rhubarb binary end to end", { timeout: 60000 }, async () => {
    // MEASURED S7 2026-09-19. Deterministic 440 Hz sine (~1.0 s) through
    // ~/.openclinxr-tools/rhubarb/rhubarb --exportFormat json returns
    // duration 1.00 s with 3 cues (X/C/X). No richness assertion.
    const { runLipSync: publicRunLipSync } = await import(
      "@openclinxr/factory-stations"
    );
    delete process.env["OPENCLINXR_LIP_SYNC_FIXTURE"];
    process.env["OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM"] = "1";
    try {
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-s7-e2e-"));
      const result = (await publicRunLipSync({ actorId: "lip_sync", visemeBank: "mpfb_phonemes" }, { utterance: "hello", outDir })) as {
        cues: Array<{ start: number; end: number; value: string }>;
        cueArtifactPath: string;
        manifestArtifactPath: string;
      };
      expect(existsSync(result.cueArtifactPath)).toBe(true);
      expect(existsSync(result.manifestArtifactPath)).toBe(true);
      expect(Array.isArray(result.cues)).toBe(true);
      expect(result.cues.length).toBeGreaterThan(0);
    } finally {
      delete process.env["OPENCLINXR_LIP_SYNC_DETERMINISTIC_PCM"];
    }
  });

  it("(8) explicit deterministic-pcm mode returns PCM bytes synchronously; default stays async system speech", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "lip-sync-fixture-mode-"));
    const wavPath: string = writeLipSyncFixtureWav("hello", outDir, { mode: "deterministic-pcm" });
    expect(typeof wavPath).toBe("string");
    expect(wavPath).toContain("deterministic-");
    expect(wavPath.endsWith(".wav")).toBe(true);
    expect(readFileSync(wavPath, "utf8").slice(0, 4)).toBe("RIFF");
    const again = writeLipSyncFixtureWav("hello", outDir, { mode: "deterministic-pcm" });
    expect(again).toBe(wavPath);
    const flag: { mode?: "deterministic-pcm" } = { mode: "deterministic-pcm" };
    const either: string | Promise<string> = writeLipSyncFixtureWav("hello", outDir, flag);
    expect(typeof either).toBe("string");
    const blocker = join(outDir, "blocker");
    await writeFile(blocker, "fixture-mode-blocker");
    const pending: Promise<string> = writeLipSyncFixtureWav("hello", blocker);
    expect(pending instanceof Promise).toBe(true);
    await expect(pending).rejects.toThrow();
  });
});
