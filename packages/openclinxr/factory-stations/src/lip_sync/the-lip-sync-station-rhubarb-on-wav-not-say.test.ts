import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planLipSync, runLipSync } from "./run.js";

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
});
