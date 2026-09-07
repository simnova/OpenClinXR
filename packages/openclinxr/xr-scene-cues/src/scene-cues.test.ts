import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPediatricRespiratoryEquipmentCues,
  applyCleanEncounterVisualReviewActorFraming,
  recordDynamicSceneObjectNamingEvidence,
  recordPediatricRespiratoryEquipmentCue,
  recordRoleDistinctHumanoidCue,
} from "./cue-evidence.js";
import {
  createAffordanceMarker,
  createHumanoidExpressionCue,
  createHumanoidEyeFocusCue,
  createHumanoidEyeGazeCue,
  createHumanoidInteractionCollisionCues,
  createHumanoidSpeechMouthCue,
  createRuntimeHumanoidDetailCues,
} from "./humanoid-cues.js";
import {
  createActorNameplate,
  createVirtualDeviceActorAffordance,
} from "./nameplates.js";
import {
  createDetailedEdRoomProps,
  updateEnvironmentRealismAnimations,
} from "./room-props.js";
import { createClinicalPanel, createReadableVrTextPanel } from "./scene-panels.js";
import {
  applyEnvironmentStateVisuals,
  applyRuntimeEquipmentTraceVisuals,
  ensureRuntimeEquipmentTraceMarker,
  runtimeEquipmentIdsForTag,
} from "./trace-visuals.js";

function textCtx() {
  return {
    clinicalPanelObjectName: "openclinxr.test.clinical-panel",
    evidenceStore: new Map(),
    clinicalPanelLines: () => ["Chief concern: cough", "Vitals/context: stable"],
    buildTextPanelEvidence: (input: {
      name: string;
      title: string;
      lines: readonly string[];
      canvasPixels: { width: number; height: number };
      worldMeters: { width: number; height: number };
      updatedAtMs: number;
    }) => ({
      name: input.name,
      title: input.title,
      source: "canvas_texture_metadata" as const,
      canvasPixels: { ...input.canvasPixels },
      worldMeters: { ...input.worldMeters },
      lineCount: input.lines.length,
      previewLines: [...input.lines],
      contentHash: "test-hash",
      lastUpdatedAtMs: input.updatedAtMs,
      readabilityClaim: "metadata_only_requires_foreground_headset_confirmation" as const,
    }),
  };
}

function cueCtx() {
  return { scenarioObjectPrefix: "openclinxr.test", shouldShowAffordanceMarkers: () => true };
}

