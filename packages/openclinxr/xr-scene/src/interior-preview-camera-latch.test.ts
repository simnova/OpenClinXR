import {
  Bone,
  Box3,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { deriveInteriorPreviewCamera } from "./index.js";

/**
 * w0-cam-p-latch-on-full-cast: the interior preview camera latches once, when every
 * blueprint actor id has >= 1 loaded SkinnedMesh under its actor root or has failed
 * to load. A load-order-dependent default view is the defect: latching on the first
 * frame with any SkinnedMesh present freezes the eye at the partial cast's height
 * (measured: run-3 eye y 1.6394 on the fuller cast vs run-4 y 1.0949 on the partial).
 *
 * The latch is evaluated after each arrival, the way the ui-xr frame loop evaluates
 * it: the scene plus staged ids ride the existing export's widened input, the
 * derivation finds each root itself via the runtime's userData.openClinXrActorId
 * stamp, and the cast box is built from the loaded actors' roots only.
 */

const TALL = { actorId: "actor_tall_170", heightMeters: 1.7, x: 0.9 };
const SHORT_A = { actorId: "actor_short_a", heightMeters: 1.2, x: -0.9 };
const SHORT_B = { actorId: "actor_short_b", heightMeters: 1.0, x: 0.1 };
const FULL_CAST = [SHORT_A, SHORT_B, TALL];

function shellRoom(): Group {
  const room = new Group();
  const interior = new Mesh(new BoxGeometry(6, 3, 6), new MeshStandardMaterial());
  interior.name = "interior_bounds";
  interior.position.y = 1.5;
  room.add(interior);
  const hull = new Mesh(new BoxGeometry(6.4, 3.4, 6.4), new MeshStandardMaterial());
  hull.name = "exterior";
  hull.position.y = 1.5;
  room.add(hull);
  return room;
}

function skinnedBox(widthMeters: number, heightMeters: number, depthMeters: number): SkinnedMesh {
  const geometry = new BoxGeometry(widthMeters, heightMeters, depthMeters);
  const vertexCount = geometry.attributes["position"]!.count;
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4));
  const skinWeight = new Float32BufferAttribute(new Float32Array(vertexCount * 4), 4);
  for (let index = 0; index < vertexCount; index += 1) skinWeight.setXYZW(index, 1, 0, 0, 0);
  geometry.setAttribute("skinWeight", skinWeight);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  const bone = new Bone();
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  return mesh;
}

function actorRoot(actorId: string, heightMeters: number, x: number): Group {
  const root = new Group();
  root.name = actorId;
  // Same stamp the runtime writes on every staged slot root (actor-staging.ts).
  root.userData["openClinXrActorId"] = actorId;
  const mesh = skinnedBox(0.4, heightMeters, 0.3);
  mesh.position.set(x, heightMeters / 2, -0.75);
  root.add(mesh);
  root.updateMatrixWorld(true);
  return root;
}

function evaluate(
  arrived: readonly { actorId: string; heightMeters: number; x: number }[],
  failedActorIds: readonly string[] = [],
) {
  const scene = new Group();
  const room = shellRoom();
  scene.add(room);
  for (const spec of arrived) scene.add(actorRoot(spec.actorId, spec.heightMeters, spec.x));
  scene.updateMatrixWorld(true);
  return deriveInteriorPreviewCamera({
    roomRoot: room,
    scene,
    stagedActorIds: FULL_CAST.map((spec) => spec.actorId),
    failedActorIds,
  });
}

