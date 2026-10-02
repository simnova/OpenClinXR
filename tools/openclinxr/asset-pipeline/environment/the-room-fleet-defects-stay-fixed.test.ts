import path from "node:path";
import { type Node, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { ROOM_CHAIN_RECIPES } from "@openclinxr/factory-stations/room-chain";
import { describe, expect, it } from "vitest";
import { deriveRoomEvidencePosesFromGeometry, type RoomEvidencePoseArtifact } from "./derive-room-evidence-poses.js";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const rooms = {
  behavioral: "apps/ui-xr/public/xr-assets/environment/infinigen-behavioral-health-private.glb",
  home: "apps/ui-xr/public/xr-assets/environment/infinigen-telehealth-home-visit.glb",
  stroke: "apps/ui-xr/public/xr-assets/environment/infinigen-ed-stroke-bay.glb",
  surgical: "apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb",
} as const;

type Bounds = { min: [number, number, number]; max: [number, number, number] };

function bounds(node: Node): Bounds | null {
  const mesh = node.getMesh();
  if (!mesh) return null;
  const result: Bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const m = Array.from(node.getWorldMatrix(), Number);
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
    if (!position) continue;
    const lo = position.getMin([]);
    const hi = position.getMax([]);
    for (const x of [lo[0]!, hi[0]!]) for (const y of [lo[1]!, hi[1]!]) for (const z of [lo[2]!, hi[2]!]) {
      const point = [
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      ];
      for (let axis = 0; axis < 3; axis += 1) {
        result.min[axis] = Math.min(result.min[axis]!, point[axis]!);
        result.max[axis] = Math.max(result.max[axis]!, point[axis]!);
      }
    }
  }
  return Number.isFinite(result.min[0]) ? result : null;
}

async function nodes(room: keyof typeof rooms): Promise<Node[]> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return (await io.read(path.join(ROOT, rooms[room]))).getRoot().listNodes();
}

