import type { EncounterRuntimeRoomProp } from "@openclinxr/asset-registry/runtime-bundles";
import type { Group } from "three";
import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from "three";
import type { SceneCueEnvironmentVisualContext, SceneCueRoomPropContext } from "./types.js";

export function createDetailedEdRoomProps(ctx: SceneCueRoomPropContext, 
  manifestProps: readonly EncounterRuntimeRoomProp[],
  fixtureOwnedRoles: readonly string[] = [],
  exclusiveMountedEquipmentIds: ReadonlySet<string> = new Set(),
): Group[] {
  const fallbackPositions = [
    { x: -2.15, y: 0.65, z: -1.02 },
    { x: 1.92, y: 0.82, z: -1.05 },
    { x: -1.55, y: 0.58, z: 0.96 },
    { x: 1.52, y: 0.58, z: 0.92 },
  ];
  const owned = new Set(fixtureOwnedRoles);
  const out: Group[] = [];
  for (const [propIndex, prop] of manifestProps.entries()) {
    if (!ctx.shouldRenderRoomProp(prop)) continue;
    // #186: fixture owns seating/door/board/surface — roomProp is metadata-only for that role.
    if (ctx.roomPropSuppressedByFixtureOwnership(prop.propId, owned)) continue;
    const { color, accentColor } = ctx.roomPropColourNumbers(prop);
    const built = buildRoomPropEntry(ctx,
      prop.propId,
      color,
      accentColor,
      ctx.hasVector3(prop.position)
        ? prop.position
        : fallbackPositions[propIndex % fallbackPositions.length] ?? { x: -2.15, y: 0.65, z: -1.02 },
      ctx.hasVector3(prop.scale) ? prop.scale : { x: 0.42, y: 0.42, z: 0.42 },
      prop.label ?? prop.propId.replaceAll("-", " "),
      Array.isArray(prop.affordanceCueIds) ? prop.affordanceCueIds : [`${prop.propId}:visual_context`],
      exclusiveMountedEquipmentIds,
      typeof prop.semanticRole === "string" ? prop.semanticRole : null,
    );
    if (built) out.push(built);
  }
  return out;
}

function buildRoomPropEntry(ctx: SceneCueRoomPropContext, 
  propId: string,
  color: number,
  accentColor: number,
  position: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
  label: string,
  affordanceCueIds: string[] = [`${propId}:visual_context`],
  exclusiveMountedEquipmentIds: ReadonlySet<string> = new Set(),
  semanticRole: string | null = null,
): Group | null {
  // #185: builder-backed props use station-equipment-builders (ignore scale); XOR skips duals.
  // #223: cue/overlay props keep affordance tags without a scaled unit-box body.
  const group = ctx.buildRoomPropGroup({
    propId,
    color,
    accentColor,
    position,
    scale,
    label,
    affordanceCueIds,
    semanticRole,
    namePrefix: ctx.roomPropObjectPrefix,
    exclusiveMountedEquipmentIds,
    createAffordanceMarker: ctx.createAffordanceMarker,
    createActorNameplate: ctx.createActorNameplate,
    addFallbackDetailVisuals: (detailGroup, detailPropId, detailLabel, detailScale, detailColor, detailAccentColor) => addDetailedRoomPropVisuals(detailGroup, detailPropId, detailLabel, detailScale, detailColor, detailAccentColor),
  });
  if (group) ctx.registerReactiveProp(propId, group);
  return group;
}

