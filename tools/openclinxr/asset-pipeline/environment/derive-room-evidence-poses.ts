import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { type Node, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

export type RoomEvidenceRecipe = {
  environmentId: string;
  footprintMeters: { width: number; depth: number; ceilingHeight: number };
  door: { doorWall: "+x" | "-x" | "+y" | "-y" };
};

export type Point3 = [number, number, number];
export type EvidencePoseId =
  | "runtime-01-toward-door"
  | "runtime-02-toward-bed-wall"
  | "runtime-03-ceiling-corner"
  | "runtime-04-door-inside"
  | "runtime-05-troffer-junction"
  | "runtime-06-floor-base";

export type RoomEvidencePose = {
  id: EvidencePoseId;
  image: string;
  eye: Point3;
  look: Point3;
  verticalFovDeg: number;
  subject: "door-with-casing" | "opposite-wall" | "ceiling-corner" | "troffer-and-tbar" | "floor-cove-junction";
  derivation: string;
};

type Bounds = { min: Point3; max: Point3 };
type NamedBounds = Bounds & { nodes: string[] };

export type RoomEvidencePoseArtifact = {
  schemaVersion: "openclinxr.room-derived-evidence-poses.v1";
  environmentId: string;
  sourceGlb: string;
  sourceGlbSha256: string;
  roomBounds: Bounds;
  featureBounds: {
    doorWithCasing: NamedBounds;
    troffer: NamedBounds;
    tbar: NamedBounds;
    cove: NamedBounds;
  };
  rules: {
    standingEyeHeightM: 1.6;
    lowEyeHeightM: number;
    minimumWallClearanceM: 0.3;
    lensRefitFrameFractions: Record<string, number | [number, number]>;
  };
  poses: RoomEvidencePose[];
  clearanceM: Record<EvidencePoseId, { x: number; z: number; minimum: number }>;
};

const round = (value: number): number => Number(value.toFixed(6));
const tuple = (x: number, y: number, z: number): Point3 => [round(x), round(y), round(z)];
const emptyBounds = (): Bounds => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const degrees = (radianValue: number): number => radianValue * 180 / Math.PI;
const radians = (degreesValue: number): number => degreesValue * Math.PI / 180;

/** Keep the ward lens-refit subject fraction when room depth changes. */
function depthScaledFov(baseWardFovDeg: number, depthM: number): number {
  return round(2 * degrees(Math.atan(Math.tan(radians(baseWardFovDeg / 2)) * 3.9 / depthM)));
}

/** Keep the opposite-wall width fraction when both room aspect and depth change. */
function oppositeWallFov(widthM: number, depthM: number): number {
  const wardAspect = 4.3 / 3.9;
  return round(2 * degrees(Math.atan(Math.tan(radians(56 / 2)) * (widthM / depthM) / wardAspect)));
}

function include(bounds: Bounds, point: readonly number[]): void {
  const [x = Number.NaN, y = Number.NaN, z = Number.NaN] = point;
  bounds.min = [Math.min(bounds.min[0], x), Math.min(bounds.min[1], y), Math.min(bounds.min[2], z)];
  bounds.max = [Math.max(bounds.max[0], x), Math.max(bounds.max[1], y), Math.max(bounds.max[2], z)];
}

function nodeBounds(node: Node): Bounds | null {
  const mesh = node.getMesh();
  if (!mesh) return null;
  const result = emptyBounds();
  const matrix = node.getWorldMatrix();
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
    if (!position) continue;
    const [minX = Number.NaN, minY = Number.NaN, minZ = Number.NaN] = position.getMin([]);
    const [maxX = Number.NaN, maxY = Number.NaN, maxZ = Number.NaN] = position.getMax([]);
    const m = Array.from(matrix, (value) => value ?? Number.NaN);
    for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) {
      include(result, [
        (m[0] ?? Number.NaN) * x + (m[4] ?? Number.NaN) * y + (m[8] ?? Number.NaN) * z + (m[12] ?? Number.NaN),
        (m[1] ?? Number.NaN) * x + (m[5] ?? Number.NaN) * y + (m[9] ?? Number.NaN) * z + (m[13] ?? Number.NaN),
        (m[2] ?? Number.NaN) * x + (m[6] ?? Number.NaN) * y + (m[10] ?? Number.NaN) * z + (m[14] ?? Number.NaN),
      ]);
    }
  }
  return Number.isFinite(result.min[0]) ? result : null;
}

function collect(nodes: readonly Node[], pattern: RegExp, label: string): NamedBounds {
  const result: NamedBounds = { ...emptyBounds(), nodes: [] };
  for (const node of nodes) {
    const name = node.getName();
    const meshName = node.getMesh()?.getName() ?? "";
    if (!pattern.test(`${name} ${meshName}`)) continue;
    const bounds = nodeBounds(node);
    if (!bounds) continue;
    include(result, bounds.min);
    include(result, bounds.max);
    result.nodes.push(name || meshName);
  }
  result.nodes.sort();
  if (result.nodes.length === 0) throw new Error(`room evidence pose derivation requires ${label} nodes`);
  result.min = result.min.map(round) as Point3;
  result.max = result.max.map(round) as Point3;
  return result;
}

