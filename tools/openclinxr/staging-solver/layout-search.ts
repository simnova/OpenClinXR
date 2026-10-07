import { type AxisAlignedBox, actorSamplePoints, type Vec3 } from "../evidence/station-capture/gate-geometry.js";
import { templatesForRole } from "./clinical-slot-templates.js";
import type { CachedSceneSnapshot, SlotAssignment, SolverPlacement } from "./staging-types.js";

type LayoutCandidate = SlotAssignment & { box: AxisAlignedBox; standing: boolean };
export type LayoutSearchResult = { layouts: LayoutCandidate[][]; bindingConstraint?: string };

const OFFSETS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] as const;
const HEADING_DELTAS = [-Math.PI / 6, -Math.PI / 12, 0, Math.PI / 12, Math.PI / 6] as const;

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

function insideInterior(box: AxisAlignedBox, interior: AxisAlignedBox): boolean {
  return box.min[0] >= interior.min[0] + 0.08 && box.max[0] <= interior.max[0] - 0.08
    && box.min[2] >= interior.min[2] + 0.08 && box.max[2] <= interior.max[2] - 0.08;
}

// Room-shell meshes (walls, floor slabs, ceilings, exterior shells, anteroom
// shell parts) span the room, so their AABBs contain every in-interior actor
// candidate and would veto all placements. Containment inside the interior box
// already bounds actors, so placement collision skips them. Visibility and
// near-occlusion math is untouched: walls genuinely occlude and the gate probe
// path already skips boxes containing the camera.
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
  const height = standing ? 1.7 : 1.3;
  return { min: [world[0] - radius, world[1] - height / 2, world[2] - radius], max: [world[0] + radius, world[1] + height / 2, world[2] + radius] };
}

function supportKind(name: string): "stretcher" | "bed" | "exam_table" {
  if (/exam[_ -]?table|exam_surface/i.test(name)) return "exam_table";
  if (/stretcher/i.test(name)) return "stretcher";
  return "bed";
}

function assignmentCandidates(snapshot: CachedSceneSnapshot, actor: CachedSceneSnapshot["actors"][number]): LayoutCandidate[] {
  const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
  if (!patient) return [];
  const supports = [...snapshot.patientSupports].sort((a, b) => horizontalArea(b.box) - horizontalArea(a.box) || a.name.localeCompare(b.name));
  const support = supports[0];
  if (!support) return [];
  const supportCentre = centre(support.box);
  const patientHead = actorSamplePoints(patient.box, patient.recumbent)[0]?.point ?? patient.chest;
  const width = support.box.max[0] - support.box.min[0], depth = support.box.max[2] - support.box.min[2];
  let long: [number, number] = width >= depth ? [1, 0] : [0, 1];
  if ((patientHead[0] - supportCentre[0]) * long[0] + (patientHead[2] - supportCentre[2]) * long[1] < 0) long = [-long[0], -long[1]];
  const side: [number, number] = [-long[1], long[0]];
  const halfLong = (width >= depth ? width : depth) / 2;
  const head: [number, number] = [supportCentre[0] + long[0] * halfLong, supportCentre[2] + long[1] * halfLong];
  const foot: [number, number] = [supportCentre[0] - long[0] * halfLong, supportCentre[2] - long[1] * halfLong];
  const seated = actor.currentPlacement.supportSurface === "chair";
  const templateSets = seated
    ? [templatesForRole(actor.role, true), templatesForRole(actor.role, false)]
    : [templatesForRole(actor.role, false)];
  const chairs = [...snapshot.companionSeats].sort((a, b) => {
    const ac = centre(a.box), bc = centre(b.box);
    return Math.hypot(ac[0] - patientHead[0], ac[2] - patientHead[2])
      - Math.hypot(bc[0] - patientHead[0], bc[2] - patientHead[2]) || a.name.localeCompare(b.name);
  });
  let output: LayoutCandidate[] = [];
  const actorRadius = capsuleRadiusMeters(actor.bodyDimensions);
  for (const templates of templateSets) {
    const attempt: LayoutCandidate[] = [];
  for (const template of templates) {
    const chair = template.anchor === "chair" ? chairs[0] : undefined;
    if (template.anchor === "chair" && !chair) continue;
    const chairCentre = chair ? centre(chair.box) : null;
    const base = template.anchor === "head" ? head : template.anchor === "foot" ? foot
      : template.anchor === "chair" && chairCentre ? [chairCentre[0], chairCentre[2]] as [number, number]
        : [head[0] + long[0] * template.alongMeters + side[0] * template.side * template.acrossMeters,
          head[1] + long[1] * template.alongMeters + side[1] * template.side * template.acrossMeters] as [number, number];
    for (const alongOffset of OFFSETS) for (const acrossOffset of OFFSETS) for (const headingDelta of HEADING_DELTAS) {
      const x = base[0] + long[0] * alongOffset + side[0] * acrossOffset;
      const z = base[1] + long[1] * alongOffset + side[1] * acrossOffset;
      const box = translateBox(actor.box, x, z);
      const capsule = capsuleForPlacement([x, centre(actor.box)[1], z], actorRadius, actor.standing);
      if (!insideInterior(box, snapshot.interior)) continue;
      const collides = snapshot.fixtures.some((fixture) => {
        if (chair && fixture.name === chair.name) return false;
        if (isPlacementShellFixture(fixture.name, fixture.box, snapshot.interior)) return false;
        if (fixture.name === support.name) return actor.role !== "patient" ? intersects(capsule, fixture.box, 0.03) : false;
        return intersects(capsule, fixture.box, 0.03);
      });
      if (collides) continue;
      const targetHeading = Math.atan2(patientHead[0] - x, patientHead[2] - z);
      const heading = targetHeading + headingDelta;
      const currentCentre = centre(actor.box);
      // Standing authored placements are root world positions.  Mesh AABBs are
      // intentionally offset by the rig, so derive that stable body bias from
      // the one captured scene rather than treating the visual centre as root.
      const rootBiasX = currentCentre[0] - (actor.root?.[0] ?? currentCentre[0]);
      const rootBiasZ = currentCentre[2] - (actor.root?.[2] ?? currentCentre[2]);
      const placement: SolverPlacement = {
        supportSurface: actor.currentPlacement.supportSurface,
        plantOffsetMeters: {
          x: actor.standing ? x - rootBiasX : actor.currentPlacement.plantOffsetMeters.x + x - currentCentre[0],
          y: actor.currentPlacement.plantOffsetMeters.y,
          z: actor.standing ? z - rootBiasZ : actor.currentPlacement.plantOffsetMeters.z + z - currentCentre[2],
        },
        headingRadians: heading,
      };
      attempt.push({ actorId: actor.id, slotId: template.slotId, world: [x, centre(actor.box)[1], z],
        headingRadians: heading, placement, box: capsule, standing: actor.standing,
        cost: Math.hypot(alongOffset, acrossOffset) + Math.abs(headingDelta) / Math.PI });
    }
  }
    if (attempt.length > 0 || templateSets.indexOf(templates) === templateSets.length - 1) output = attempt;
    if (output.length > 0) break;
  }
  return output.sort((a, b) => a.cost - b.cost || a.slotId.localeCompare(b.slotId)
    || a.world[0] - b.world[0] || a.world[2] - b.world[2] || a.headingRadians - b.headingRadians);
}

