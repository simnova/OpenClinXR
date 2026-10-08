import type { AxisAlignedBox } from "../evidence/station-capture/gate-geometry.js";
import { templatesForRole } from "./clinical-slot-templates.js";
import type { CachedSceneSnapshot, SlotAssignment, SolverPlacement } from "./staging-types.js";

export type LayoutCandidate = SlotAssignment & { box: AxisAlignedBox; standing: boolean };

export type ContactFrame = {
  supportName: string;
  long: readonly [number, number];
  side: readonly [number, number];
  head: readonly [number, number];
  foot: readonly [number, number];
  patientHead: readonly [number, number, number];
  nurseAnchor: readonly [number, number];
};

type ActorT = CachedSceneSnapshot["actors"][number];

const SEATED_OFFSETS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] as const;
const STANDING_OFFSETS = [-0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] as const;
const HEADING_DELTAS = [-Math.PI / 6, -Math.PI / 12, 0, Math.PI / 12, Math.PI / 6] as const;

function centreOf(box: AxisAlignedBox): [number, number, number] {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

function intersects(a: AxisAlignedBox, b: AxisAlignedBox, pad = 0): boolean {
  return (
    a.min[0] < b.max[0] + pad && a.max[0] > b.min[0] - pad &&
    a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
    a.min[2] < b.max[2] + pad && a.max[2] > b.min[2] - pad
  );
}

function withinInterior(box: AxisAlignedBox, interior: AxisAlignedBox, inset: number): boolean {
  return (
    box.min[0] >= interior.min[0] + inset &&
    box.max[0] <= interior.max[0] - inset &&
    box.min[2] >= interior.min[2] + inset &&
    box.max[2] <= interior.max[2] - inset
  );
}

function isRoomShellName(name: string): boolean {
  return /wall|floor|ceiling|exterior|shell/i.test(name);
}

function isSkippedFixtureName(name: string): boolean {
  return /portal|review-panel|review_panel|capture-cue|capture_cue|patient-note-capture|patient_note_capture/i.test(name);
}

function coversInteriorFootprint(box: AxisAlignedBox, interior: AxisAlignedBox): boolean {
  const interiorArea = (interior.max[0] - interior.min[0]) * (interior.max[2] - interior.min[2]);
  if (!(interiorArea > 0)) return false;
  const footprint = (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]);
  return footprint / interiorArea >= 0.5;
}

function isShellFixture(name: string, box: AxisAlignedBox, interior: AxisAlignedBox): boolean {
  return isRoomShellName(name) || isSkippedFixtureName(name) || coversInteriorFootprint(box, interior);
}

function slotIdOfFixtureName(name: string): string | undefined {
  const parts = name.split(".");
  const at = parts.indexOf("fixture-slot");
  if (at < 0 || at + 1 >= parts.length) return undefined;
  return parts[at + 1];
}

function radiusFor(actor: ActorT): number {
  const width = actor.bodyDimensions?.[0];
  if (typeof width === "number" && Number.isFinite(width) && width >= 0.15 && width <= 0.35) return width / 2;
  return 0.22;
}

function capsuleAt(world: readonly [number, number, number], standing: boolean, radius: number): AxisAlignedBox {
  const height = standing ? 1.7 : 1.3;
  return {
    min: [world[0] - radius, world[1] - height / 2, world[2] - radius],
    max: [world[0] + radius, world[1] + height / 2, world[2] + radius],
  };
}

function rotatedCentreBias(actor: ActorT, headingRadians: number): readonly [number, number] {
  const actorCentre = centreOf(actor.box);
  const rootX = actor.root?.[0] ?? actorCentre[0];
  const rootZ = actor.root?.[2] ?? actorCentre[2];
  const dx = actorCentre[0] - rootX;
  const dz = actorCentre[2] - rootZ;
  const delta = headingRadians - actor.heading;
  const cosine = Math.cos(delta);
  const sine = Math.sin(delta);
  return [cosine * dx + sine * dz, -sine * dx + cosine * dz];
}

