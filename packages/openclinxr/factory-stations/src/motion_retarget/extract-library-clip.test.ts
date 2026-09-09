import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractLibraryClip } from "./extract-library-clip.js";

/**
 * The extraction step has a caller.
 *
 * `extract-library-clip.ts` landed with SC-04 and produced the shipped `Walk_Formal` bind, and
 * nothing imported it — knip's unused-file check caught that at integration, which is the
 * correct-but-inert class this repo keeps re-paying for: a pipeline step that ran once by hand and
 * was then described in prose rather than wired. This is its caller, and it exercises the two
 * refusals that are the whole reason the tool exists rather than only the happy path.
 *
 * THE DEFECT IT GUARDS, measured 2026-08-21 and re-measured 2026-09-09. The Mesh2Motion human
 * library is one GLB carrying 87 animations against a single rig, and Blender's glTF importer
 * STACKS them: after importing the raw library the active action was `Chest_Open`, so a bind run
 * against the library binds whichever clip the importer left active — the wrong motion, silently,
 * with a correct-looking report.
 *
 * MACHINE DEPENDENCY, stated rather than skipped around. The library is an approved local clone at
 * `~/.openclinxr-tools/mesh2motion-app`. When it is absent this suite FAILS with that path named,
 * because a silent skip would make the gate green on the machine least able to prove it.
 */

const LIBRARY = path.join(
  process.env["HOME"] ?? "",
  ".openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb",
);

/** The clip SC-04 shipped. Its licence is row-05; this file makes no licence claim. */
const SHIPPED_CLIP = "Walk_Formal";

let workDirectory = "";

beforeAll(async () => {
  workDirectory = await mkdtemp(path.join(tmpdir(), "extract-library-clip-"));
});

afterAll(async () => {
  if (workDirectory) await rm(workDirectory, { recursive: true, force: true });
});

describe("one clip is isolated from a stacked animation library", () => {
  it("(1) the library this project extracts from is present, and it is the stacked one", async () => {
    expect(
      existsSync(LIBRARY),
      `the Mesh2Motion clip library is missing at ${LIBRARY}; clone it before running this suite rather than skipping the check`,
    ).toBe(true);
    const report = await extractLibraryClip({
      libraryPath: LIBRARY,
      clipName: SHIPPED_CLIP,
      outputPath: path.join(workDirectory, "probe.glb"),
    });
    // The stacking hazard is a property of this file: many clips, one rig.
    expect(report.source.clipCount).toBeGreaterThan(50);
    expect(report.source.clipNames).toContain(SHIPPED_CLIP);
  });

  it("(2) exactly ONE animation survives, and it is the one asked for", async () => {
    const outputPath = path.join(workDirectory, "walk-formal.glb");
    const report = await extractLibraryClip({
      libraryPath: LIBRARY,
      clipName: SHIPPED_CLIP,
      outputPath,
    });
    expect(report.output.animationsAfter).toEqual([SHIPPED_CLIP]);
    expect(report.clip.name).toBe(SHIPPED_CLIP);
    expect(report.clip.channels).toBeGreaterThan(0);
    expect(report.clip.joints).toBeGreaterThan(0);
    // The bytes exist and the report names them, so a later step can hash what it consumed.
    const written = await readFile(outputPath);
    expect(written.byteLength).toBe(report.output.bytes);
    expect(written.byteLength).toBeGreaterThan(0);
    expect(written.byteLength).toBeLessThan(report.source.bytes);
  });

  it("(3) it is an IN-PLACE cycle, which is why the bind needs a separate ground advance", async () => {
    // Recorded because it is the reason SC-04 had to write a new foot-plant instrument: the
    // existing one divides by the clip's own root travel, and this clip's is zero.
    const report = await extractLibraryClip({
      libraryPath: LIBRARY,
      clipName: SHIPPED_CLIP,
      outputPath: path.join(workDirectory, "in-place.glb"),
    });
    expect(report.clip.rootTranslationNetMeters).toBeCloseTo(0, 6);
  });

  it("(4) REFUSAL: an unknown clip name is refused and the library's contents are listed", async () => {
    await expect(
      extractLibraryClip({
        libraryPath: LIBRARY,
        clipName: "Walk_Formal_v2_final",
        outputPath: path.join(workDirectory, "never-written.glb"),
      }),
    ).rejects.toThrow(/has no clip named Walk_Formal_v2_final/u);
    // The listing is the useful half: a caller that mistyped a name needs to see the real ones.
    await expect(
      extractLibraryClip({
        libraryPath: LIBRARY,
        clipName: "Walk_Formal_v2_final",
        outputPath: path.join(workDirectory, "never-written.glb"),
      }),
    ).rejects.toThrow(new RegExp(SHIPPED_CLIP, "u"));
    expect(existsSync(path.join(workDirectory, "never-written.glb"))).toBe(false);
  });

  it("(5) REFUSAL: an absent library is refused rather than reported as an empty extraction", async () => {
    await expect(
      extractLibraryClip({
        libraryPath: path.join(workDirectory, "no-such-library.glb"),
        clipName: SHIPPED_CLIP,
        outputPath: path.join(workDirectory, "never-written-2.glb"),
      }),
    ).rejects.toThrow();
    expect(existsSync(path.join(workDirectory, "never-written-2.glb"))).toBe(false);
  });
});
