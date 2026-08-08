/**
 * Fixture ↔ equipment ↔ roomProp role ownership (#186).
 *
 * One role class renders one object across the three channels. Enforced in the
 * equipment mount planner and roomProp filter (code, not prose).
 *
 * claimScope: dual-mesh prevention for support/seating/architecture roles.
 * notEvidenceFor: clinical staging validity, Quest readiness.
 */

export type FixtureRoleClass =
  | "support_surface"
  | "seating"
  /** Second intentional seat (family/parent) — not a dual of `seating`; equipment still suppressed via seating. */
  | "family_seating"
  | "door"
  | "wall_board"
  | "work_surface"
  | "clinical_device"
  | "learner_start"
  | "layout_other";

/** Roles where fixture ownership suppresses equipment / roomProp geometry. */
const OWNABLE_ROLES = new Set<FixtureRoleClass>([
  "support_surface",
  "seating",
  "door",
  "wall_board",
  "work_surface",
]);

export function isOwnableRole(role: FixtureRoleClass): boolean {
  return OWNABLE_ROLES.has(role);
}

export function roleClassFromFixtureSlotId(slotId: string): FixtureRoleClass {
  const id = slotId.toLowerCase();
  if (/learner[_-]?start/u.test(id)) return "learner_start";
  if (
    id.includes("stretcher")
    || id.includes("exam_table")
    || id.includes("exam_surface")
    || (id.includes("bed") && !id.includes("overbed"))
  ) {
    return "support_surface";
  }
  // family/parent second seat is a distinct role so two intentional chairs do not
  // trip the dual-mesh counterweight; equipment chairs still map to `seating`.
  if (id.includes("family_chair") || id.includes("parent_chair") || id.includes("visitor_chair")) {
    return "family_seating";
  }
  if (id.includes("chair") || id.includes("seating")) return "seating";
  if (id.includes("door")) return "door";
  if (id.includes("board") || id.includes("whiteboard")) return "wall_board";
  // Architecture work surface only — laptop_desk / generic desk props stay layout_other
  // so they do not dual-claim with an explicit work_surface / overbed_surface slot.
  if (
    id.includes("work_surface")
    || id.includes("counter")
    || id.includes("overbed")
    || id.includes("exam_surface")
    || (id.includes("surface") && !id.includes("laptop"))
  ) {
    return "work_surface";
  }
  if (id.includes("monitor") || id.includes("cart") || id.includes("ecg") || id.includes("shelf")) {
    return "clinical_device";
  }
  return "layout_other";
}

export function roleClassFromEquipmentId(equipmentId: string): FixtureRoleClass | null {
  const id = equipmentId.toLowerCase();
  if (
    id.includes("stretcher")
    || id.includes("exam_table")
    || id.includes("post_op_bed")
    || (id.includes("bed") && !id.includes("bedside"))
  ) {
    return "support_surface";
  }
  if (id.includes("chair") || id.includes("seating")) return "seating";
  if (id.includes("door")) return "door";
  if (id.includes("board") || id.includes("whiteboard")) return "wall_board";
  if (id.includes("desk") || id.includes("counter") || id.includes("surface") || id.includes("overbed")) {
    return "work_surface";
  }
  if (
    id.includes("monitor")
    || id.includes("iv")
    || id.includes("pump")
    || id.includes("ecg")
    || id.includes("cart")
    || id.includes("clock")
    || id.includes("cuff")
    || id.includes("nebulizer")
    || id.includes("oxygen")
    || id.includes("pulse")
    || id.includes("inhaler")
    || id.includes("dressing")
    || id.includes("tissue")
    || id.includes("abdominal")
  ) {
    return "clinical_device";
  }
  return "layout_other";
}

export function roleClassFromRoomPropId(propId: string): FixtureRoleClass | null {
  const id = propId.toLowerCase();
  if (id.includes("chair") || id.includes("seating") || id.includes("visitor") || id.includes("caregiver")) {
    return "seating";
  }
  if (id.includes("door")) return "door";
  if (id.includes("whiteboard") || id.includes("board") || id.includes("handoff")) return "wall_board";
  if (id.includes("desk") || id.includes("counter") || id.includes("table") || id.includes("surface")) {
    return "work_surface";
  }
  if (id.includes("stretcher") || id.includes("bed") || id.includes("exam")) return "support_surface";
  return "layout_other";
}

export function ownedRolesFromFixtureSlots(
  slots: ReadonlyArray<{ slotId: string } | string>,
): Set<FixtureRoleClass> {
  const owned = new Set<FixtureRoleClass>();
  for (const slot of slots) {
    const slotId = typeof slot === "string" ? slot : slot.slotId;
    const role = roleClassFromFixtureSlotId(slotId);
    if (isOwnableRole(role)) owned.add(role);
    // family/parent chair still claims seating ownership against equipment dual-mount.
    if (role === "family_seating") owned.add("seating");
  }
  return owned;
}

/** True when equipment must not render because a fixture already owns its role. */
export function equipmentSuppressedByFixtureOwnership(
  equipmentId: string,
  ownedRoles: ReadonlySet<FixtureRoleClass> | ReadonlyArray<FixtureRoleClass>,
): boolean {
  const owned = ownedRoles instanceof Set ? ownedRoles : new Set(ownedRoles);
  const role = roleClassFromEquipmentId(equipmentId);
  if (!role || !isOwnableRole(role)) return false;
  return owned.has(role);
}

/** True when a roomProp body mesh must not render (metadata-only or fixture-owned). */
export function roomPropSuppressedByFixtureOwnership(
  propId: string,
  ownedRoles: ReadonlySet<string> | ReadonlyArray<string>,
): boolean {
  const owned = ownedRoles instanceof Set ? ownedRoles : new Set(ownedRoles);
  const role = roleClassFromRoomPropId(propId);
  if (!role || !isOwnableRole(role)) return false;
  return owned.has(role);
}