/** Keeps a runtime-valid authored placement available to the optimiser. */
export function authoredContact(snapshot: CachedSceneSnapshot, actor: ActorT): LayoutCandidate | null {
  const world = centreOf(actor.box);
  if (!withinInterior(actor.box, snapshot.interior, 0.02)) return null;
  // The captured actor already exists among the room fixtures, whose AABBs
  // include intended contacts and coarse furniture envelopes. Revalidating it
  // against every fixture rejects working runtime layouts. A doorway remains a
  // hard exclusion because it is an access constraint, not a contact surface.
  const blocked = snapshot.fixtures.some((fixture) =>
    fixture.kind === "door" && intersects(actor.box, fixture.box, 0.01));
  if (blocked) return null;
  return {
    slotId: `authored_${actor.role}`,
    actorId: actor.id,
    world,
    headingRadians: actor.heading,
    placement: actor.currentPlacement,
    persistPlacement: false,
    // A valid authored row is a no-regression fallback, not the optimiser's
    // first answer for a failing room. Generated contact candidates must keep
    // their established precedence when the observed baseline is not green.
    cost: 2,
    box: actor.box,
    standing: actor.standing,
  };
}

export function layContact(snapshot: CachedSceneSnapshot): LayoutCandidate {
  const patient = snapshot.actors.find((a) => a.role === "patient") ?? snapshot.actors[0];
  if (!patient) throw new Error("no patient actor");
  const c = centreOf(patient.box);
  const placement: SolverPlacement = patient.currentPlacement;
  return {
    slotId: "patient_on_authored_support",
    actorId: patient.id,
    world: [c[0], c[1], c[2]],
    headingRadians: patient.heading,
    placement,
    persistPlacement: false,
    cost: 0,
    box: patient.box,
    standing: patient.standing,
  };
}

