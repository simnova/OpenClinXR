import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

/**
 * A timeout kill must report as a timeout, not a generic crash exit.
 *
 * Measured 2026-09-28: a real chain albedo bake took 757 s against the
 * 600 s per-pass budget, so spawn-blender.ts's timer SIGTERMed a Blender
 * that had already finished its work, and the close handler mapped the
 * signal-killed `code: null` to a fake `1` -- indistinguishable from a
 * real Python crash ("exit 1").
 *
 * This test drives the REAL spawnBlenderProcess through the public
 * runRoomGenerate route: the "blender" binary is a sleep script that runs
 * longer (10 s) than the configured timeout (1 s), so the internal timer
 * must fire. The rejection must say "timed out", never a bare "exit 1".
 */
describe("runRoomGenerate reports a timeout kill as a timeout", () => {
  it("rejects with timed out after 1 s when the bake exceeds its timeout", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-generate-timeout-"));
    const fakeBlender = path.join(work, "fake-blender.mjs");
    writeFileSync(
      fakeBlender,
      `#!/usr/bin/env node\nawait new Promise((resolve) => setTimeout(resolve, 10_000));\n`,
      "utf8",
    );
    chmodSync(fakeBlender, 0o755);
    const workGlb = path.join(work, "work.glb");

    const error: unknown = await runRoomGenerate(
      {
        environmentId: "ed_exam_bay_v1",
        infinigenPrompt: "unused (legacy call shape, no footprintMeters)",
        seed: 1,
        layoutVariant: "default",
      },
      {
        blender: fakeBlender,
        workGlb,
        bakeAlbedo: true,
        bakeOcclusion: false,
        simplifyAfterBake: false,
        cwd: work,
        timeoutMs: 1_000,
      },
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/timed out/i);
    expect(message).toMatch(/1 s/);
    expect(message).not.toMatch(/failed with exit 1/);
  }, 60_000);
});
