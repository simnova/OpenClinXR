import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    emissiveFactor?: number[];
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
  selection: { chosen: string; meanAbsoluteError: Record<string, number> };
  rooms: Record<string, Record<string, {
    measurements: { "v4-flush-tile": {
      image: string;
      captureSha256: string;
      gapSeam: { gapPixels: number };
      repeatCapture: { image: string; captureSha256: string; meanAbsoluteChannelDifference: number };
    } };
  }>>;
};

describe("the shipped room ceiling cornice", () => {
  for (const room of rooms) {
    it(`${path.basename(room)} ships the ceiling-tile 24 mm flush profile`, () => {
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
      const edges = nodes.filter((node) => (node.name ?? "").startsWith("openclinxr_wall_edge_band_"));
      expect(edges).toHaveLength(4);
      for (const node of [...angles, ...edges]) {
        const mesh = glb.meshes?.[node.mesh ?? -1];
        expect(mesh).toBeDefined();
        for (const primitive of mesh?.primitives ?? []) {
          const material = glb.materials?.[primitive.material ?? -1];
          expect(material?.name).toBe("openclinxr_finish_ceiling_photo");
          expect(primitive.material).toBe(glb.meshes?.[tiles?.mesh ?? -1]?.primitives?.[0]?.material);
          expect((material?.emissiveFactor ?? [0, 0, 0]).every((value) => value === 0)).toBe(true);
        }
      }
      for (const node of angles) {
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
      root, "docs/openclinxr/room-realism/cornice-flush/measurements.json",
    ), "utf8")) as CorniceMeasurements;
    for (const poses of Object.values(evidence.rooms)) {
      for (const pose of Object.values(poses)) {
        expect(pose.measurements["v4-flush-tile"].gapSeam.gapPixels).toBe(0);
        expect(pose.measurements["v4-flush-tile"].repeatCapture.meanAbsoluteChannelDifference).toBeLessThan(0.5);
        for (const capture of [pose.measurements["v4-flush-tile"], pose.measurements["v4-flush-tile"].repeatCapture]) {
          expect(createHash("sha256").update(readFileSync(path.join(root, capture.image))).digest("hex")).toBe(capture.captureSha256);
        }
      }
    }
    expect(evidence.selection.chosen).toBe("v4-flush-tile");
    const scores = evidence.selection.meanAbsoluteError;
    expect(scores["v4-flush-tile"]).toBeLessThan(scores["v4-flush-wall"] ?? 0);
    expect(scores["v4-flush-tile"]).toBeLessThan(scores["v4-flush-tbar"] ?? 0);
  });

  it("preserves every original cornice A/B artifact byte-for-byte", () => {
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "8408b14f1", "docs/openclinxr/room-realism/cornice-ab"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      expect(readFileSync(path.join(root, file)).equals(execFileSync("git", ["show", `8408b14f1:${file}`], { cwd: root, maxBuffer: 10_000_000 })), file).toBe(true);
    }
  });
});
