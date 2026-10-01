import { readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const glb = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");
const budget = JSON.parse(readFileSync(path.join(root, "docs/openclinxr/room-realism/stepdown-room-v1-finish/budget.json"), "utf8"));

describe("the shipped stepdown room carries its data-driven clinical finish", () => {
  it("gives every primitive a material and emits the floor, cove, door, and troffer", async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glb);
    const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives.filter((primitive) => primitive.getMaterial() === null)).toEqual([]);
    const blackFlatMaterials = doc.getRoot().listMaterials().filter((material) =>
      material.getBaseColorTexture() === null
      && material.getBaseColorFactor().slice(0, 3).reduce((sum, channel) => sum + channel, 0) <= 0.01);
    expect(blackFlatMaterials.map((material) => material.getName())).toEqual([]);
    const names = doc.getRoot().listMeshes().map((mesh) => mesh.getName());
    for (const required of [
      "openclinxr_floor_field", "openclinxr_cove_", "openclinxr_door_glass",
      "openclinxr_door_casing_", "openclinxr_troffer_diffuser", "openclinxr_tbar_",
    ]) {
      expect(names.some((name) => name.includes(required)), `missing ${required}`).toBe(true);
    }
  });

  it("stays within the 56 MiB decoded RGBA budget", () => {
    expect(budget.materiallessPrimitives).toBe(0);
    expect(budget.decodedMiBWithMips).toBeLessThanOrEqual(56);
    expect(budget.sha256).toBe("78b3a762a32bfb8ada656fa816652ead3083546996ba76bf8fd9b9f983031c58");
  });
});
