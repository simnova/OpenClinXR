/**
 * Mount a runtime bundle's declared equipment + room props onto a scene.
 *
 * Lives here (the allowed tools factory subtree) instead of the SC-06 evidence
 * proof script, so production app source can import it without depending on
 * the dev-time-only evidence subtree, which the workspace architecture rules
 * forbid. Body unchanged from the freeze generator.
 */
import { readFileSync } from "node:fs";
import { type Object3D, type Scene, BoxGeometry, Mesh, Group, SphereGeometry, MeshBasicMaterial } from "three";
import { createDetailedEdRoomProps } from "../../../packages/openclinxr/xr-scene-cues/src/room-props.js";
import { shouldRenderRoomPropInVisualReview } from "../../../packages/openclinxr/xr-capture-evidence/src/visual-review-filter.js";
import {
  buildDeclaredEquipmentGeometry,
  buildGltfEquipmentPlaceholderSlot,
  buildRoomPropGroup,
  normalizeGltfEquipmentMount,
  planStationEquipmentMounts,
  REAL_EQUIPMENT_GLTF_BY_ID,
  roomPropColourNumbers,
  roomPropSuppressedByFixtureOwnership,
  stampRoomPropAliasesOnEquipmentRoot,
  stampSuppressedDeclaredEquipmentOntoFixtures,
} from "../../../packages/openclinxr/xr-station/src/index.js";

type GltfMirrorNode = {
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  boxes: Array<{ min: [number, number, number]; max: [number, number, number] }>;
  children: GltfMirrorNode[];
};

/**
 * The GLB's mesh hierarchy as data: per-node TRS plus per-primitive accessor boxes.
 *
 * Node's `GLTFLoader.parse` throws `self is not defined` on texture load, so the freeze cannot
 * load the GLB the way the browser does — but obstacle measurement needs no textures, only the
 * mesh extents. Every shipped equipment GLB carries POSITION accessor min/max, which equal the
 * vertex extremes the loader's `computeBoundingBox` would find, so mirroring each node (same
 * TRS values, same order, accessor-sized boxes) measures bit-identically downstream: same
 * matrices composed by the same three revision, same eight corners unioned in the same order.
 * A single union-sized box would NOT do: re-boxing the union through center/half changes the
 * float association downstream and straddles the digest's millimetre rounding on tall items
 * (measured: 1.35e-8 on the IV pole top, enough to flip `1.947` to `1.948`).
 */
function equipmentGltfMirrorNodes(glbPath: string): GltfMirrorNode[] {
  const buf = readFileSync(glbPath);
  if (buf.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`freeze cannot reproduce ${glbPath}: not a GLB`);
  }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    nodes?: Array<{ children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number }>;
    meshes?: Array<{ primitives: Array<{ attributes: { POSITION?: number } }> }>;
    accessors?: Array<{ min?: number[]; max?: number[] }>;
  };
  const nodes = json.nodes ?? [];
  const build = (index: number): GltfMirrorNode => {
    const node = nodes[index]!;
    const boxes: GltfMirrorNode["boxes"] = [];
    if (node.mesh !== undefined) {
      const mesh = (json.meshes ?? [])[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const accessor = (json.accessors ?? [])[primitive.attributes.POSITION ?? -1];
        if (!accessor?.min || !accessor?.max) {
          throw new Error(`freeze cannot reproduce ${glbPath}: POSITION accessor has no min/max`);
        }
        boxes.push({
          min: [accessor.min[0]!, accessor.min[1]!, accessor.min[2]!],
          max: [accessor.max[0]!, accessor.max[1]!, accessor.max[2]!],
        });
      }
    }
    return {
      translation: ((node.translation ?? [0, 0, 0]) as [number, number, number]).slice() as [number, number, number],
      rotation: ((node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]).slice() as [number, number, number, number],
      scale: ((node.scale ?? [1, 1, 1]) as [number, number, number]).slice() as [number, number, number],
      boxes,
      children: (node.children ?? []).map((child) => build(child)),
    };
  };
  const parented = new Set<number>();
  for (const node of nodes) for (const child of node.children ?? []) parented.add(child);
  return nodes.map((_, index) => index).filter((index) => !parented.has(index)).map((index) => build(index));
}

/**
 * What the browser's async equipment-GLB load contributes to a gltf slot's measured bounds,
 * reproduced in node without loading the GLB.
 *
 * Measured in-page on the ED slots: the live slot's box is placeholder ∪ loaded GLB ∪ slot
 * nameplate ∪ equipment affordance marker. The nameplate and the marker are UI cues the
 * production observer now skips, so node only owes placeholder ∪ GLB. The placeholder comes
 * from the shared builder; the GLB arrives here as a structural mirror: one proxy group per
 * GLB node with the node's own TRS values and accessor-sized box meshes, plus a marker
 * sphere at the equipment origin (the loader adds its affordance marker BEFORE normalizing,
 * and the sphere's 0.055 m bottom is what grounds the mount 0.055 m up — measured live as
 * wheels floating at y 0.055). The mirror then runs through the REAL
 * `normalizeGltfEquipmentMount` (footprint fit, stand, grounding), so the node slot carries
 * the same transform the browser applied. This mirrors the UNSUPPRESSED load path, which is
 * the measured state for both frozen cases; a suppressed case would need the suppression
 * decision mirrored too.
 */