function clearance(eye: Point3, room: Bounds): { x: number; z: number; minimum: number } {
  const x = Math.min(eye[0] - room.min[0], room.max[0] - eye[0]);
  const z = Math.min(eye[2] - room.min[2], room.max[2] - eye[2]);
  return { x: round(x), z: round(z), minimum: round(Math.min(x, z)) };
}

/**
 * Derive the six standard evidence views from room geometry, never a room-id pose table.
 *
 * Coordinate derivation rules:
 * - the recipe footprint defines the four interior wall planes; GLB bounds/features are
 *   measured and recorded so a missing door, troffer, T-bar or cove fails closed;
 * - every standing eye is y=1.6 m, and x/z are inset at least 0.30 m from each wall;
 * - door views aim at the measured door+casing centre and use the lens-refit door
 *   fractions (01 width 0.117W, 04 height 0.721H) as the composition family;
 * - the opposite wall is exactly the wall opposite recipe.door.doorWall;
 * - ceiling views aim at the measured troffer and nearest measured T-bar junction;
 * - the low view aims at the measured cove/floor junction;
 * - FOVs are the ward lens-refit values. Positions are expressed as normalized room
 *   offsets, so a wider/deeper factory room preserves subject frame fraction instead
 *   of reusing ward metres and walking into a wall.
 */
