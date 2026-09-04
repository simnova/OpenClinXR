import { Group, Mesh, BoxGeometry, MeshBasicMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  evaluateCompiledRoomReadiness,
  parseCompiledRoomAuthoredMetadata,
  type CompiledRoomAuthoredMetadata,
} from "./compiled-room-readiness.js";
import { mountCompiledRoomReady } from "./compiled-room-runtime.js";

/**
 * Compiled-room readiness is explicit: anchors resolve uniquely, bounds derive
 * from authored metadata, and any refusal falls back to the parametric room.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness
 */

const ED_BAY = "ed_exam_bay_v1";

const VALID_METADATA: CompiledRoomAuthoredMetadata = {
  actorAnchors: [
    { id: "patient", kind: "actor", nodeName: "openclinxr.anchor.actor.patient" },
    { id: "nurse", kind: "actor", nodeName: "openclinxr.anchor.actor.nurse" },
  ],
  equipmentAnchors: [
    { id: "monitor", kind: "equipment", nodeName: "openclinxr.anchor.equipment.monitor" },
  ],
  collisionBounds: { min: { x: -3, y: 0, z: -4 }, max: { x: 3, y: 2.8, z: 2 } },
  walkableBounds: { min: { x: -2.6, y: 0, z: -3.6 }, max: { x: 2.6, y: 0.02, z: 1.6 } },
};

function namedEmpty(name: string, x: number, z: number): Group {
  const node = new Group();
  node.name = name;
  node.position.set(x, 0, z);
  return node;
}

function compiledSceneWithAnchors(): Group {
  const root = new Group();
  root.add(namedEmpty("openclinxr.anchor.actor.patient", -0.72, -0.12));
  root.add(namedEmpty("openclinxr.anchor.actor.nurse", 1.45, 0.55));
  root.add(namedEmpty("openclinxr.anchor.equipment.monitor", 1.9, -0.4));
  const floor = new Mesh(new BoxGeometry(6, 0.04, 6), new MeshBasicMaterial());
  floor.name = "compiled-floor";
  root.add(floor);
  return root;
}

function hasParametricFloor(root: Group): boolean {
  let found = false;
  root.traverse((obj: Object3D) => {
    if (obj.name === "openclinxr.station-environment.floor") found = true;
  });
  return found;
}

function mockLoadGltfFrom(scene: Group): (url: string) => Promise<Group> {
  return async (url: string) => {
    scene.userData.mockSourceUrl = url;
    return scene;
  };
}

describe("parseCompiledRoomAuthoredMetadata", () => {
  it("accepts actor/equipment anchors and finite min<max bounds", () => {
    const parsed = parseCompiledRoomAuthoredMetadata(VALID_METADATA);
    expect(parsed).toEqual({ metadata: VALID_METADATA });
  });

  it("refuses non-objects and inverted bounds", () => {
    expect(parseCompiledRoomAuthoredMetadata(null)).toMatchObject({
      diagnostics: [{ code: "malformed_metadata" }],
    });
    expect(parseCompiledRoomAuthoredMetadata({
      ...VALID_METADATA,
      collisionBounds: { min: { x: 3, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    })).toMatchObject({
      diagnostics: [{ code: "malformed_bounds" }],
    });
  });
});

describe("evaluateCompiledRoomReadiness", () => {
  it("resolves unique actor and equipment anchors and derives authored bounds", () => {
    const result = evaluateCompiledRoomReadiness({
      scene: compiledSceneWithAnchors(),
      metadata: VALID_METADATA,
    });
    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.resolvedAnchors.map((a) => a.id)).toEqual(["patient", "nurse", "monitor"]);
    expect(result.resolvedAnchors[0]?.position).toEqual({ x: -0.72, y: 0, z: -0.12 });
    expect(result.collisionBounds).toEqual(VALID_METADATA.collisionBounds);
    expect(result.walkableBounds).toEqual(VALID_METADATA.walkableBounds);
  });

  it("refuses a missing declared anchor", () => {
    const scene = compiledSceneWithAnchors();
    const result = evaluateCompiledRoomReadiness({
      scene,
      metadata: {
        ...VALID_METADATA,
        actorAnchors: [
          ...VALID_METADATA.actorAnchors,
          { id: "family", kind: "actor", nodeName: "openclinxr.anchor.actor.family" },
        ],
      },
    });
    expect(result.ready).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "missing_anchor",
        anchorId: "family",
        nodeName: "openclinxr.anchor.actor.family",
      }),
    ]));
  });

  it("refuses duplicate scene nodes for a declared anchor", () => {
    const scene = compiledSceneWithAnchors();
    scene.add(namedEmpty("openclinxr.anchor.actor.patient", 0, 0));
    const result = evaluateCompiledRoomReadiness({
      scene,
      metadata: VALID_METADATA,
    });
    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "duplicate_anchor")).toBe(true);
  });

  it("refuses an empty compiled scene even with valid metadata", () => {
    const result = evaluateCompiledRoomReadiness({
      scene: new Group(),
      metadata: VALID_METADATA,
    });
    expect(result.ready).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("empty_scene");
  });
});

