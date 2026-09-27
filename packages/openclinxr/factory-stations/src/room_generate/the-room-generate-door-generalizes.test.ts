import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

/**
 * Door-generalization RED: TWO separate real runs with different doorWall
 * values (+y control + -x generalization leg) each produce a door on the
 * REQUESTED wall at the REQUESTED offset within 0.02 m (casing centroid via
 * the station probe; the entrance-cutter remnant corroborates). The -x leg
 * is the proof: upstream max_mls always picked a long (+y/-y) wall, so a
 * short-wall door cannot pass without the wall-select generalization.
 *
 * LIVE-gated like the footprint RED:
 *   OPENCLINXR_ROOM_GENERATE_LIVE=1 pnpm vitest run src/room_generate/
 */

const LIVE = process.env["OPENCLINXR_ROOM_GENERATE_LIVE"] === "1";
const BLENDER = process.env["OPENCLINXR_BLENDER"] ?? "blender";

type DoorCase = {
  name: string;
  seed: number;
  door: Record<string, unknown>;
  wantWall: string;
  wantOffsetM: number;
};

const CASES: DoorCase[] = [
  {
    name: "+y control at +0.50",
    seed: 203,
    door: { doorWall: "+y", wallOffsetM: 0.5, hingeSide: "+x", widthM: 0.95, heightM: 2.1 },
    wantWall: "+y",
    wantOffsetM: 0.5,
  },
  {
    name: "-x generalization at -1.00",
    seed: 204,
    door: { doorWall: "-x", wallOffsetM: -1.0, hingeSide: "+x", widthM: 0.95, heightM: 2.1 },
    wantWall: "-x",
    wantOffsetM: -1.0,
  },
];

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "room-generate-door-"));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe.skipIf(!LIVE)("the room generate door generalizes", () => {
  for (const [index, doorCase] of CASES.entries()) {
    it(
      `door lands on ${doorCase.name}`,
      { timeout: 1_800_000 },
      async () => {
        const workGlb = path.join(workDir, `door-${index}.glb`);
        const report = await runRoomGenerate(
          {
            environmentId: "exam_bay_v1",
            infinigenPrompt: "clinical single room",
            seed: doorCase.seed,
            layoutVariant: "single",
            footprintMeters: { width: 8.77, depth: 7.77, ceilingHeight: 2.42 },
            door: doorCase.door,
          },
          {
            blender: BLENDER,
            workGlb,
            bakeAlbedo: false,
            bakeOcclusion: false,
            simplifyAfterBake: false,
          },
        );
        expect(report["seed"]).toBe(doorCase.seed);
        const generate = report["generate"] as Record<string, unknown> | null;
        expect(generate).not.toBeNull();
        const probe = generate?.["probe"] as Record<string, unknown>;
        const placement = probe["doorPlacement"] as { wall: string; offsetM: number };
        expect(placement.wall).toBe(doorCase.wantWall);
        expect(Math.abs(placement.offsetM - doorCase.wantOffsetM)).toBeLessThanOrEqual(0.02);
      },
    );
  }
});

describe.skipIf(LIVE)("the room generate door generalizes", () => {
  it("skips without OPENCLINXR_ROOM_GENERATE_LIVE=1", () => {
    expect(LIVE).toBe(false);
  });
});
