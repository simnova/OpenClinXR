import { type AxisAlignedBox, actorCrownChestVisibleEarly, actorSamplePoints, type GateOccluder, type Vec3 } from "../evidence/station-capture/gate-geometry.js";
import { CLINICAL_SLOT_TEMPLATES } from "./clinical-slot-templates.js";
import { type LayoutCandidate, layContact, sitContact, standContact } from "./contact-solvers.js";
import type { CachedSceneSnapshot } from "./staging-types.js";
export type LearnerStance = { slotId: "physician_bedside"; world: [number, number, number] };
export type LayoutSearchResult = { layouts: LayoutCandidate[][]; bindingConstraint?: string; learnerStance?: LearnerStance };

const OFFSETS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] as const;
const HEADING_DELTAS = [-Math.PI / 6, -Math.PI / 12, 0, Math.PI / 12, Math.PI / 6] as const;
const STANDING_HEIGHT_METERS = 1.7;
const SEATED_HEIGHT_METERS = 1.3;

function centre(box: AxisAlignedBox): Vec3 {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

function horizontalArea(box: AxisAlignedBox): number {
  return (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]);
}

function translateBox(box: AxisAlignedBox, x: number, z: number): AxisAlignedBox {
  const current = centre(box);
  return {
    min: [box.min[0] + x - current[0], box.min[1], box.min[2] + z - current[2]],
    max: [box.max[0] + x - current[0], box.max[1], box.max[2] + z - current[2]],
  };
}

function intersects(a: AxisAlignedBox, b: AxisAlignedBox, pad = 0): boolean {
  return a.min[0] < b.max[0] + pad && a.max[0] > b.min[0] - pad
    && a.min[1] < b.max[1] && a.max[1] > b.min[1]
    && a.min[2] < b.max[2] + pad && a.max[2] > b.min[2] - pad;
}

function isRoomShellName(name: string): boolean {
  return /wall|floor|ceiling|exterior|shell/i.test(name);
}

function isSkippedFixtureName(name: string): boolean {
  return /portal|review-panel|review_panel|capture-cue|capture_cue|patient-note-capture|patient_note_capture/i.test(name);
}

// Name-agnostic backstop for shell slabs that dodge the name classes (renamed
// room shells, merged shell geometry). Threshold 0.5 separates with wide
// margin: shell slabs cover ~all of the interior footprint (floor_field
// 6.47x6.79 m over a 6.47x6.79 m interior ~= 1.0), while the largest
// legitimate furniture (stretcher base 2.02x0.79 m ~= 1.6 m^2 over a ~44 m^2
// interior ~= 0.04) sits more than 10x below.
function coversInteriorFootprint(box: AxisAlignedBox, interior: AxisAlignedBox): boolean {
  const interiorArea = (interior.max[0] - interior.min[0]) * (interior.max[2] - interior.min[2]);
  if (!(interiorArea > 0)) return false;
  const footprint = (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]);
  return footprint / interiorArea >= 0.5;
}

export function isPlacementShellFixture(name: string, box: AxisAlignedBox, interior: AxisAlignedBox): boolean {
  return isRoomShellName(name) || isSkippedFixtureName(name) || coversInteriorFootprint(box, interior);
}

export function capsuleRadiusMeters(bodyDimensions: readonly number[] | undefined): number {
  const width = bodyDimensions?.[0];
  if (typeof width === "number" && Number.isFinite(width) && width >= 0.15 && width <= 0.35) return width / 2;
  return 0.22;
}

export function capsuleForPlacement(world: readonly [number, number, number], radius: number, standing: boolean): AxisAlignedBox {
  const height = standing ? STANDING_HEIGHT_METERS : SEATED_HEIGHT_METERS;
  return { min: [world[0] - radius, world[1] - height / 2, world[2] - radius], max: [world[0] + radius, world[1] + height / 2, world[2] + radius] };
}

function supportKind(name: string): "stretcher" | "bed" | "exam_table" {
  if (/exam[_ -]?table|exam_surface/i.test(name)) return "exam_table";
  if (/stretcher/i.test(name)) return "stretcher";
  return "bed";
}

type SupportFrame = {
  supportName: string;
  long: [number, number];
  side: [number, number];
  head: [number, number];
  foot: [number, number];
  patientHead: Vec3;
  nurseAnchor: [number, number];
};