export function addDetailedRoomPropVisuals(
  group: Group,
  propId: string,
  label: string,
  scale: { x: number; y: number; z: number },
  color: number,
  accentColor: number,
): void {
  const semanticKey = `${propId} ${label}`.toLowerCase();
  const detailCueIds: string[] = [];
  const addDetail = (mesh: Mesh, name: string, cueId: string): void => {
    mesh.name = `${group.name}.${name}`;
    mesh.userData["openClinXrDetailCueId"] = cueId;
    group.add(mesh);
    detailCueIds.push(cueId);
  };

  if (semanticKey.includes("tissue") || semanticKey.includes("empathy") || semanticKey.includes("communication")) {
    addDetail(new Mesh(
      new BoxGeometry(0.34, 0.08, 0.18),
      new MeshStandardMaterial({ color: 0xced9e6, roughness: 0.74 }),
    ), "tissue-box", "manifest_prop_tissue_box_for_empathy_workflow");
    addDetail(new Mesh(
      new BoxGeometry(0.16, 0.018, 0.12),
      new MeshStandardMaterial({ color: 0xf7f8f2, roughness: 0.92 }),
    ), "raised-tissue", "manifest_prop_visible_tissue_for_emotional_disclosure");
    group.children.at(-1)?.position.set(0, scale.y + 0.08, 0);
  } else if (semanticKey.includes("chair") || semanticKey.includes("visitor") || semanticKey.includes("caregiver") || semanticKey.includes("objective")) {
    const chairMaterial = new MeshStandardMaterial({ color: 0x465766, roughness: 0.82 });
    const seat = new Mesh(new BoxGeometry(0.42, 0.08, 0.42), chairMaterial);
    seat.position.set(0, scale.y + 0.02, 0);
    addDetail(seat, "chair-seat", "manifest_prop_chair_seat_for_family_presence");
    const back = new Mesh(new BoxGeometry(0.42, 0.48, 0.06), chairMaterial);
    back.position.set(0, scale.y + 0.27, -0.2);
    addDetail(back, "chair-back", "manifest_prop_chair_back_for_seated_actor_context");
    for (const [index, x] of [-0.16, 0.16].entries()) {
      for (const z of [-0.16, 0.16]) {
        const leg = new Mesh(new CylinderGeometry(0.018, 0.018, 0.34, 8), chairMaterial);
        leg.position.set(x, scale.y - 0.15, z);
        addDetail(leg, `chair-leg-${index}-${z > 0 ? "front" : "back"}`, "manifest_prop_chair_leg_scale_cue");
      }
    }
  } else if (semanticKey.includes("whiteboard") || semanticKey.includes("handoff") || semanticKey.includes("review")) {
    const board = new Mesh(
      new BoxGeometry(Math.max(scale.x * 1.8, 0.9), Math.max(scale.y * 1.2, 0.42), 0.025),
      new MeshStandardMaterial({ color: 0xf4f8f2, roughness: 0.55 }),
    );
    board.position.set(0, scale.y + 0.14, -0.03);
    addDetail(board, "whiteboard-surface", "manifest_prop_whiteboard_clinical_context_surface");
    const markerRail = new Mesh(new BoxGeometry(0.58, 0.025, 0.035), new MeshStandardMaterial({ color: accentColor, roughness: 0.58 }));
    markerRail.position.set(0, scale.y - 0.12, 0.015);
    addDetail(markerRail, "marker-rail", "manifest_prop_whiteboard_marker_rail_readability_cue");
  } else if (semanticKey.includes("door") || semanticKey.includes("sign") || semanticKey.includes("primary-context")) {
    const plate = new Mesh(
      new BoxGeometry(Math.max(scale.x * 1.7, 0.64), Math.max(scale.y * 0.9, 0.24), 0.035),
      new MeshStandardMaterial({ color: 0xf5ead0, roughness: 0.68 }),
    );
    plate.position.set(0, scale.y + 0.08, 0);
    addDetail(plate, "doorway-sign-plate", "manifest_prop_doorway_sign_station_orientation_cue");
    const stripe = new Mesh(new BoxGeometry(0.58, 0.028, 0.045), new MeshStandardMaterial({ color: accentColor, roughness: 0.5 }));
    stripe.position.set(0, scale.y + 0.22, 0.025);
    addDetail(stripe, "doorway-sign-accent", "manifest_prop_doorway_sign_accent_cue");
  } else if (semanticKey.includes("supply") || semanticKey.includes("cart") || semanticKey.includes("tray")) {
    for (let shelfIndex = 0; shelfIndex < 3; shelfIndex += 1) {
      const shelf = new Mesh(
        new BoxGeometry(Math.max(scale.x * 1.4, 0.38), 0.035, Math.max(scale.z * 1.4, 0.28)),
        new MeshStandardMaterial({ color: shelfIndex % 2 === 0 ? color : 0xe4e8e8, roughness: 0.72 }),
      );
      shelf.position.set(0, scale.y - 0.14 + shelfIndex * 0.15, 0);
      addDetail(shelf, `cart-shelf-${shelfIndex}`, "manifest_prop_supply_cart_shelf_workflow_cue");
    }
  } else {
    const accentBand = new Mesh(
      new BoxGeometry(Math.max(scale.x * 1.08, 0.16), 0.025, Math.max(scale.z * 1.08, 0.08)),
      new MeshStandardMaterial({ color: accentColor, roughness: 0.62 }),
    );
    accentBand.position.set(0, scale.y + 0.035, 0);
    addDetail(accentBand, "semantic-accent-band", "manifest_prop_semantic_detail_accent_cue");
  }

  group.userData["openClinXrDynamicRoomPropDetailCueIds"] = detailCueIds;
}

export function updateEnvironmentRealismAnimations(ctx: SceneCueEnvironmentVisualContext, deltaSeconds: number, nowMs: number): void {
  const evidence = window.__openClinXrEnvironmentStateEvidence;
  const activeProps = new Set(evidence?.activePropIds ?? []);
  const pulse = evidence?.environmentMotionCueMode === "deterministic_visual_pulse"
    ? 0.5 + Math.sin(nowMs / 260) * 0.5
    : 0;
  for (const [propId, group] of ctx.reactiveProps) {
    const active = activeProps.has(propId);
    const baseY = typeof group.userData["openClinXrBaseY"] === "number" ? group.userData["openClinXrBaseY"] : group.position.y;
    group.position.y = baseY + (active ? pulse * 0.018 : 0);
    group.children.forEach((child) => {
      if (child.name.includes(".label")) {
        child.visible = active || propId === "doorway-station-sign" || propId === "patient-handoff-whiteboard";
      }
      if (child.name.includes("glb-affordance")) {
        child.rotation.y += deltaSeconds * (active ? 1.6 : 0.35);
      }
    });
  }
}

