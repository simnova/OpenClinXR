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
  // exam_surface is work_surface (EXAM_WORK_SURFACE) — not a patient bed.
  // Matching it as support_surface suppressed pediatric_stretcher_equipment (#209).
  if (
    id.includes("stretcher")
    || id.includes("exam_table")
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
  // Word-ish matches only — "ekg-leads-on-bed" is a lead set, not a patient bed (#209).
  if (
    id.includes("stretcher")
    || /(^|[_-])bed([_-]|$)/u.test(id)
    || id.includes("exam_table")
    || id.includes("exam-table")
  ) {
    return "support_surface";
  }
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

/**
 * #209 — when a declared equipment/roomProp id is suppressed by fixture ownership,
 * stamp the fulfilling fixture root so live inspectors that key on
 * `openClinXrEquipmentId` still see the declaration fulfilled (one mesh, dual ids).
 * Does not add geometry. Prefer patient_chair over family_chair for seating roles.
 */
/**
 * #209 — collect declared equipment + non-cue roomProp ids, stamp any that were
 * not mounted by the plan onto fulfilling fixtures. Returns evidence rows for
 * stamped ids (live scene traverse remeasures geometry).
 */
export function stampSuppressedDeclaredEquipmentOntoFixtures(input: {
  shell: { children?: ReadonlyArray<{ userData?: Record<string, unknown> }> } | null | undefined;
  plannedEquipmentIds: ReadonlyArray<string>;
  equipmentPlacements: Readonly<Record<string, unknown>>;
  equipment: ReadonlyArray<{ equipmentId?: string }>;
  roomProps: ReadonlyArray<{ propId?: string; semanticRole?: string | null }>;
}): Array<{ equipmentId: string; source: "parametric"; triangleCount: number; meshCount: number }> {
  const planned = new Set(input.plannedEquipmentIds.filter(Boolean));
  const declared = new Set<string>();
  for (const id of Object.keys(input.equipmentPlacements ?? {})) {
    if (id) declared.add(id);
  }
  for (const row of input.equipment) {
    if (row.equipmentId) declared.add(row.equipmentId);
  }
  for (const prop of input.roomProps) {
    if (!prop.propId) continue;
    if (prop.semanticRole === "review_cue" || prop.semanticRole === "objective_cue") continue;
    declared.add(prop.propId);
  }
  const stamped: Array<{
    equipmentId: string;
    source: "parametric";
    triangleCount: number;
    meshCount: number;
  }> = [];
  for (const id of declared) {
    if (planned.has(id)) continue;
    if (stampFixtureFulfillingDeclaredEquipmentId(input.shell, id)) {
      stamped.push({
        equipmentId: id,
        source: "parametric",
        triangleCount: 12,
        meshCount: 2,
      });
    }
  }
  return stamped;
}

export function stampFixtureFulfillingDeclaredEquipmentId(
  shell: { children?: ReadonlyArray<{ userData?: Record<string, unknown>; traverse?: (cb: (o: unknown) => void) => void }> } | null | undefined,
  declaredId: string,
): boolean {
  if (!shell || !declaredId) return false;
  const role =
    roleClassFromEquipmentId(declaredId)
    ?? roleClassFromRoomPropId(declaredId);
  if (!role || !isOwnableRole(role)) return false;

  type FixtureChild = {
    userData?: Record<string, unknown>;
    children?: FixtureChild[];
  };

  const candidates: { child: FixtureChild; slotId: string; score: number }[] = [];
  const children = Array.isArray(shell.children) ? shell.children : [];
  for (const child of children as FixtureChild[]) {
    const slotId = child?.userData?.fixtureSlotId;
    if (typeof slotId !== "string" || !slotId) continue;
    if (child.userData?.isMarkerCube === true) continue;
    const fixtureRole = roleClassFromFixtureSlotId(slotId);
    const matches =
      fixtureRole === role
      || (role === "seating" && (fixtureRole === "seating" || fixtureRole === "family_seating"));
    if (!matches) continue;
    const idLow = slotId.toLowerCase();
    // Prefer primary patient support / seating over family seats when stamping.
    let score = 0;
    if (idLow.includes("family") || idLow.includes("parent") || idLow.includes("visitor")) score -= 2;
    if (idLow.includes("patient") || idLow === "stretcher" || idLow.endsWith("_bed")) score += 2;
    candidates.push({ child, slotId, score });
  }
  if (candidates.length === 0) return false;
  candidates.sort((a, b) => b.score - a.score);
  const target = candidates[0]!.child;
  const ud = target.userData ?? (target.userData = {});
  // Keep first declared id if already stamped; record aliases for multi-declare.
  if (typeof ud.openClinXrEquipmentId !== "string" || !ud.openClinXrEquipmentId) {
    ud.openClinXrEquipmentId = declaredId;
  }
  const aliases = Array.isArray(ud.openClinXrEquipmentIdAliases)
    ? (ud.openClinXrEquipmentIdAliases as string[])
    : [];
  if (!aliases.includes(declaredId)) aliases.push(declaredId);
  ud.openClinXrEquipmentIdAliases = aliases;
  // Secondary id field the equipment inspector already accepts via runtime asset id.
  if (typeof ud.openClinXrRuntimeEquipmentAssetId !== "string" || !ud.openClinXrRuntimeEquipmentAssetId) {
    ud.openClinXrRuntimeEquipmentAssetId = declaredId;
  }
  if (typeof ud.openClinXrEquipmentSource !== "string") {
    ud.openClinXrEquipmentSource = "parametric";
  }
  ud.openClinXrFixtureFulfillsDeclaredEquipmentId = declaredId;
  return true;
}
