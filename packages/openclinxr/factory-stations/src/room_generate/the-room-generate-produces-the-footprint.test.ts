import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

/**
 * Footprint RED: a REAL run through the GENERATE step (venv Infinigen, wall
 * clock minutes) with footprintMeters 8.77 x 7.77 x 2.42 produces a workGlb
 * whose INTERIOR clear floor (wall inner faces, via the station probe --
 * the floor slab overreads depth through the doorway threshold, measured
 * 7.88 vs 7.77) lands within 0.02 m per side. The shell-only extract proving
 * the end-to-end plumbing (workGlb + predicate file) is asserted alongside.
 *
 * LIVE-gated (needs the Infinigen venv + Blender, minutes per run):
 *   OPENCLINXR_ROOM_GENERATE_LIVE=1 pnpm vitest run src/room_generate/
 * Without the var the suite skips with a reason instead of burning CI.
 */

const LIVE = process.env["OPENCLINXR_ROOM_GENERATE_LIVE"] === "1";
const BLENDER = process.env["OPENCLINXR_BLENDER"] ?? "blender";

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "room-generate-footprint-"));
});

afterAll(async () => {
  if (workDir && process.env["OPENCLINXR_KEEP_TMP"] !== "1") {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe.skipIf(!LIVE)("the room generate produces the footprint", () => {
  it(
    "8.77 x 7.77 interior within 0.02 m via a real Infinigen run",
    { timeout: 1_800_000 },
    async () => {
      const workGlb = path.join(workDir, "footprint.glb");
      const report = await runRoomGenerate(
        {
          environmentId: "exam_bay_v1",
          infinigenPrompt: "clinical single room",
          seed: 203,
          layoutVariant: "single",
          footprintMeters: { width: 8.77, depth: 7.77, ceilingHeight: 2.42 },
          door: { doorWall: "+y", wallOffsetM: 0.5, hingeSide: "+x", widthM: 0.95, heightM: 2.1 },
        },
        {
          blender: BLENDER,
          workGlb,
          bakeAlbedo: false,
          bakeOcclusion: false,
          simplifyAfterBake: false,
        },
      );
      expect(report["seed"]).toBe(203);
      const generate = report["generate"] as Record<string, unknown> | null;
      expect(generate).not.toBeNull();
      expect(generate?.["seed"]).toBe(203);
      expect(existsSync(workGlb)).toBe(true);
      expect(existsSync(String(generate?.["predicatePath"]))).toBe(true);
      const summary = generate?.["extractSummary"] as Record<string, unknown>;
      expect(Number(summary["meshCount"])).toBeGreaterThanOrEqual(4);
      const probe = generate?.["probe"] as Record<string, Record<string, number>>;
      const clear = probe["interiorClear"] as unknown as { width: number; depth: number };
      expect(Math.abs(clear.width - 8.77)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(clear.depth - 7.77)).toBeLessThanOrEqual(0.02);
      const predicate = JSON.parse(
        readFileSync(String(generate?.["predicatePath"]), "utf8"),
      ) as { measures: { ceilingHeightM: number } };
      expect(Math.abs(predicate.measures.ceilingHeightM - 2.42)).toBeLessThanOrEqual(0.05);
    },
  );
});

describe.skipIf(LIVE)("the room generate produces the footprint", () => {
  it("skips without OPENCLINXR_ROOM_GENERATE_LIVE=1", () => {
    expect(LIVE).toBe(false);
  });
});