export function sitContact(snapshot: CachedSceneSnapshot, actor: ActorT, frame: ContactFrame): LayoutCandidate[] {
  if (actor.currentPlacement.supportSurface !== "chair") return [];
  const centreY = centreOf(actor.box)[1];
  const radius = radiusFor(actor);
  const nearFiltered = snapshot.companionSeats
    .filter((s) => {
      const c = centreOf(s.box);
      const dx = c[0] - frame.nurseAnchor[0];
      const dz = c[2] - frame.nurseAnchor[1];
      return Math.hypot(dx, dz) >= 1.2;
    });
  const slotHasPan = new Set<string>();
  for (const s of nearFiltered) {
    if (s.name.endsWith(".seat")) {
      const slot = slotIdOfFixtureName(s.name);
      if (slot !== undefined) slotHasPan.add(slot);
    }
  }
  const seats = nearFiltered
    .filter((s) => {
      const slot = slotIdOfFixtureName(s.name);
      if (slot === undefined) return true;
      if (!slotHasPan.has(slot)) return true;
      return s.name.endsWith(".seat");
    })
    .sort((a, b) => {
      const ca = centreOf(a.box);
      const cb = centreOf(b.box);
      const da = Math.hypot(ca[0] - frame.patientHead[0], ca[2] - frame.patientHead[2]);
      const db = Math.hypot(cb[0] - frame.patientHead[0], cb[2] - frame.patientHead[2]);
      if (da !== db) return da - db;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  const chosen = seats[0];
  if (!chosen) return [];
  const seatCentre = centreOf(chosen.box);
  const chosenSlot = slotIdOfFixtureName(chosen.name);
  const out: LayoutCandidate[] = [];
  for (const slackX of SEATED_OFFSETS) {
    for (const slackZ of SEATED_OFFSETS) {
      const worldX = seatCentre[0] + slackX;
      const worldZ = seatCentre[2] + slackZ;
      for (const headingDelta of HEADING_DELTAS) {
        const world: [number, number, number] = [worldX, centreY, worldZ];
        const box = capsuleAt(world, false, radius);
        if (!withinInterior(box, snapshot.interior, 0.08)) continue;
        let blocked = false;
        for (const fixture of snapshot.fixtures) {
          if (fixture.name === chosen.name) continue;
          const fixtureSlot = slotIdOfFixtureName(fixture.name);
          if (fixtureSlot !== undefined && fixtureSlot === chosenSlot) continue;
          if (isShellFixture(fixture.name, fixture.box, snapshot.interior)) continue;
          if (fixture.name === frame.supportName && actor.role === "patient") continue;
          if (intersects(box, fixture.box, 0.03)) { blocked = true; break; }
        }
        if (blocked) continue;
        const headingRadians = Math.atan2(frame.patientHead[0] - worldX, frame.patientHead[2] - worldZ) + headingDelta;
        const placement: SolverPlacement = {
          supportSurface: actor.currentPlacement.supportSurface,
          plantOffsetMeters: { x: slackX, y: 0, z: slackZ },
        };
        out.push({
          slotId: "companion_chair",
          actorId: actor.id,
          world,
          headingRadians,
          placement,
          persistPlacement: true,
          cost: Math.hypot(slackX, slackZ) + Math.abs(headingDelta) / Math.PI,
          box,
          standing: false,
        });
      }
    }
  }
  return out;
}

export function standContact(
  snapshot: CachedSceneSnapshot,
  actor: ActorT,
  frame: ContactFrame,
  supportSurface: SolverPlacement["supportSurface"] = actor.currentPlacement.supportSurface,
): LayoutCandidate[] {
  const templates = templatesForRole(actor.role, false);
  const actorCentre = centreOf(actor.box);
  const radius = radiusFor(actor);
  const out: LayoutCandidate[] = [];
  for (const template of templates) {
    const base: readonly [number, number] = template.anchor === "head"
      ? frame.head
      : template.anchor === "foot"
        ? frame.foot
        : [
            frame.head[0] + frame.long[0] * template.alongMeters + frame.side[0] * template.side * template.acrossMeters,
            frame.head[1] + frame.long[1] * template.alongMeters + frame.side[1] * template.side * template.acrossMeters,
          ];
    for (const alongOffset of STANDING_OFFSETS) {
      for (const acrossOffset of STANDING_OFFSETS) {
        const x = base[0] + frame.long[0] * alongOffset + frame.side[0] * acrossOffset;
        const z = base[1] + frame.long[1] * alongOffset + frame.side[1] * acrossOffset;
        for (const headingDelta of HEADING_DELTAS) {
          const world: [number, number, number] = [x, actorCentre[1], z];
          const box = capsuleAt(world, true, radius);
          if (!withinInterior(box, snapshot.interior, 0.08)) continue;
          let blocked = false;
          for (const fixture of snapshot.fixtures) {
            if (isShellFixture(fixture.name, fixture.box, snapshot.interior)) continue;
            if (fixture.name === frame.supportName && actor.role === "patient") continue;
            if (intersects(box, fixture.box, 0.03)) { blocked = true; break; }
          }
          if (blocked) continue;
          const headingRadians = Math.atan2(frame.patientHead[0] - x, frame.patientHead[2] - z) + headingDelta;
          const [rootBiasX, rootBiasZ] = rotatedCentreBias(actor, headingRadians);
          const placement: SolverPlacement = {
          supportSurface,
            plantOffsetMeters: { x: x - rootBiasX, y: actor.currentPlacement.plantOffsetMeters.y, z: z - rootBiasZ },
          };
          out.push({
            slotId: template.slotId,
            actorId: actor.id,
            world,
            headingRadians,
            placement,
            persistPlacement: true,
            cost: Math.hypot(alongOffset, acrossOffset) + Math.abs(headingDelta) / Math.PI,
            box,
            standing: actor.standing,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.cost - b.cost || a.slotId.localeCompare(b.slotId) || a.world[0] - b.world[0] || a.world[2] - b.world[2] || a.headingRadians - b.headingRadians);
}
