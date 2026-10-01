import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const rooms = [
  "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
] as const;

type GlbJson = {
  nodes?: Array<{ name?: string; mesh?: number }>;
  meshes?: Array<{ primitives?: Array<{ material?: number; attributes?: { POSITION?: number } }> }>;
  accessors?: Array<{ min?: number[]; max?: number[] }>;
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: { baseColorFactor?: number[] };
  }>;
};

function nodeBounds(glb: GlbJson, node: { mesh?: number }): { min: number[]; max: number[] } {
  const positions = (glb.meshes?.[node.mesh ?? -1]?.primitives ?? []).flatMap((primitive) => {
    const accessor = glb.accessors?.[primitive.attributes?.POSITION ?? -1];
    return accessor?.min && accessor.max ? [{ min: accessor.min, max: accessor.max }] : [];
  });
  expect(positions.length).toBeGreaterThan(0);
  return {
    min: [0, 1, 2].map((axis) => Math.min(...positions.map((position) => position.min[axis] ?? Infinity))),
    max: [0, 1, 2].map((axis) => Math.max(...positions.map((position) => position.max[axis] ?? -Infinity))),
  };
}

function jsonChunk(file: string): GlbJson {
  const bytes = readFileSync(path.join(root, file));
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
}

type CorniceMeasurements = {
  rooms: Record<string, Record<string, {
    measurements: { "v4-flush": {
      gapSeam: { gapPixels: number };
      repeatCapture: { meanAbsoluteChannelDifference: number };
    } };
  }>>;
};

describe("the shipped room ceiling cornice", () => {
  for (const room of rooms) {
    it(`${path.basename(room)} ships the wall-material 24 mm flush profile`, () => {
      const glb = jsonChunk(room);
      const nodes = glb.nodes ?? [];
      expect(nodes.some((node) => /skirting_ceiling|skirtingboard_ceiling/iu.test(node.name ?? "")))
        .toBe(false);
      const angles = nodes.filter((node) => (node.name ?? "").startsWith("openclinxr_wall_angle_"));
      expect(angles).toHaveLength(8);
      const tiles = nodes.find((node) => node.name === "openclinxr_ceiling_tiles");
      expect(tiles).toBeDefined();
      // Blender Z exports as glTF Y. The tile underside is the minimum Y.
      const tileFaceY = nodeBounds(glb, tiles!).min[1] ?? NaN;
      for (const node of angles) {
        const mesh = glb.meshes?.[node.mesh ?? -1];
        expect(mesh).toBeDefined();
        for (const primitive of mesh?.primitives ?? []) {
          const material = glb.materials?.[primitive.material ?? -1];
          expect(material?.name).toBe("openclinxr_finish_wall");
        }
        const bounds = nodeBounds(glb, node);
        const belowTileMm = (tileFaceY - (bounds.min[1] ?? NaN)) * 1000;
        if (node.name?.endsWith("_horizontal")) {
          const dimensionsMm = bounds.max.map((value, axis) => (value - (bounds.min[axis] ?? value)) * 1000);
          expect(Math.max(dimensionsMm[0] ?? 0, dimensionsMm[2] ?? 0)).toBeGreaterThan(1_000);
          expect(Math.min(...dimensionsMm.filter((dimension) => dimension > 4))).toBeCloseTo(24, 1);
          expect(Math.abs(belowTileMm)).toBeLessThanOrEqual(1);
        } else {
          expect(belowTileMm).toBeLessThanOrEqual(3.01);
        }
      }
      const floorCove = nodes.find((node) => (node.name ?? "").startsWith("openclinxr_cove_"));
      expect(floorCove, "the grey floor cove remains present").toBeDefined();
    });
  }

  it("has zero continuous gap pixels and no repeat-capture flicker", () => {
    const evidence = JSON.parse(readFileSync(path.join(
      root, "docs/openclinxr/room-realism/cornice-ab/measurements.json",
    ), "utf8")) as CorniceMeasurements;
    for (const poses of Object.values(evidence.rooms)) {
      for (const pose of Object.values(poses)) {
        expect(pose.measurements["v4-flush"].gapSeam.gapPixels).toBe(0);
        expect(pose.measurements["v4-flush"].repeatCapture.meanAbsoluteChannelDifference).toBeLessThan(0.5);
      }
    }
  });
});
