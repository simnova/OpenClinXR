/**
 * Current-epoch stepdown finish proof (HEAD c7def44b, 2026-10-26).
 *
 * Reader/budget adopted to the honest new epoch in
 * docs/openclinxr/room-realism/stepdown-current-20261026/ (fresh HOST capture
 * via the shipped learner runtime URL, no GLB override). Every geometry/pixel
 * gate below is unchanged from the original cornice-flush proof; only the
 * reader/budget source paths moved. Historical cornice-flush records stay
 * byte-exact and are never repinned here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const epoch = path.join(root, "docs/openclinxr/room-realism/stepdown-current-20261026");
const glb = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");
const wardGlb = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");
const budget = JSON.parse(readFileSync(path.join(epoch, "current-stepdown-budget.json"), "utf8"));
const doorMeasurements = JSON.parse(readFileSync(path.join(epoch, "current-door-measurements.json"), "utf8"));

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

  it("stays within the 56 MiB decoded RGBA budget (current epoch c7def44b)", () => {
    expect(budget.materiallessPrimitives).toBe(0);
    expect(budget.decodedMiBWithMips).toBeLessThanOrEqual(56);
    expect(budget.sha256).toBe(createHash("sha256").update(readFileSync(glb)).digest("hex"));
    expect(budget.sha256).toBe("c7def44bda87d5d115d53c794f546ec6bf1b5ae655865f00df4262cdf538e6ab");
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

  it("matches the transom infill to the adjacent rendered wall (current capture f6860d5b)", () => {
    expect(doorMeasurements.current.infillVsWall.deltaRgb.every((channel: number) => Math.abs(channel) <= 3)).toBe(true);
    expect(doorMeasurements.current.infillVsWall.maximumBoundaryColumnStep).toBeLessThanOrEqual(4);
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
    expect(doorMeasurements.current.kickPlate.widthFractionOfLeaf).toBeGreaterThanOrEqual(0.9);
    expect(doorMeasurements.current.kickPlate.meanLuminance).toBeGreaterThanOrEqual(doorMeasurements.current.kickPlate.leafMeanLuminance);
    const capture = path.join(epoch, "captures/runtime-04-door-inside.png");
    expect(doorMeasurements.captureSha256).toBe(createHash("sha256").update(readFileSync(capture)).digest("hex"));
    expect(doorMeasurements.sourceGlbSha256).toBe(budget.sha256);
  });
});
