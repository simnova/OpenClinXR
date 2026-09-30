import path from "node:path";
import { inflateSync } from "node:zlib";
import { NodeIO, type Document, type Node } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { beforeAll, describe, expect, it } from "vitest";

const SHIPPED = path.resolve(
  process.cwd(),
  "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
);

let document: Document;

function transformPoint(point: number[], matrix: number[]): number[] {
  const [x, y, z] = point as [number, number, number];
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ];
}

function decodeRgbPng(bytes: Uint8Array): Uint8Array {
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8], "glass PNG must be 8-bit").toBe(8);
      expect(data[9], "glass PNG must be RGB").toBe(2);
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const output = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = packed[y * (stride + 1)]!;
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[y * (stride + 1) + 1 + x]!;
      const left = x >= 3 ? output[y * stride + x - 3]! : 0;
      const up = y > 0 ? output[(y - 1) * stride + x]! : 0;
      const upperLeft = y > 0 && x >= 3 ? output[(y - 1) * stride + x - 3]! : 0;
      const predictor =
        filter === 0 ? 0
        : filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
        : paeth(left, up, upperLeft);
      output[y * stride + x] = (raw + predictor) & 0xff;
    }
  }
  return output;
}

function worldBounds(node: Node): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const matrix = node.getWorldMatrix();
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const positions = primitive.getAttribute("POSITION");
    if (!positions) continue;
    for (let index = 0; index < positions.getCount(); index += 1) {
      const local = positions.getElement(index, [] as number[]);
      const world = transformPoint(local, matrix);
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, world[axis]!);
        max[axis] = Math.max(max[axis]!, world[axis]!);
      }
    }
  }
  return { min, max };
}

describe("the shipped ward door has finished surfaces", () => {
  beforeAll(async () => {
    document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(SHIPPED);
  });

  it("keeps both jamb faces and the head proud of the room-side wall plane", () => {
    const nodes = document.getRoot().listNodes();
    const casing = nodes.filter((node) => node.getName().startsWith("openclinxr_door_casing_"));
    expect(casing.map((node) => node.getName()).sort()).toEqual([
      "openclinxr_door_casing_head",
      "openclinxr_door_casing_jamb_left",
      "openclinxr_door_casing_jamb_right",
    ]);
    const wall = nodes.find((node) => node.getName() === "bedroom_0/0.wall");
    expect(wall).toBeDefined();
    const wallBounds = worldBounds(wall!);
    // The door is on the negative-Z wall. Its room face is the larger of
    // the two negative-Z wall planes; exclude unrelated wall vertices.
    const wallPositions = wall!.getMesh()!.listPrimitives()[0]!.getAttribute("POSITION")!;
    const matrix = wall!.getWorldMatrix();
    const doorWallZ: number[] = [];
    for (let index = 0; index < wallPositions.getCount(); index += 1) {
      const world = transformPoint(wallPositions.getElement(index, [] as number[]), matrix);
      if (world[0] > -0.5 && world[0] < 1 && world[1] > 0 && world[1] < 2.3 && world[2] < -1.5) {
        doorWallZ.push(world[2]);
      }
    }
    expect(wallBounds.max[2]).toBeGreaterThan(1); // counterweight: this is the combined four-wall mesh.
    const roomSideWallZ = Math.max(...doorWallZ);
    for (const node of casing) {
      const bounds = worldBounds(node);
      expect(bounds.max[2], `${node.getName()} must stand proud of the wall`).toBeGreaterThan(
        roomSideWallZ + 0.015,
      );
    }
  });

  it("uses a light, non-flat texture for the vision glass", async () => {
    const material = document.getRoot().listMaterials().find((item) => item.getName() === "openclinxr_door_glass");
    expect(material).toBeDefined();
    const image = material!.getBaseColorTexture()?.getImage();
    expect(image, "glass must carry the reflection texture").toBeDefined();
    const data = decodeRgbPng(image!);
    const sums = [0, 0, 0];
    const minima = [255, 255, 255];
    const maxima = [0, 0, 0];
    for (let offset = 0; offset < data.length; offset += 3) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[offset + channel]!;
        sums[channel] += value;
        minima[channel] = Math.min(minima[channel]!, value);
        maxima[channel] = Math.max(maxima[channel]!, value);
      }
    }
    const count = data.length / 3;
    const means = sums.map((sum) => sum / count);
    for (const mean of means) expect(mean).toBeGreaterThan(130);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(maxima[channel]! - minima[channel]!).toBeGreaterThan(20);
    }
  });

  it("exports full-leaf UV coverage on the veneer facing", () => {
    const values: number[][] = [];
    for (const node of document.getRoot().listNodes()) {
      if (!node.getName().startsWith("openclinxr_door_face_")) continue;
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const uv = primitive.getAttribute("TEXCOORD_0");
        expect(uv, `${node.getName()} needs UV0`).not.toBeNull();
        for (let index = 0; index < uv!.getCount(); index += 1) {
          values.push(uv!.getElement(index, [] as number[]));
        }
      }
    }
    expect(values.length).toBeGreaterThan(0);
    const u = values.map((value) => value[0]!);
    const v = values.map((value) => value[1]!);
    expect(Math.max(...u) - Math.min(...u)).toBeGreaterThanOrEqual(0.99);
    expect(Math.max(...v) - Math.min(...v)).toBeGreaterThanOrEqual(0.99);
  });
});