const EQUIPMENT_GLB_DIR = "apps/ui-xr/public/xr-assets/medical-equipment";

function mountGltfEquipmentProxy(
  slot: Object3D,
  equipmentId: string,
  gltfFileName: string | undefined,
): void {
  const fileName = gltfFileName ?? (REAL_EQUIPMENT_GLTF_BY_ID as Record<string, string>)[equipmentId];
  if (!fileName) return;
  const mirrorRoots = equipmentGltfMirrorNodes(`${EQUIPMENT_GLB_DIR}/${fileName}`);
  if (mirrorRoots.length === 0) {
    throw new Error(`freeze cannot reproduce ${equipmentId}: no mesh nodes in ${fileName}`);
  }
  const proxy = new Group();
  const mirror = (node: GltfMirrorNode, parent: Group): void => {
    const group = new Group();
    group.position.set(node.translation[0], node.translation[1], node.translation[2]);
    group.quaternion.set(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]);
    group.scale.set(node.scale[0], node.scale[1], node.scale[2]);
    for (const box of node.boxes) {
      const mesh = new Mesh(
        new BoxGeometry(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]),
        new MeshBasicMaterial(),
      );
      mesh.position.set(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      );
      group.add(mesh);
    }
    for (const child of node.children) mirror(child, group);
    parent.add(group);
  };
  for (const root of mirrorRoots) mirror(root, proxy);
  const marker = new Mesh(new SphereGeometry(0.055, 16, 12), new MeshBasicMaterial());
  marker.userData["openClinXrAffordanceCueId"] = `${equipmentId}:equipment_reference`;
  proxy.add(marker);
  slot.add(normalizeGltfEquipmentMount(proxy as never, slot as never) as never);
}

export function mountBundleDeclaredContent(scene: Scene, bundle: {
  equipment: ReadonlyArray<{ equipmentId: string }>;
  sceneManifest: {
    equipmentPlacements?: Record<string, never>;
    roomProps: ReadonlyArray<{
      propId: string;
      label?: string;
      semanticRole?: string | null;
      colorHex: string;
      accentColorHex: string;
      position: { x: number; y: number; z: number };
      scale: { x: number; y: number; z: number };
      affordanceCueIds?: string[];
    }>;
  };
}, scenarioId: string): void {
  const shell = scene.children.at(-1) as unknown as { userData?: Record<string, unknown> } | undefined;
  const fixtureOwnedRoles = Array.isArray(shell?.userData?.["fixtureOwnedRoles"])
    ? (shell?.userData?.["fixtureOwnedRoles"] as string[])
    : [];
  const equipmentPlan = planStationEquipmentMounts({
    scenarioId,
    equipment: bundle.equipment,
    equipmentPlacements: bundle.sceneManifest.equipmentPlacements ?? {},
    fixtureOwnedRoles,
  });
  const exclusiveMountedEquipmentIds = new Set(equipmentPlan.map((item) => item.equipmentId));
  for (const prop of createDetailedEdRoomProps(
    {
      scenarioObjectPrefix: `openclinxr.${scenarioId}`,
      createAffordanceMarker: () => new Mesh(new BoxGeometry(0.01, 0.01, 0.01)),
      createActorNameplate: () => new Mesh(new BoxGeometry(0.01, 0.01, 0.01)),
      roomPropObjectPrefix: `openclinxr.${scenarioId}.room-prop`,
      shouldRenderRoomProp: (entry) =>
        shouldRenderRoomPropInVisualReview(entry as never, false),
      roomPropColourNumbers,
      roomPropSuppressedByFixtureOwnership,
      buildRoomPropGroup,
      hasVector3: (value: unknown): value is { x: number; y: number; z: number } =>
        typeof value === "object" && value !== null
        && typeof (value as { x?: unknown }).x === "number",
      registerReactiveProp: () => undefined,
    },
    bundle.sceneManifest.roomProps as never,
    fixtureOwnedRoles,
    exclusiveMountedEquipmentIds,
  )) {
    scene.add(prop as never);
  }
  for (const item of equipmentPlan) {
    const slot = item.source === "gltf"
      ? buildGltfEquipmentPlaceholderSlot(item.equipmentId)
      : buildDeclaredEquipmentGeometry(item.equipmentId);
    slot.position.set(item.position.x, item.position.y, item.position.z);
    stampRoomPropAliasesOnEquipmentRoot(slot, item.equipmentId);
    if (item.source === "gltf") {
      mountGltfEquipmentProxy(slot as never, item.equipmentId, item.gltfFileName);
    }
    scene.add(slot as never);
  }
  stampSuppressedDeclaredEquipmentOntoFixtures({
    shell: shell as never,
    plannedEquipmentIds: equipmentPlan.map((item) => item.equipmentId),
    equipmentPlacements: bundle.sceneManifest.equipmentPlacements ?? {},
    equipment: bundle.equipment,
    roomProps: bundle.sceneManifest.roomProps,
  });
}