describe("the regenerated room defect mechanisms stay fixed", () => {
  it.each(["behavioral", "home"] as const)("%s keeps one painted ceiling surface", async (room) => {
    const all = await nodes(room);
    const names = all.map((node) => node.getName());
    expect(names.filter((name) => name === "openclinxr_ceiling_painted")).toHaveLength(1);
    expect(names.some((name) => /(?:^|[/.])ceiling$/u.test(name))).toBe(false);
  });

  it.each(["behavioral", "home"] as const)("%s carries no decorative crown trim", async (room) => {
    const all = await nodes(room);
    const names = all.map((node) => node.getName());
    expect(names.some((name) => /skirting_ceiling|wall_angle/iu.test(name))).toBe(false);
  });

  it.each(["behavioral", "stroke", "home", "surgical"] as const)("%s retains one full-height leaf closed in the frame plane", async (room) => {
    const all = await nodes(room);
    const leafBounds = all
      .filter((node) => /door_leaf/iu.test(node.getName()))
      .map(bounds).filter((value): value is Bounds => value !== null)
      .filter((box) => box.max[1] - box.min[1] > 1.5);
    expect(leafBounds).toHaveLength(1); // measured opening is 1.06 m: a single, not paired, door
    const [leaf] = leafBounds;
    const width = leaf!.max[0] - leaf!.min[0];
    const depth = leaf!.max[2] - leaf!.min[2];
    expect(width / depth, `closed leaf width/depth ${width}/${depth}`).toBeGreaterThanOrEqual(3.5);
    // The strip centres the panel bounds (not the hinge-edge origin) on the
    // casing bounds centre, and the parent-safe extract centering preserves
    // it: the panel centre sits within 5 mm of the frame centre and the
    // panel span lands inside the frame span instead of hanging past a jamb.
    const casing = all.map(bounds).filter((value, index) => value !== null && /door_casing$/iu.test(all[index]!.getName()));
    expect(casing).toHaveLength(1);
    const [frame] = casing as Bounds[];
    const leafCx = (leaf!.min[0] + leaf!.max[0]) / 2;
    const frameCx = (frame!.min[0] + frame!.max[0]) / 2;
    expect(Math.abs(leafCx - frameCx), `leaf/casing centre offset ${leafCx - frameCx}`).toBeLessThanOrEqual(0.005);
    expect(leaf!.min[0]).toBeGreaterThanOrEqual(frame!.min[0]);
    expect(leaf!.max[0]).toBeLessThanOrEqual(frame!.max[0]);
  });

  it("keeps the surgical visible leaf undercut at the 3 mm floor-field lift and reveals at no more than 9 mm", async () => {
    const all = await nodes("surgical");
    const faces = all.map((node) => ({ name: node.getName(), box: bounds(node) }))
      .filter((row): row is { name: string; box: Bounds } => row.box !== null && /openclinxr_door_face_/u.test(row.name));
    const reveals = all.map((node) => ({ name: node.getName(), box: bounds(node) }))
      .filter((row): row is { name: string; box: Bounds } => row.box !== null && /openclinxr_door_reveal_(?:left|right)/u.test(row.name));
    expect(Math.min(...faces.map(({ box }) => box.min[1]))).toBeLessThanOrEqual(0.0031);
    expect(reveals).toHaveLength(2);
    expect(Math.max(...reveals.map(({ box }) => Math.min(box.max[0] - box.min[0], box.max[2] - box.min[2]))))
      .toBeLessThanOrEqual(0.0091);
    // The 9 mm reveal strips bridge the leaf-to-jamb joint on both sides:
    // each leaf vertical edge lands inside its reveal span, so no open slit
    // remains between leaf and frame. Edges coincide by construction
    // (reveal inner faces are built from the leaf bounds); the 0.2 mm
    // tolerance absorbs meshopt position-quantization jitter (measured
    // 0.07 mm) and stays 45x below the 9 mm reveal it guards.
    const leaf = all.map(bounds).filter((value, index) => value !== null && /door_leaf/iu.test(all[index]!.getName()) && value.max[1] - value.min[1] > 1.5);
    expect(leaf).toHaveLength(1);
    const [panel] = leaf as Bounds[];
    const eps = 0.0002;
    for (const { box } of reveals) {
      const coversMin = box.min[0] - eps <= panel!.min[0] && panel!.min[0] <= box.max[0] + eps;
      const coversMax = box.min[0] - eps <= panel!.max[0] && panel!.max[0] <= box.max[0] + eps;
      expect(coversMin || coversMax, `reveal covers a leaf edge`).toBe(true);
    }
  });

  it("derives the low pose with half-room sightline clearance instead of the 0.30 m cove near-field", () => {
    const recipe = ROOM_CHAIN_RECIPES.surgical_ward_room_v1;
    const feature = (min: [number, number, number], max: [number, number, number], node: string) => ({ min, max, nodes: [node] });
    const features: RoomEvidencePoseArtifact["featureBounds"] = {
      doorWithCasing: feature([-0.29, 0, -3.7], [0.79, 2.155, -3.1], "door"),
      troffer: feature([-0.6, 2.52, -0.6], [0.6, 2.54, 0], "troffer"),
      tbar: feature([-3.7, 2.53, -3.7], [3.7, 2.56, 3.7], "tbar"),
      cove: feature([-3.7, 0.003, -3.7], [3.7, 0.103, 3.7], "cove"),
    };
    const artifact = deriveRoomEvidencePosesFromGeometry(recipe, "room.glb", "abc", features);
    const low = artifact.poses.find((pose) => pose.id === "runtime-06-floor-base")!;
    expect(low.eye[2]).toBe(0);
    expect(Math.abs(low.look[2] - low.eye[2])).toBe(recipe.footprintMeters.depth / 2);
    expect(low.look[1]).toBeGreaterThanOrEqual(0.05);
  });
});