describe("xr-scene-cues", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillRect: () => {},
          fillText: () => {},
          measureText: () => ({ width: 10 }),
          fillStyle: "",
          font: "",
          textBaseline: "",
        }),
      }),
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("performance", { now: () => 100 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a clinical panel and a readable text panel", () => {
    const ctx = textCtx();
    const panel = createClinicalPanel(ctx);
    expect(panel.mesh.name).toBe("openclinxr.test.clinical-panel");
    const other = createReadableVrTextPanel(ctx, {
      name: "openclinxr.test.note",
      title: "Note",
      lines: ["hello"],
      widthMeters: 1,
      heightMeters: 0.5,
      background: "#fff",
      accent: "#000",
    });
    expect(other.mesh.name).toBe("openclinxr.test.note");
    other.update(["hello", "again"]);
    const stored = (window as unknown as {
      __openClinXrTextPanelEvidence?: { panelCount: number };
    }).__openClinXrTextPanelEvidence;
    expect(stored?.panelCount).toBe(2);
  });

  it("creates an actor nameplate with a slug name", () => {
    const plate = createActorNameplate(
      { scenarioObjectPrefix: "openclinxr.test", shouldShowIdentityLabels: () => true },
      "Remote: maya johnson",
      0x79d4ff,
    );
    expect(plate.name).toContain("openclinxr.test.actor-nameplate");
  });

  it("creates a virtual-device affordance through the injected builder", () => {
    const seen: string[] = [];
    const make = createVirtualDeviceActorAffordance(
      {
        resolvePlacement: () => ({
          position: { x: -2, y: 1.05, z: 0.7 },
          scale: { x: 0.72, y: 0.72, z: 0.72 },
          labelPrefix: "Remote",
        }),
        actorNameplateLabel: (prefix: string, actorId: string) => `${prefix}: ${actorId}`,
        registerSlot: (actorId: string) => {
          seen.push(actorId);
        },
        buildVirtualDeviceAffordance: (input: { actorId: string; registerSlot: (actorId: string, group: Group) => void }) => {
          const group = new Group();
          group.name = `openclinxr.virtual-device-actor.${input.actorId}`;
          input.registerSlot(input.actorId, group);
          return group;
        },
      },
      (_id: string) => new Mesh(new BoxGeometry(0.05, 0.05, 0.05), new MeshBasicMaterial()),
      (_label: string) => new Mesh(new BoxGeometry(0.09, 0.02, 0.01), new MeshBasicMaterial()),
    );
    const group = make("remote_actor_v1");
    expect(group.name).toBe("openclinxr.virtual-device-actor.remote_actor_v1");
    expect(seen).toEqual(["remote_actor_v1"]);
  });

  it("creates humanoid detail cues with scenario-prefixed names", () => {
    const ctx = cueCtx();
    expect(createAffordanceMarker(ctx, "cue:one", 0xff0000).name).toContain("openclinxr.test.glb-affordance");
    expect(createHumanoidSpeechMouthCue(ctx, "asset:1", 0).name).toContain("openclinxr.test.phoneme-mouth-cue");
    expect(createHumanoidEyeGazeCue(ctx, "asset:1", 0).name).toContain("openclinxr.test.eye-gaze-cue");
    expect(createHumanoidEyeFocusCue(ctx, "asset:1").name).toContain("openclinxr.test.eye-focus-cue");
    expect(createHumanoidExpressionCue(ctx, "asset:1").name).toContain("openclinxr.test.runtime-expression-cue");
    expect(createRuntimeHumanoidDetailCues(ctx, "asset:1").name).toContain(
      "openclinxr.test.generated-humanoid-detail-cues",
    );
    expect(createHumanoidInteractionCollisionCues(ctx, "asset:1").name).toContain(
      "openclinxr.test.humanoid-interaction-collision",
    );
  });

  it("maps trace tags to equipment ids and toggles trace markers", () => {
    expect(runtimeEquipmentIdsForTag(["oxygen_wall_port", "stretcher_bed"], "oxygen_started")).toContain(
      "oxygen_wall_port",
    );
    expect(runtimeEquipmentIdsForTag(["parent_chair"], "parent_communication")).toContain("parent_chair");
    expect(runtimeEquipmentIdsForTag(["stretcher_bed"], "note_documentation")).toContain("stretcher_bed");
    expect(runtimeEquipmentIdsForTag(["stretcher_bed"], "unrelated_tag")).toEqual([]);
    const slot = new Group();
    const traceCtx = {
      scenarioObjectPrefix: "openclinxr.test",
      equipmentSlots: new Map([["oxygen_wall_port", slot]]),
      equipmentIdsForTag: (tag: string) => runtimeEquipmentIdsForTag(["oxygen_wall_port"], tag),
    };
    applyRuntimeEquipmentTraceVisuals(traceCtx, {
      activePropIds: ["oxygen_wall_port"],
      activeTraceTags: ["oxygen_started"],
    } as never);
    const marker = ensureRuntimeEquipmentTraceMarker(traceCtx, slot, "oxygen_wall_port");
    expect(marker.visible).toBe(true);
    expect(marker.name).toBe("openclinxr.test.equipment-trace-active.oxygen_wall_port");
  });

  it("applies environment state visuals and alarm cues", () => {
    const group = new Group();
    const card = new Mesh(new BoxGeometry(0.2, 0.1, 0.02), new MeshBasicMaterial({ transparent: true }));
    group.add(card);
    const ctx = { reactiveProps: new Map([["monitor-waveform-card", group]]) };
    applyEnvironmentStateVisuals(ctx, {
      activePropIds: ["monitor-waveform-card"],
      activeTraceTags: [],
      alarmCueMode: "visual_only_no_audio",
      alarmState: "urgent",
    } as never);
    expect(group.userData["openClinXrEnvironmentStateActive"]).toBe(true);
    expect(group.userData["openClinXrVisualAlarmCue"]).toBe("urgent");
    expect(group.scale.x).toBeCloseTo(1.08);
  });

  it("animates reactive props with the deterministic visual pulse", () => {
    const group = new Group();
    group.position.y = 1;
    (window as unknown as { __openClinXrEnvironmentStateEvidence?: unknown }).__openClinXrEnvironmentStateEvidence =
      {
        activePropIds: ["doorway-station-sign"],
        environmentMotionCueMode: "deterministic_visual_pulse",
      };
    updateEnvironmentRealismAnimations({ reactiveProps: new Map([["doorway-station-sign", group]]) }, 0.016, 260);
    expect(group.position.y).toBeGreaterThan(1);
  });

  it("builds detailed room props and registers reactive props", () => {
    const registered: string[] = [];
    const props = createDetailedEdRoomProps(
      {
        scenarioObjectPrefix: "openclinxr.test",
        createAffordanceMarker: (_id: string) =>
          new Mesh(new BoxGeometry(0.05, 0.05, 0.05), new MeshBasicMaterial()),
        createActorNameplate: (_label: string) =>
          new Mesh(new BoxGeometry(0.09, 0.02, 0.01), new MeshBasicMaterial()),
        roomPropObjectPrefix: "openclinxr.test.room-prop",
        shouldRenderRoomProp: () => true,
        roomPropColourNumbers: () => ({ color: 0xffffff, accentColor: 0x000000 }),
        roomPropSuppressedByFixtureOwnership: () => false,
        buildRoomPropGroup: (input: { propId: string; namePrefix: string }) => {
          const group = new Group();
          group.name = `${input.namePrefix}.${input.propId}`;
          return group;
        },
        hasVector3: (value: unknown): value is { x: number; y: number; z: number } =>
          !!value && typeof value === "object",
        registerReactiveProp: (propId: string) => {
          registered.push(propId);
        },
      },
      [
        {
          propId: "tissue-box",
          label: "tissue box",
          semanticRole: "communication_cue",
          evidenceCue: "tissue-box:cue",
          colorHex: "#ffffff",
          accentColorHex: "#000000",
          position: { x: 0, y: 1, z: 0 },
          scale: { x: 0.4, y: 0.4, z: 0.4 },
          affordanceCueIds: ["tissue-box:visual_context"],
          interactionTags: [],
          generatedBy: "scene_manifest",
        },
      ] as never,
    );
    expect(props).toHaveLength(1);
    expect(registered).toEqual(["tissue-box"]);
  });

  it("records naming, role, pediatric, and framing evidence", () => {
    const scene = new Scene();
    const named = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial());
    named.name = "openclinxr.test.peds-exam-table";
    scene.add(named);
    const naming = recordDynamicSceneObjectNamingEvidence(
      {
        scenarioId: "test_scenario",
        selectedScenarioId: "test_scenario",
        selectedScenarioMatchesBundle: true,
        stableIwsdkObjectNames: [],
        scenarioObjectPrefix: "openclinxr.test",
      },
      scene,
    );
    expect(naming.totalNamedObjects).toBeGreaterThan(0);
    expect(naming.scenarioPrefixedObjectCount).toBeGreaterThan(0);
    recordRoleDistinctHumanoidCue(
      { scenarioId: "test_scenario", runtimeActorRole: () => "patient" },
      "actor_a",
      "cue_one",
      "openclinxr.test.cue-mesh",
    );
    const roleEvidence = (
      window as unknown as {
        __openClinXrRoleDistinctHumanoidCueEvidence?: { cueCount: number };
      }
    ).__openClinXrRoleDistinctHumanoidCueEvidence;
    expect(roleEvidence?.cueCount).toBe(1);
    const slot = new Group();
    addPediatricRespiratoryEquipmentCues(
      { scenarioObjectPrefix: "openclinxr.test", isPediatricScenario: () => true },
      (equipmentId: string, cueId: string, sceneObjectName: string) =>
        recordPediatricRespiratoryEquipmentCue({ scenarioId: "test_scenario" }, equipmentId, cueId, sceneObjectName),
      slot,
      "nebulizer_mask_unit",
    );
    expect(slot.children.length).toBeGreaterThan(0);
    const actor = new Group();
    let framed = false;
    applyCleanEncounterVisualReviewActorFraming(
      {
        scenarioId: "test_scenario",
        runtimeActorRole: () => "patient",
        selectedScenarioId: () => "test_scenario",
        skipFraming: true,
        applyActorFraming: () => {
          framed = true;
        },
        onWardrobeCue: () => {},
      },
      actor,
      "actor_a",
    );
    expect(framed).toBe(true);
  });
});
