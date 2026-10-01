import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const glb = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");
const wardGlb = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");
const budget = JSON.parse(readFileSync(path.join(root, "docs/openclinxr/room-realism/stepdown-room-v1-finish/budget.json"), "utf8"));
const doorMeasurements = JSON.parse(readFileSync(path.join(root, "docs/openclinxr/room-realism/stepdown-room-v1-finish/door-reference-measurements.json"), "utf8"));

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
      "openclinxr_door_kick_plate",
    ]) {
      expect(names.some((name) => name.includes(required)), `missing ${required}`).toBe(true);
    }
  });

  it("stays within the 56 MiB decoded RGBA budget", () => {
    expect(budget.materiallessPrimitives).toBe(0);
    expect(budget.decodedMiBWithMips).toBeLessThanOrEqual(56);
    expect(budget.sha256).toBe(createHash("sha256").update(readFileSync(glb)).digest("hex"));
  });

  it("closes only the declared stepdown transom, flush to the shell wall", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const stepdown = await io.read(glb);
    const ward = await io.read(wardGlb);
    const transom = stepdown.getRoot().listNodes().find((node) => node.getName() === "openclinxr_door_transom_infill");
    expect(transom, "stepdown transom infill node").toBeDefined();
    expect(ward.getRoot().listNodes().some((node) => node.getName().includes("door_transom"))).toBe(false);
    expect(ward.getRoot().listNodes().some((node) => node.getName().includes("door_kick_plate"))).toBe(false);
    expect(transom!.getMesh()!.listPrimitives()[0]!.getMaterial()!.getName()).toBe("openclinxr_finish_transom_wall");

    const transomPlane = getBounds(transom!).max[2];
    const wall = stepdown.getRoot().listNodes().find((node) => node.getName() === "bedroom_0/0.wall")!;
    const wallPosition = wall.getMesh()!.listPrimitives()[0]!.getAttribute("POSITION")!.getArray()!;
    const world = wall.getWorldMatrix();
    const worldZ = Array.from({ length: wallPosition.length / 3 }, (_, vertex) => {
      const offset = vertex * 3;
      const x = Number(wallPosition[offset]);
      const y = Number(wallPosition[offset + 1]);
      const z = Number(wallPosition[offset + 2]);
      return world[2] * x + world[6] * y + world[10] * z + world[14];
    });
    const nearbyWallPlanes = worldZ
      .filter((value) => Math.abs(value - transomPlane) < 0.2);
    const nearestWallPlane = nearbyWallPlanes.reduce((nearest, value) =>
      Math.abs(value - transomPlane) < Math.abs(nearest - transomPlane) ? value : nearest);
    expect(Math.abs(transomPlane - nearestWallPlane)).toBeLessThanOrEqual(0.005);
  });

  it("matches the transom infill to the adjacent rendered wall", () => {
    expect(doorMeasurements.after.infillVsWall.deltaRgb.every((channel: number) => Math.abs(channel) <= 3)).toBe(true);
    expect(doorMeasurements.after.infillVsWall.maximumBoundaryColumnStep).toBeLessThanOrEqual(4);
  });

  it("keeps the stainless kick plate full-width, 250 mm tall, and flush to the facing", async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glb);
    const nodes = doc.getRoot().listNodes();
    const plate = nodes.find((node) => node.getName() === "openclinxr_door_kick_plate")!;
    const leaf = nodes.find((node) => node.getName().endsWith(".door_leaf"))!;
    const facing = nodes.find((node) => node.getName() === "openclinxr_door_face_south_1")!;
    const p = getBounds(plate), l = getBounds(leaf), f = getBounds(facing);
    expect((p.max[0] - p.min[0]) / (l.max[0] - l.min[0])).toBeGreaterThanOrEqual(0.9);
    expect(p.min[0] - l.min[0]).toBeCloseTo(0.015, 4);
    expect(l.max[0] - p.max[0]).toBeCloseTo(0.015, 4);
    expect(p.max[1] - p.min[1]).toBeCloseTo(0.25, 4);
    expect(p.max[2] - f.max[2]).toBeGreaterThan(0);
    expect(p.max[2] - f.max[2]).toBeLessThanOrEqual(0.002001);
    const material = plate.getMesh()!.listPrimitives()[0]!.getMaterial()!;
    expect(material.getMetallicFactor()).toBeCloseTo(1);
    expect(material.getRoughnessFactor()).toBeCloseTo(0.35);
    expect(material.getBaseColorFactor().slice(0, 3).every((channel) => channel >= 0.75)).toBe(true);
    expect(doorMeasurements.after.kickPlate.widthFractionOfLeaf).toBeGreaterThanOrEqual(0.9);
    expect(doorMeasurements.after.kickPlate.meanLuminance).toBeGreaterThanOrEqual(doorMeasurements.after.kickPlate.leafMeanLuminance);
    const capture = path.join(root, "docs/openclinxr/room-realism/stepdown-room-v1-finish/after/runtime-04-door-inside.png");
    expect(doorMeasurements.after.captureSha256).toBe(createHash("sha256").update(readFileSync(capture)).digest("hex"));
    expect(doorMeasurements.sourceGlbSha256).toBe(budget.sha256);
  });
});
