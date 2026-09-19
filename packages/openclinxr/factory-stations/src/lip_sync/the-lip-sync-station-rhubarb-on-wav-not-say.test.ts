import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planLipSync, runLipSync } from "./run.js";
import { resolveLipSyncWavPath } from "../../../../../tools/openclinxr/dark-factory/multi-case-runner.js";

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
 * Do not invoke runLipSync here — that would shell say on this machine.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

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
    expect(runnerSrc).toMatch(/OPENCLINXR_LIP_SYNC_FIXTURE/);
    expect(runnerSrc).toMatch(/resolveLipSyncWavPath/);
  });

  it("(5) recorded *.wav already in outDir resolves as provided", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "lip-sync-outdir-wav-"));
    const dummy = join(outDir, "recorded-line.wav");
    await writeFile(dummy, "RIFF-dummy");
    delete process.env["OPENCLINXR_LIP_SYNC_FIXTURE"];
    const resolved = resolveLipSyncWavPath({ utterance: "hello", outDir });
    expect(resolved).toMatchObject({ kind: "provided", wavPath: dummy });
  });

  it("(4) missing wavPath without fixture flag throws", async () => {
    delete process.env["OPENCLINXR_LIP_SYNC_FIXTURE"];
    await expect(
      runLipSync({ actorId: "actor_a", visemeBank: "mpfb_phonemes" }, { utterance: "hi", outDir: "out", wavPath: "" }),
    ).rejects.toThrow(/wavPath/);
    const runnerSrc = readFileSync(
      join(SRC, "..", "..", "..", "..", "..", "tools", "openclinxr", "dark-factory", "multi-case-runner.ts"),
      "utf8",
    );
    const start = runnerSrc.indexOf("export function resolveLipSyncWavPath");
    expect(start).toBeGreaterThan(-1);
    const slice = runnerSrc.slice(start, start + 1200);
    expect(slice).toMatch(/fixtureWavPath/);
    expect(slice).toMatch(/throw new Error/);
  });
});
