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
  meshes?: Array<{ primitives?: Array<{ material?: number }> }>;
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: { baseColorFactor?: number[] };
  }>;
};

function jsonChunk(file: string): GlbJson {
  const bytes = readFileSync(path.join(root, file));
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
}

describe("the shipped room ceiling cornice", () => {
  for (const room of rooms) {
    it(`${path.basename(room)} replaces ceiling skirting with T-bar wall angle`, () => {
      const glb = jsonChunk(room);
      const nodes = glb.nodes ?? [];
      expect(nodes.some((node) => /skirting_ceiling|skirtingboard_ceiling/iu.test(node.name ?? "")))
        .toBe(false);
      const angles = nodes.filter((node) => (node.name ?? "").startsWith("openclinxr_wall_angle_"));
      expect(angles).toHaveLength(8);
      for (const node of angles) {
        const mesh = glb.meshes?.[node.mesh ?? -1];
        expect(mesh).toBeDefined();
        for (const primitive of mesh?.primitives ?? []) {
          const material = glb.materials?.[primitive.material ?? -1];
          expect(material?.name).toBe("openclinxr_finish_tbar");
          expect(material?.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3))
            .not.toEqual([0.313, 0.323, 0.352]);
        }
      }
      const floorCove = nodes.find((node) => (node.name ?? "").startsWith("openclinxr_cove_"));
      expect(floorCove, "the grey floor cove remains present").toBeDefined();
    });
  }
});