describe("mountCompiledRoomReady", () => {
  it("keeps the compiled shell when anchors and bounds are ready", async () => {
    const mounted = await mountCompiledRoomReady({
      environmentId: ED_BAY,
      compiledRoomAssetUrl: "/compiled/rooms/ed_exam_bay_v1.glb",
      compileNodeId: "room:ed_exam_bay_v1",
      metadata: VALID_METADATA,
      loadGltf: mockLoadGltfFrom(compiledSceneWithAnchors()),
    });
    expect(mounted.mode).toBe("compiled_ready");
    expect(mounted.root.name).toBe("openclinxr.compiled-room-shell");
    expect(mounted.root.userData.openClinXrCompiledRoom).toBe(true);
    expect(mounted.root.userData.openClinXrCompiledRoomReadiness).toBe("ready");
    expect(mounted.collisionBounds).toEqual(VALID_METADATA.collisionBounds);
    expect(mounted.walkableBounds).toEqual(VALID_METADATA.walkableBounds);
    expect(hasParametricFloor(mounted.root)).toBe(false);
    expect(mounted.resolvedAnchors).toHaveLength(3);
  });

  it("falls back to the primitive room on malformed metadata", async () => {
    const mounted = await mountCompiledRoomReady({
      environmentId: ED_BAY,
      compiledRoomAssetUrl: "/compiled/rooms/ed_exam_bay_v1.glb",
      compileNodeId: "room:ed_exam_bay_v1",
      metadata: { actorAnchors: "nope" },
      loadGltf: mockLoadGltfFrom(compiledSceneWithAnchors()),
    });
    expect(mounted.mode).toBe("primitive_fallback");
    expect(mounted.diagnostics[0]?.code).toBe("malformed_metadata");
    expect(mounted.root.name).toBe("openclinxr.station-environment-shell");
    expect(mounted.root.userData.openClinXrCompiledRoom).not.toBe(true);
    expect(mounted.root.userData.openClinXrCompiledRoomFallback).toBe(true);
    expect(hasParametricFloor(mounted.root)).toBe(true);
    expect(mounted.root.children.length).toBeGreaterThan(0);
  });

  it("falls back to the primitive room on load failure", async () => {
    const mounted = await mountCompiledRoomReady({
      environmentId: ED_BAY,
      compiledRoomAssetUrl: "/compiled/rooms/ed_exam_bay_v1.glb",
      compileNodeId: "room:ed_exam_bay_v1",
      metadata: VALID_METADATA,
      loadGltf: async () => {
        throw new Error("gltf 404");
      },
    });
    expect(mounted.mode).toBe("primitive_fallback");
    expect(mounted.diagnostics).toEqual([
      expect.objectContaining({ code: "load_failure", message: "gltf 404" }),
    ]);
    expect(mounted.root.userData.openClinXrCompiledRoomLoadFailed).toBe(true);
    expect(mounted.root.userData.compileNodeIdAttempted).toBe("room:ed_exam_bay_v1");
    expect(hasParametricFloor(mounted.root)).toBe(true);
    expect(mounted.root.userData.openClinXrCompiledRoom).not.toBe(true);
  });

  it("falls back when a declared anchor is missing rather than showing a partial compiled room", async () => {
    const scene = compiledSceneWithAnchors();
    const mounted = await mountCompiledRoomReady({
      environmentId: ED_BAY,
      compiledRoomAssetUrl: "/compiled/rooms/ed_exam_bay_v1.glb",
      compileNodeId: "room:ed_exam_bay_v1",
      metadata: {
        ...VALID_METADATA,
        equipmentAnchors: [
          { id: "missing_kit", kind: "equipment", nodeName: "openclinxr.anchor.equipment.absent" },
        ],
      },
      loadGltf: mockLoadGltfFrom(scene),
    });
    expect(mounted.mode).toBe("primitive_fallback");
    expect(mounted.diagnostics[0]?.code).toBe("missing_anchor");
    expect(mounted.root.name).toBe("openclinxr.station-environment-shell");
    expect(hasParametricFloor(mounted.root)).toBe(true);
    expect(mounted.root.userData.openClinXrCompiledRoom).not.toBe(true);
  });

  it("uses the primitive room when no compiled URL is supplied", async () => {
    const mounted = await mountCompiledRoomReady({ environmentId: ED_BAY });
    expect(mounted.mode).toBe("primitive_fallback");
    expect(mounted.diagnostics[0]?.code).toBe("compiled_asset_absent");
    expect(hasParametricFloor(mounted.root)).toBe(true);
  });
});