function supportFrame(snapshot: CachedSceneSnapshot): SupportFrame | null {
  const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
  if (!patient) return null;
  const supports = [...snapshot.patientSupports].sort((a, b) => horizontalArea(b.box) - horizontalArea(a.box) || a.name.localeCompare(b.name));
  const support = supports[0];
  if (!support) return null;
  const supportCentre = centre(support.box);
  const patientHead = actorSamplePoints(patient.box, patient.recumbent)[0]?.point ?? patient.chest;
  const width = support.box.max[0] - support.box.min[0], depth = support.box.max[2] - support.box.min[2];
  let long: [number, number] = width >= depth ? [1, 0] : [0, 1];
  if ((patientHead[0] - supportCentre[0]) * long[0] + (patientHead[2] - supportCentre[2]) * long[1] < 0) long = [-long[0], -long[1]];
  const side: [number, number] = [-long[1], long[0]];
  const halfLong = (width >= depth ? width : depth) / 2;
  const head: [number, number] = [supportCentre[0] + long[0] * halfLong, supportCentre[2] + long[1] * halfLong];
  const foot: [number, number] = [supportCentre[0] - long[0] * halfLong, supportCentre[2] - long[1] * halfLong];
  const nurseAnchor: [number, number] = [
    head[0] + long[0] * -0.35 + side[0] * -1 * 0.62,
    head[1] + long[1] * -0.35 + side[1] * -1 * 0.62,
  ];
  return { supportName: support.name, long, side, head, foot, patientHead, nurseAnchor };
}

function stanceInsideInterior(x: number, z: number, interior: AxisAlignedBox): boolean {
  return x >= interior.min[0] + 0.08 && x <= interior.max[0] - 0.08
    && z >= interior.min[2] + 0.08 && z <= interior.max[2] - 0.08;
}

function stanceInDoor(snapshot: CachedSceneSnapshot, x: number, z: number): boolean {
  const doors = snapshot.fixtures.filter((fixture) => fixture.kind === "door");
  if (snapshot.door && !doors.some((door) => door.name === snapshot.door?.name)) doors.push(snapshot.door);
  return doors.some((door) => x >= door.box.min[0] && x <= door.box.max[0] && z >= door.box.min[2] && z <= door.box.max[2]);
}

function clearOfNpcCapsules(layout: readonly LayoutCandidate[], x: number, z: number, ignoreActorId?: string): boolean {
  return layout.every((row) => ignoreActorId === row.actorId || Math.hypot(x - row.world[0], z - row.world[2]) >= 0.45);
}

function patientCrownChestClear(snapshot: CachedSceneSnapshot, layout: readonly LayoutCandidate[], eye: Vec3): boolean {
  const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
  if (!patient) return false;
  const occluders: GateOccluder[] = [];
  for (const row of layout) {
    if (row.actorId === patient.id) continue;
    const actor = snapshot.actors.find((candidate) => candidate.id === row.actorId);
    if (!actor) continue;
    occluders.push({ actorId: actor.id, name: actor.id, box: translateBox(actor.box, row.world[0], row.world[2]) });
  }
  for (const occluder of snapshot.occluders) {
    if (/review-panel|review_panel/i.test(occluder.name)) occluders.push(occluder);
  }
  return actorCrownChestVisibleEarly(eye, { id: patient.id, box: patient.box, recumbent: patient.recumbent }, occluders);
}

function stanceAccepts(snapshot: CachedSceneSnapshot, layout: readonly LayoutCandidate[], x: number, z: number, ignoreActorId?: string): boolean {
  if (!stanceInsideInterior(x, z, snapshot.interior)) return false;
  if (!clearOfNpcCapsules(layout, x, z, ignoreActorId)) return false;
  if (stanceInDoor(snapshot, x, z)) return false;
  return patientCrownChestClear(snapshot, layout, [x, STANDING_HEIGHT_METERS, z]);
}

// Heading does not move the learner. The winner is the first OFFSETS pair in slot-search order.
function learnerStanceForLayout(snapshot: CachedSceneSnapshot, layout: readonly LayoutCandidate[], frame: SupportFrame): LearnerStance | null {
  const physician = layout.find((row) => snapshot.actors.some((actor) => actor.id === row.actorId && actor.role === "physician"));
  if (physician) {
    const [x, , z] = physician.world;
    return stanceAccepts(snapshot, layout, x, z, physician.actorId)
      ? { slotId: "physician_bedside", world: [x, STANDING_HEIGHT_METERS, z] }
      : null;
  }
  const template = CLINICAL_SLOT_TEMPLATES.find((row) => row.slotId === "physician_bedside");
  if (!template || template.anchor === "chair") return null;
  const anchor = template.anchor === "head" ? frame.head
    : template.anchor === "foot" ? frame.foot
      : [
          frame.head[0] + frame.long[0] * template.alongMeters + frame.side[0] * template.side * template.acrossMeters,
          frame.head[1] + frame.long[1] * template.alongMeters + frame.side[1] * template.side * template.acrossMeters,
        ] as [number, number];
  for (const alongOffset of OFFSETS) for (const acrossOffset of OFFSETS) for (const headingDelta of HEADING_DELTAS) {
    const x = anchor[0] + frame.long[0] * alongOffset + frame.side[0] * acrossOffset;
    const z = anchor[1] + frame.long[1] * alongOffset + frame.side[1] * acrossOffset;
    if (!Number.isFinite(headingDelta) || !stanceAccepts(snapshot, layout, x, z)) continue;
    return { slotId: "physician_bedside", world: [x, STANDING_HEIGHT_METERS, z] };
  }
  return null;
}

