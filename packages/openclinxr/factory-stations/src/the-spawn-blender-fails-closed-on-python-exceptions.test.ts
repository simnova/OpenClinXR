import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots/slots";
import { describe, expect, it } from "vitest";
import { runRoomGenerate } from "./index.js";

/**
 * Blender must exit non-zero on an uncaught Python exception (S1 fail-closed).
 *
 * Measured 2026-09-27 on Blender 5.1.1: a script that raises partway through
 * exits 0 by default, so the albedo pass's link-failure RuntimeError never
 * surfaced and the occlusion pass's output overwrote the evidence. The first
 * case below pins that upstream default (raw spawn, no flag -> exit 0, no
 * package import needed to show it).
 *
 * The second case pins BOTH halves of S1 through the public entrypoint
 * (runRoomGenerate), not spawnBlenderProcess directly: the albedo script is
 * pointed at a file that EXISTS but is not a valid glTF, so
 * `bpy.ops.import_scene.gltf` itself raises inside Blender (confirmed by
 * reading the Blender log: "RuntimeError: Error: Bad glTF: json error:
 * Expecting value: line 1 column 1 (char 0)" -- not a missing-file check
 * that TypeScript would catch before ever spawning Blender). With S1's fix
 * (spawnBlenderProcess passing --python-exit-code 1), Blender exits
 * non-zero and runRoomGenerate's own `if (albedoExit !== 0) throw` fires,
 * so the promise rejects. Without the fix, Blender would exit 0 on the same
 * raise and runRoomGenerate would resolve normally -- confirmed by a
 * destructive probe (temporarily removing --python-exit-code 1 from
 * spawn-blender.ts) recorded in the S1 case-2 commit.
 */

const execFileAsync = promisify(execFile);

const RAISING_PROBE = `import sys
print("exit-code probe: about to raise")
raise RuntimeError("deliberate probe exception (S1 exit-code RED/GREEN)")
`;

describe("spawnBlenderProcess exits non-zero on an uncaught Python exception", () => {
  it("raw Blender without the flag exits 0 despite the raise (upstream default)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "blender-exit-probe-"));
    const probe = path.join(work, "raising_probe.py");
    writeFileSync(probe, RAISING_PROBE, "utf8");
    const result = await withComputeSlot("blender", { label: "test:raw-blender-python-exit" }, () => execFileAsync("blender", ["--background", "--python", probe], {
      timeout: 300_000,
    }));
    expect(result.stderr).toContain("deliberate probe exception");
  }, 300_000);

  it("runRoomGenerate rejects when the albedo pass raises inside Blender (both S1 halves)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-generate-exit-probe-"));
    const invalidGlb = path.join(work, "invalid.glb");
    // Exists, but is not valid glTF: bpy.ops.import_scene.gltf raises a
    // RuntimeError on it, not a missing-file check ahead of the spawn.
    writeFileSync(invalidGlb, "this is not a valid glb file", "utf8");
    await expect(
      runRoomGenerate(
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
      ),
    ).rejects.toThrow(/room albedo bake failed/);
  }, 300_000);
});
