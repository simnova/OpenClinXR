import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

/**
 * A crashed Blender pass must leave its FULL log on disk at the point of
 * failure, not just the truncated tail in the thrown error.
 *
 * Measured 2026-09-28: runRoomGenerate captures each pass's full
 * stdout/stderr in memory but throws with only the last 2000 characters of
 * stderr, returning nothing. room_chain's own per-stage log persistence only
 * runs after a successful return, so on a real crash the full stdout and
 * everything before the tail is discarded and never reaches disk.
 * Diagnosing a crash required replaying the GLB outside the pipeline.
 *
 * This test reuses the invalid-GLB pattern from
 * the-spawn-blender-fails-closed-on-python-exceptions.test.ts: a file that
 * EXISTS but is not valid glTF, so bpy.ops.import_scene.gltf itself raises
 * inside Blender, not a TypeScript-side check ahead of the spawn. It asserts
 * (1) the promise rejects, (2) the albedo stderr log file exists on disk,
 * and (3) its contents hold the Blender traceback line ("Bad glTF"),
 * proving the full log survived rather than the truncated slice.
 */
describe("runRoomGenerate persists the full Blender log when a pass fails", () => {
  it("writes the albedo stderr log before throwing on an invalid GLB", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-generate-log-persist-"));
    const invalidGlb = path.join(work, "invalid.glb");
    writeFileSync(invalidGlb, "this is not a valid glb file", "utf8");
    const stderrLog = path.join(work, "invalid.albedo.stderr.log");

    let error: unknown = null;
    try {
      await runRoomGenerate(
        {
          environmentId: "ed_exam_bay_v1",
          infinigenPrompt: "unused (legacy call shape, no footprintMeters)",
          seed: 1,
          layoutVariant: "default",
        },
        {
          blender: "blender",
          workGlb: invalidGlb,
          bakeAlbedo: true,
          bakeOcclusion: false,
          simplifyAfterBake: false,
          cwd: work,
          timeoutMs: 300_000,
        },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    const persisted = readFileSync(stderrLog, "utf8");
    expect(persisted).toContain("Bad glTF");
    expect((error as Error).message).toContain(stderrLog);
  }, 300_000);
});
