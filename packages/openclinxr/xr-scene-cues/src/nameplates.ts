import type { Group } from "three";
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { SceneCueNameplateContext, SceneCueVirtualDeviceContext } from "./types.js";

export function createActorNameplate(ctx: SceneCueNameplateContext, label: string, accentColor: number): Mesh {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 512;
  canvasElement.height = 128;
  const context = canvasElement.getContext("2d");
  if (!context) {
    throw new Error("Unable to create actor nameplate canvas context");
  }
  context.fillStyle = "rgba(16, 24, 32, 0.86)";
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);
  context.fillStyle = `#${accentColor.toString(16).padStart(6, "0")}`;
  context.fillRect(0, 0, 18, canvasElement.height);
  context.font = "700 34px Verdana, sans-serif";
  context.fillStyle = "#fff8e5";
  context.textBaseline = "middle";
  context.fillText(label, 38, canvasElement.height / 2);
  const texture = new CanvasTexture(canvasElement);
  const nameplate = new Mesh(
    new PlaneGeometry(0.95, 0.24),
    new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
  );
  nameplate.name = `${ctx.scenarioObjectPrefix}.actor-nameplate.${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/-$/u, "")}`;
  nameplate.position.set(0, 1.48, 0);
  if (!ctx.shouldShowIdentityLabels()) {
    nameplate.visible = false;
    nameplate.userData["openClinXrDynamicScenePolicy"] = "hidden_in_generated_encounter_scene_unless_identity_debug_capture";
  }
  return nameplate;
}

export function createVirtualDeviceActorAffordance(
  ctx: SceneCueVirtualDeviceContext,
  createAffordanceMarker: (id: string, color: number) => Mesh,
  buildActorNameplate: (label: string, accentColor: number) => Mesh,
): (actorId: string) => Group {
  return (actorId: string): Group => {
    const placement = ctx.resolvePlacement(actorId);
    return ctx.buildVirtualDeviceAffordance({
      actorId,
      placement,
      createAffordanceMarker,
      createActorNameplate: buildActorNameplate,
      actorNameplateLabel: ctx.actorNameplateLabel,
      registerSlot: ctx.registerSlot,
    });
  };
}