export function deriveRoomEvidencePosesFromGeometry(
  recipe: RoomEvidenceRecipe,
  sourceGlb: string,
  sourceGlbSha256: string,
  features: RoomEvidencePoseArtifact["featureBounds"],
): RoomEvidencePoseArtifact {
  const width = recipe.footprintMeters.width;
  const depth = recipe.footprintMeters.depth;
  const height = recipe.footprintMeters.ceilingHeight;
  const room: Bounds = { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] };
  // Blender recipe +Y is glTF -Z in the shipped room-local frame. All current
  // recipes use +Y, but the mapping is complete so future wall choices remain data-driven.
  const doorAxis = recipe.door.doorWall.endsWith("x") ? "x" : "z";
  const doorSign = recipe.door.doorWall === "+y" || recipe.door.doorWall === "-x" ? -1 : 1;
  if (doorAxis !== "z") throw new Error(`room evidence poses currently require a glTF z door wall (got ${recipe.door.doorWall})`);
  const doorWallZ = doorSign < 0 ? room.min[2] : room.max[2];
  const oppositeWallZ = doorSign < 0 ? room.max[2] : room.min[2];
  const doorCenterX = round((features.doorWithCasing.min[0] + features.doorWithCasing.max[0]) / 2);
  const trofferCenter = tuple(
    (features.troffer.min[0] + features.troffer.max[0]) / 2,
    (features.troffer.min[1] + features.troffer.max[1]) / 2,
    (features.troffer.min[2] + features.troffer.max[2]) / 2,
  );
  const inset = 0.3;
  const bedInset = Math.max(inset, depth * (0.33 / 3.9));
  const doorInside = doorWallZ + -doorSign * Math.max(inset, depth * (0.45 / 3.9));
  const bedInside = oppositeWallZ + doorSign * bedInset;
  const sideNearDoor = Math.max(room.min[0] + inset, Math.min(room.max[0] - inset, doorCenterX - width * (0.67 / 4.3)));
  const centerX = (room.min[0] + room.max[0]) / 2;
  const image = (id: EvidencePoseId): string => `${id.replace(/^runtime-/, "")}.jpg`;
  const poses: RoomEvidencePose[] = [
    {
      id: "runtime-01-toward-door", image: image("runtime-01-toward-door"),
      eye: tuple(sideNearDoor, 1.6, bedInside),
      look: tuple(doorCenterX - width * (0.33 / 4.3), height * (1.22 / 2.4), doorWallZ - doorSign * 0.15),
      verticalFovDeg: depthScaledFov(70, depth), subject: "door-with-casing",
      derivation: "Standing eye; 0.30 m wall inset; door+casing centre from GLB; ward lens-refit 70deg family (door width 0.117W).",
    },
    {
      id: "runtime-02-toward-bed-wall", image: image("runtime-02-toward-bed-wall"),
      eye: tuple(centerX - width * (0.3 / 4.3), 1.6, doorInside),
      look: tuple(centerX, height * (1.25 / 2.4), oppositeWallZ + doorSign * 0.15),
      verticalFovDeg: oppositeWallFov(width, depth), subject: "opposite-wall",
      derivation: "Standing eye inside door wall; aims at its recipe-derived opposite wall; ward lens-refit 56deg wall-span family.",
    },
    {
      id: "runtime-03-ceiling-corner", image: image("runtime-03-ceiling-corner"),
      eye: tuple(centerX - width * (0.5 / 4.3), 1.6, centerX + depth * (0.9 / 3.9)),
      look: tuple(trofferCenter[0], height - 0.15, trofferCenter[2] - depth * (0.5 / 3.9)),
      verticalFovDeg: depthScaledFov(52, depth), subject: "ceiling-corner",
      derivation: "Standing eye; measured troffer anchors the ceiling/corner look; 52deg is the capture-measured standing-eye refit of the ward 50deg ceiling family.",
    },
    {
      id: "runtime-04-door-inside", image: image("runtime-04-door-inside"),
      eye: tuple(doorCenterX - width * (0.85 / 4.3), 1.6, bedInside),
      look: tuple(doorCenterX, height * (1.25 / 2.4), doorWallZ - doorSign * 0.15),
      verticalFovDeg: depthScaledFov(44, depth), subject: "door-with-casing",
      derivation: "Standing eye on the room interior diagonal; full measured door+casing target; ward lens-refit 44deg (door height 0.721H).",
    },
    {
      id: "runtime-05-troffer-junction", image: image("runtime-05-troffer-junction"),
      eye: tuple(room.min[0] + inset, 1.6, oppositeWallZ + doorSign * Math.max(inset, depth * (0.45 / 3.9))),
      look: tuple(trofferCenter[0], height + 0.3, trofferCenter[2]),
      verticalFovDeg: 44, subject: "troffer-and-tbar",
      derivation: "Standing eye at exact 0.30 m side clearance; measured troffer centre plus measured surrounding T-bars; ward lens-refit 44deg junction family.",
    },
    {
      id: "runtime-06-floor-base", image: image("runtime-06-floor-base"),
      eye: tuple(centerX - width * (0.02 / 4.3), 0.32, bedInside),
      look: tuple(centerX, -0.05, oppositeWallZ),
      verticalFovDeg: depthScaledFov(55, depth), subject: "floor-cove-junction",
      derivation: "Only low eye; measured cove nodes prove the floor/base subject; ward lens-refit 55deg cove-profile family.",
    },
  ];
  const clearanceM = Object.fromEntries(poses.map((pose) => [pose.id, clearance(pose.eye, room)])) as RoomEvidencePoseArtifact["clearanceM"];
  for (const pose of poses) {
    if (clearanceM[pose.id].minimum < inset - 1e-6) throw new Error(`${pose.id} wall clearance ${clearanceM[pose.id].minimum} m is below ${inset} m`);
    if (pose.id !== "runtime-06-floor-base" && pose.eye[1] !== 1.6) throw new Error(`${pose.id} must use the 1.6 m standing eye`);
  }
  return {
    schemaVersion: "openclinxr.room-derived-evidence-poses.v1",
    environmentId: recipe.environmentId,
    sourceGlb,
    sourceGlbSha256,
    roomBounds: { min: tuple(...room.min), max: tuple(...room.max) },
    featureBounds: features,
    rules: {
      standingEyeHeightM: 1.6,
      lowEyeHeightM: 0.32,
      minimumWallClearanceM: inset,
      lensRefitFrameFractions: {
        "01-door-width": 0.117,
        "01-wall-span": 0.492,
        "02-wall-span": 0.642,
        "03-troffer-center": [0.535, 0.401],
        "04-door-height": 0.721,
        "05-troffer-center": [0.478, 0.615],
        "06-cove-top-row": 0.25,
        "06-floor-side-row": 0.472,
      },
    },
    poses,
    clearanceM,
  };
}

export async function deriveRoomEvidencePoses(glbPath: string, recipe: RoomEvidenceRecipe): Promise<RoomEvidencePoseArtifact> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const document = await io.read(glbPath);
  const nodes = document.getRoot().listNodes();
  const features = {
    doorWithCasing: collect(nodes, /door_leaf|door_casing|hospital_door|casing/iu, "door/casing"),
    troffer: collect(nodes, /openclinxr_troffer_(?:diffuser|frame)/iu, "troffer"),
    tbar: collect(nodes, /openclinxr_tbar_(?:x|y|edge)/iu, "T-bar"),
    cove: collect(nodes, /openclinxr_cove_/iu, "cove"),
  };
  return deriveRoomEvidencePosesFromGeometry(
    recipe,
    glbPath,
    createHash("sha256").update(readFileSync(glbPath)).digest("hex"),
    features,
  );
}

export async function writeRoomEvidencePoses(glbPath: string, recipe: RoomEvidenceRecipe, outputPath: string): Promise<RoomEvidencePoseArtifact> {
  const artifact = await deriveRoomEvidencePoses(glbPath, recipe);
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}