function compatible(candidate: LayoutCandidate, assigned: readonly LayoutCandidate[]): boolean {
  return assigned.every((other) => {
    if (other.slotId === "patient_on_authored_support" || candidate.slotId === "patient_on_authored_support") return true;
    if (candidate.standing && other.standing
      && Math.hypot(candidate.world[0] - other.world[0], candidate.world[2] - other.world[2]) < 0.45) return false;
    return !intersects(candidate.box, other.box, 0.02);
  });
}

function keepSemanticDiversity(layouts: LayoutCandidate[][], limit: number): LayoutCandidate[][] {
  const selected: LayoutCandidate[][] = [];
  const signatures = new Set<string>();
  for (const layout of layouts) {
    const signature = layout.map((row) => `${row.actorId}:${row.slotId}`).sort().join("|");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    selected.push(layout);
  }
  for (const layout of layouts) {
    if (selected.length >= limit) break;
    if (!selected.includes(layout)) selected.push(layout);
  }
  return selected.slice(0, limit);
}

export function searchClinicalLayouts(snapshot: CachedSceneSnapshot, beamWidth = 64): LayoutSearchResult {
  const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
  if (!patient) return { layouts: [], bindingConstraint: "no patient actor" };
  if (snapshot.patientSupports.length === 0) return { layouts: [], bindingConstraint: "no patient support anchor detected" };
  const fixedPatient = layContact(snapshot);
  let beam: LayoutCandidate[][] = [[fixedPatient]];
  const movable = snapshot.actors.filter((actor) => actor.id !== patient.id).sort((a, b) => a.id.localeCompare(b.id));
  for (const actor of movable) {
    let candidates: LayoutCandidate[];
    if (actor.currentPlacement.supportSurface === "chair") {
      const frame0 = supportFrame(snapshot);
      if (!frame0) return { layouts: [], bindingConstraint: `${actor.id}: companion_chair` };
      // Keep the authored chair contact, while admitting a real standing
      // bedside fallback when the generated room puts that chair outside every
      // containable camera view. The fallback is persisted like any other
      // candidate; camera scoring must never rewrite a layout in secret.
      candidates = [
        ...sitContact(snapshot, actor, frame0),
        ...standContact(snapshot, actor, frame0, "none").map((candidate) => ({
          ...candidate,
          cost: candidate.cost + 1,
        })),
      ];
      if (candidates.length === 0) return { layouts: [], bindingConstraint: `${actor.id}: companion_chair` };
    } else {
      const frame0 = supportFrame(snapshot);
      candidates = frame0 ? standContact(snapshot, actor, frame0) : [];
    }
    if (candidates.length === 0) {
      const seatedFamily = actor.role === "family" && actor.currentPlacement.supportSurface === "chair";
      return { layouts: [], bindingConstraint: seatedFamily
        ? `${actor.id}: companion_chair`
        : `${actor.id}: no candidate inside template/interior without fixture collision` };
    }
    const next: LayoutCandidate[][] = [];
    for (const layout of beam) for (const candidate of candidates) {
      if (compatible(candidate, layout)) next.push([...layout, candidate]);
    }
    next.sort((a, b) => a.reduce((sum, row) => sum + row.cost, 0) - b.reduce((sum, row) => sum + row.cost, 0)
      || JSON.stringify(a).localeCompare(JSON.stringify(b)));
    beam = keepSemanticDiversity(next, beamWidth);
    if (beam.length === 0) return { layouts: [], bindingConstraint: `${actor.id}: 0.45 m footprint/fixture constraint` };
  }
  const frame = supportFrame(snapshot);
  if (!frame) return { layouts: [], bindingConstraint: "learner: physician_bedside" };
  const legal: LayoutCandidate[][] = [];
  let learnerStance: LearnerStance | undefined;
  for (const layout of beam) {
    const stance = learnerStanceForLayout(snapshot, layout, frame);
    if (!stance) continue;
    learnerStance ??= stance;
    legal.push(layout);
  }
  if (legal.length === 0 || !learnerStance) return { layouts: [], bindingConstraint: "learner: physician_bedside" };
  return { layouts: legal, learnerStance };
}

export function supportSurfaceForPatient(snapshot: CachedSceneSnapshot): "stretcher" | "bed" | "exam_table" | null {
  const support = [...snapshot.patientSupports].sort((a, b) => horizontalArea(b.box) - horizontalArea(a.box))[0];
  return support ? supportKind(support.name) : null;
}