function compatible(candidate: LayoutCandidate, assigned: readonly LayoutCandidate[]): boolean {
  return assigned.every((other) => {
    if (other.slotId === "patient_on_authored_support" || candidate.slotId === "patient_on_authored_support") return true;
    if (candidate.standing && other.standing
      && Math.hypot(candidate.world[0] - other.world[0], candidate.world[2] - other.world[2]) < 0.45) return false;
    return !intersects(candidate.box, other.box, 0.02);
  });
}

export function searchClinicalLayouts(snapshot: CachedSceneSnapshot, beamWidth = 64): LayoutSearchResult {
  const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
  if (!patient) return { layouts: [], bindingConstraint: "no patient actor" };
  if (snapshot.patientSupports.length === 0) return { layouts: [], bindingConstraint: "no patient support anchor detected" };
  const patientCentre = centre(patient.box);
  const patientSupport = [...snapshot.patientSupports].sort((a, b) => horizontalArea(b.box) - horizontalArea(a.box))[0];
  if (!patientSupport) return { layouts: [], bindingConstraint: "no patient support anchor detected" };
  const supportCentre = centre(patientSupport.box);
  const patientPlacement: SolverPlacement = patient.currentPlacement.supportSurface === "none"
    ? { supportSurface: supportKind(patientSupport.name), plantOffsetMeters: {
      x: patientCentre[0] - supportCentre[0], y: patient.currentPlacement.plantOffsetMeters.y,
      z: patientCentre[2] - supportCentre[2],
    }, headingRadians: patient.heading }
    : patient.currentPlacement;
  const fixedPatient: LayoutCandidate = {
    actorId: patient.id, slotId: "patient_on_authored_support", world: patientCentre,
    headingRadians: patient.heading, placement: patientPlacement, cost: 0,
    box: patient.box, standing: patient.standing,
  };
  let beam: LayoutCandidate[][] = [[fixedPatient]];
  const movable = snapshot.actors.filter((actor) => actor.id !== patient.id).sort((a, b) => a.id.localeCompare(b.id));
  for (const actor of movable) {
    const candidates = assignmentCandidates(snapshot, actor);
    if (candidates.length === 0) return { layouts: [], bindingConstraint: `${actor.id}: no candidate inside template/interior without fixture collision` };
    const next: LayoutCandidate[][] = [];
    for (const layout of beam) for (const candidate of candidates) {
      if (compatible(candidate, layout)) next.push([...layout, candidate]);
    }
    next.sort((a, b) => a.reduce((sum, row) => sum + row.cost, 0) - b.reduce((sum, row) => sum + row.cost, 0)
      || JSON.stringify(a).localeCompare(JSON.stringify(b)));
    beam = next.slice(0, beamWidth);
    if (beam.length === 0) return { layouts: [], bindingConstraint: `${actor.id}: 0.45 m footprint/fixture constraint` };
  }
  return { layouts: beam };
}

export function supportSurfaceForPatient(snapshot: CachedSceneSnapshot): "stretcher" | "bed" | "exam_table" | null {
  const support = [...snapshot.patientSupports].sort((a, b) => horizontalArea(b.box) - horizontalArea(a.box))[0];
  return support ? supportKind(support.name) : null;
}
