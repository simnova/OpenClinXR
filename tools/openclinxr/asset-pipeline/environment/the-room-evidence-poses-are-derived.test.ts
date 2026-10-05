import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOM_CHAIN_RECIPES } from "@openclinxr/factory-stations/room-chain";
import { describe, expect, it } from "vitest";
import { deriveRoomEvidencePosesFromGeometry, type RoomEvidencePoseArtifact } from "./derive-room-evidence-poses.js";

const feature = (min: [number, number, number], max: [number, number, number], node: string) => ({ min, max, nodes: [node] });
const features: RoomEvidencePoseArtifact["featureBounds"] = {
  doorWithCasing: feature([-0.29, 0, -1.975], [0.79, 2.155, -1.524], "door+casing"),
  troffer: feature([-0.6, 2.527, -0.6], [0.6, 2.539, 0], "troffer"),
  tbar: feature([-3.21, 2.537, -1.975], [3.21, 2.558, 1.815], "tbar"),
  cove: feature([-3.1, 0.003, -1.563], [3.1, 0.103, 1.723], "cove"),
};

describe("room evidence pose derivation", () => {
  it("is deterministic for the same GLB geometry and recipe", () => {
    const derive = () => deriveRoomEvidencePosesFromGeometry(ROOM_CHAIN_RECIPES.stepdown_room_v1, "room.glb", "abc", features);
    expect(derive()).toEqual(derive());
  });

  it("keeps every eye at least 0.30 m from all four walls", () => {
    const artifact = deriveRoomEvidencePosesFromGeometry(ROOM_CHAIN_RECIPES.stepdown_room_v1, "room.glb", "abc", features);
    expect(artifact.poses.filter((pose) => pose.id !== "runtime-06-floor-base").every((pose) => pose.eye[1] === 1.6)).toBe(true);
    expect(Object.values(artifact.clearanceM).every((row) => row.minimum >= 0.3)).toBe(true);
  });

  it("keeps every ward subject within five percentage points of its hand-placed capture", () => {
    const reportPath = path.resolve(import.meta.dirname, "../../../../docs/openclinxr/room-realism/stepdown-room-v1-finish/pose-proof.json");
    const proof = JSON.parse(readFileSync(reportPath, "utf8")) as { ward: Record<string, { deltaPercentagePoints: number; passed: boolean }> };
    expect(Object.values(proof.ward)).toHaveLength(6);
    for (const row of Object.values(proof.ward)) {
      expect(Math.abs(row.deltaPercentagePoints)).toBeLessThanOrEqual(5);
      expect(row.passed).toBe(true);
    }
  });
});
