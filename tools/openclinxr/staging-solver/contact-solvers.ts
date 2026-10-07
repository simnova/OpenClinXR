import type { CachedSceneSnapshot, SlotAssignment, SolverPlacement } from "./staging-types.js";
import type { AxisAlignedBox } from "../evidence/station-capture/gate-geometry.js";
import { templatesForRole } from "./clinical-slot-templates.js";

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

const OFFSETS = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] as const;
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
    cost: 0,
    box: patient.box,
    standing: patient.standing,
  };
}

export function sitContact(snapshot: CachedSceneSnapshot, actor: ActorT, frame: ContactFrame): LayoutCandidate[] {
  if (actor.currentPlacement.supportSurface !== "chair") return [];
  const centreY = centreOf(actor.box)[1];
  const radius = radiusFor(actor);
  const seats = snapshot.companionSeats
    .filter((s) => {
      const c = centreOf(s.box);
      const dx = c[0] - frame.nurseAnchor[0];
      const dz = c[2] - frame.nurseAnchor[1];
      return Math.hypot(dx, dz) >= 1.2;
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
  const out: LayoutCandidate[] = [];
  for (const slackX of OFFSETS) {
    for (const slackZ of OFFSETS) {
      const worldX = seatCentre[0] + slackX;
      const worldZ = seatCentre[2] + slackZ;
      for (const headingDelta of HEADING_DELTAS) {
        const world: [number, number, number] = [worldX, centreY, worldZ];
        const box = capsuleAt(world, false, radius);
        if (!withinInterior(box, snapshot.interior, 0.08)) continue;
        let blocked = false;
        for (const fixture of snapshot.fixtures) {
          if (fixture.name === chosen.name) continue;
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
          cost: Math.hypot(slackX, slackZ) + Math.abs(headingDelta) / Math.PI,
          box,
          standing: false,
        });
      }
    }
  }
  return out;
}

export function standContact(snapshot: CachedSceneSnapshot, actor: ActorT, frame: ContactFrame): LayoutCandidate[] {
  const templates = templatesForRole(actor.role, false);
  const actorCentre = centreOf(actor.box);
  const rootBiasX = actorCentre[0] - (actor.root?.[0] ?? actorCentre[0]);
  const rootBiasZ = actorCentre[2] - (actor.root?.[2] ?? actorCentre[2]);
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
    for (const alongOffset of OFFSETS) {
      for (const acrossOffset of OFFSETS) {
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
          const placement: SolverPlacement = {
            supportSurface: actor.currentPlacement.supportSurface,
            plantOffsetMeters: { x: x - rootBiasX, y: actor.currentPlacement.plantOffsetMeters.y, z: z - rootBiasZ },
          };
          out.push({
            slotId: template.slotId,
            actorId: actor.id,
            world,
            headingRadians,
            placement,
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
