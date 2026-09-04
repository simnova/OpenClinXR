import { Group, Mesh, BoxGeometry, MeshBasicMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { EncounterRuntimeAsset } from "@openclinxr/asset-registry/runtime-bundles";
import {
  evaluateCompiledRoomReadiness,
  parseCompiledRoomAuthoredMetadata,
  type CompiledRoomAuthoredMetadata,
} from "./compiled-room-readiness.js";
import { mountStationEnvironmentForRuntime } from "./compiled-room-runtime-mount.js";

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

function compiledEnvironment(environmentId: string, url: string): EncounterRuntimeAsset {
  return {
    assetId: `compiled_${environmentId}_room`,
    version: "v1",
    kind: "environment_model",
    displayName: "compiled room",
    scenarioAssetId: environmentId,
    blob: {
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
      blobName: `compiled/${environmentId}.glb`,
      url,
    },
    reviewStatus: "approved_for_local_runtime",
    provenanceRefs: [`room:${environmentId}`],
    notEvidenceFor: ["quest_readiness", "clinical_validity"],
  };
}

function mountCompiled(input: {
  scene?: Group;
  metadata?: unknown;
  loadGltf?: (url: string) => Promise<Group>;
}): Promise<Group> {
  const scene = input.scene ?? compiledSceneWithAnchors();
  if (input.metadata !== undefined) {
    scene.userData.openClinXrCompiledRoomMetadata = input.metadata;
  }
  return mountStationEnvironmentForRuntime({
    environmentId: ED_BAY,
    environment: compiledEnvironment(ED_BAY, "/compiled/rooms/ed_exam_bay_v1.glb"),
    loadGltf: input.loadGltf ?? mockLoadGltfFrom(scene),
  });
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

describe("mountStationEnvironmentForRuntime readiness composition", () => {
  it("keeps the compiled GLB when authored metadata and unique anchors are ready", async () => {
    const mounted = await mountCompiled({ metadata: VALID_METADATA });
    expect(mounted.name).toBe("openclinxr.compiled-room-shell");
    expect(mounted.userData.openClinXrCompiledRoom).toBe(true);
    expect(mounted.userData.openClinXrCompiledRoomReadiness).toBe("ready");
    expect(mounted.userData.openClinXrCompiledRoomCollisionBounds).toEqual(
      VALID_METADATA.collisionBounds,
    );
    expect(mounted.userData.openClinXrCompiledRoomWalkableBounds).toEqual(
      VALID_METADATA.walkableBounds,
    );
    expect(mounted.userData.openClinXrCompiledRoomResolvedAnchors).toHaveLength(3);
    expect(hasParametricFloor(mounted)).toBe(false);
  });

  it("falls back to the primitive room on malformed metadata with typed diagnostics", async () => {
    const mounted = await mountCompiled({ metadata: { actorAnchors: "nope" } });
    expect(mounted.name).toBe("openclinxr.station-environment-shell");
    expect(mounted.userData.openClinXrCompiledRoom).not.toBe(true);
    expect(mounted.userData.openClinXrCompiledRoomFallback).toBe(true);
    expect(mounted.userData.openClinXrCompiledRoomDiagnostics).toEqual([
      expect.objectContaining({ code: "malformed_metadata" }),
    ]);
    expect(hasParametricFloor(mounted)).toBe(true);
  });

  it("falls back when a declared anchor is missing", async () => {
    const mounted = await mountCompiled({
      metadata: {
        ...VALID_METADATA,
        equipmentAnchors: [
          { id: "missing_kit", kind: "equipment", nodeName: "openclinxr.anchor.equipment.absent" },
        ],
      },
    });
    expect(mounted.name).toBe("openclinxr.station-environment-shell");
    expect(mounted.userData.openClinXrCompiledRoomDiagnostics).toEqual([
      expect.objectContaining({
        code: "missing_anchor",
        anchorId: "missing_kit",
        nodeName: "openclinxr.anchor.equipment.absent",
      }),
    ]);
    expect(hasParametricFloor(mounted)).toBe(true);
  });

  it("falls back when a declared anchor node is duplicated in the scene", async () => {
    const scene = compiledSceneWithAnchors();
    scene.add(namedEmpty("openclinxr.anchor.actor.patient", 0, 0));
    const mounted = await mountCompiled({ scene, metadata: VALID_METADATA });
    expect(mounted.name).toBe("openclinxr.station-environment-shell");
    expect(mounted.userData.openClinXrCompiledRoomDiagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "duplicate_anchor" })]),
    );
    expect(hasParametricFloor(mounted)).toBe(true);
  });

  it("falls back to the primitive room on load failure with typed diagnostics", async () => {
    const mounted = await mountCompiled({
      loadGltf: async () => {
        throw new Error("gltf 404");
      },
    });
    expect(mounted.name).toBe("openclinxr.station-environment-shell");
    expect(mounted.userData.openClinXrCompiledRoomLoadFailed).toBe(true);
    expect(mounted.userData.compileNodeIdAttempted).toBe("room:ed_exam_bay_v1");
    expect(mounted.userData.openClinXrCompiledRoomDiagnostics).toEqual([
      expect.objectContaining({ code: "load_failure", message: "gltf 404" }),
    ]);
    expect(mounted.userData.openClinXrCompiledRoom).not.toBe(true);
    expect(hasParametricFloor(mounted)).toBe(true);
  });

  it("preserves PR #789 compiled mount when authored metadata is absent", async () => {
    const mounted = await mountCompiled({ scene: new Group() });
    expect(mounted.name).toBe("openclinxr.compiled-room-shell");
    expect(mounted.userData.openClinXrCompiledRoom).toBe(true);
    expect(mounted.userData.openClinXrCompiledRoomReadiness).toBeUndefined();
    expect(mounted.userData.openClinXrCompiledRoomFallback).toBeUndefined();
    expect(hasParametricFloor(mounted)).toBe(false);
  });
});