describe("the interior preview camera latches once on the full cast", () => {
  it("the derived eye is arrival-order independent", () => {
    const orderA = [SHORT_A, SHORT_B, TALL];
    const orderB = [TALL, SHORT_A, SHORT_B];
    const earlyA = evaluate(orderA.slice(0, 2));
    const earlyB = evaluate(orderB.slice(0, 2));
    expect(earlyA).toBeNull();
    expect(earlyB).toBeNull();
    const fullA = evaluate(orderA);
    const fullB = evaluate(orderB);
    expect(fullA).not.toBeNull();
    expect(fullB).not.toBeNull();
    expect(fullA!.eye.toArray()).toEqual(fullB!.eye.toArray());
    expect(fullA!.eye.y).toBeCloseTo(1.7, 5);
  });

  it("a failed actor releases the latch on the loaded set and reports the partial cast", () => {
    expect(evaluate([])).toBeNull();
    expect(evaluate([], ["actor_tall_170"])).toBeNull();
    const partial = evaluate([SHORT_A, SHORT_B], ["actor_tall_170"]);
    expect(partial).not.toBeNull();
    expect(partial!.partialCast).toEqual(["actor_tall_170"]);
    const full = evaluate([SHORT_A, SHORT_B, TALL]);
    expect(full).not.toBeNull();
    expect(full!.partialCast).toEqual([]);
  });

  it("maps failed scene evidence and mixer times through the existing derivation", () => {
    const scene = new Group();
    const room = shellRoom();
    scene.add(room, actorRoot(SHORT_A.actorId, SHORT_A.heightMeters, SHORT_A.x));
    const result = deriveInteriorPreviewCamera({
      roomRoot: room,
      scene,
      stagedActorIds: [SHORT_A.actorId, TALL.actorId],
      latchEvidence: {
        sceneEvidence: { assets: [
          { assetId: "model-short", status: "loaded" },
          { assetId: "model-tall", status: "failed" },
        ] },
        modelAssetIdForActor: (actorId) => actorId === TALL.actorId ? "model-tall" : "model-short",
        mixerTimeForActor: (actorId) => actorId === SHORT_A.actorId ? 0 : null,
      },
    });
    expect(result).not.toBeNull();
    expect(result!.partialCast).toEqual([TALL.actorId]);
    expect(result!.mixerTimeAtLatch).toEqual({ [SHORT_A.actorId]: 0, [TALL.actorId]: null });
  });

  it("two meshes under one actor root do not release the latch for an unloaded actor", () => {
    const scene = new Group();
    const room = shellRoom();
    scene.add(room);
    const loaded = actorRoot("actor_loaded", 1.2, -0.9);
    const second = skinnedBox(0.35, 1.1, 0.3);
    second.position.set(-0.9, 0.55, -0.4);
    loaded.add(second);
    scene.add(loaded);
    // A staged-but-pending slot: stamped root, no SkinnedMesh yet.
    const unloaded = new Group();
    unloaded.name = "actor_unloaded";
    unloaded.userData["openClinXrActorId"] = "actor_unloaded";
    scene.add(unloaded);
    scene.updateMatrixWorld(true);
    const result = deriveInteriorPreviewCamera({
      roomRoot: room,
      scene,
      stagedActorIds: ["actor_loaded", "actor_unloaded"],
      failedActorIds: [],
    });
    expect(result).toBeNull();
  });

  it("a stale cached box does not move the latch eye (fresh recompute wins)", () => {
    const scene = new Group();
    const room = shellRoom();
    scene.add(room);
    const root = actorRoot("actor_tall_170", 1.0, 0.9);
    scene.add(root);
    scene.updateMatrixWorld(true);
    root.traverse((obj) => {
      const maybeSkinned = obj as unknown as { isSkinnedMesh?: boolean; boundingBox?: Box3 | null };
      if (maybeSkinned.isSkinnedMesh !== true) return;
      maybeSkinned.boundingBox = new Box3(new Vector3(-1, 9.5, -1), new Vector3(1, 9.9, 1));
    });
    const result = deriveInteriorPreviewCamera({
      roomRoot: room,
      scene,
      stagedActorIds: ["actor_tall_170"],
      failedActorIds: [],
    });
    expect(result).not.toBeNull();
    expect(result!.eye.y).toBeCloseTo(1.0, 5);
  });
});
