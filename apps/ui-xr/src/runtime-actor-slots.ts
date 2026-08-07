/**
 * #122 — unique humanoid slot assignment for the learner runtime.
 *
 * Decisions (with rejected alternatives):
 * 1. Fourth slot (`additional_cast`) is ENABLED. Triangle budget permits four humanoids
 *    (~112k of 180k station ceiling). Rejected: keep three and residual the fourth —
 *    ward's senior resident is part of the encounter cast a learner should see.
 * 2. Priority: patient → clinical staff → family → remaining bank order.
 *    Rejected: pure bank order (would put family before nurse when bank lists family second).
 * 3. Unfilled slots stay in the scene graph but are HIDDEN with empty `openClinXrActorId`.
 *    Rejected: remove the mesh root (keeps three named ED objects for dialogue/trace maps).
 * 4. ED-id-first lookups (`patient_robert_hayes_v1` etc.) are DELETED from assignment.
 *    Rejected: leave as fast path — same hardcoded-ED pattern removed by #106/#107/#114.
 *
 * Role allow-lists are classes (clinical vs family), not a one-off physician patch.
 * Never reuses an actorId across slots; never falls through to an already-used person.
 */

export const RUNTIME_SLOT_KINDS = [
  "primary_patient",
  "clinical_team",
  "family_or_observer",
  "additional_cast",
] as const;

export type RuntimeSlotKind = (typeof RUNTIME_SLOT_KINDS)[number];

/** Budget permits four; current bank max humanoids is four (ward). */
export const MAX_VISIBLE_HUMANOID_SLOTS = 4;

/** Clinical staff class — extendable; not a single-role patch. */
export const CLINICAL_ROLE_CLASS = [
  "nurse",
  "respiratory_therapist",
  "nurse_observer",
  "medical_assistant",
  "physician",
  "consultant",
] as const;

/** Family / collateral class. Consultant is clinical-only (postop resident). */
export const FAMILY_ROLE_CLASS = [
  "spouse",
  "parent",
  "family",
  "family_member",
  "interpreter",
] as const;

export type RuntimeActorRef = {
  actorId: string;
  role: string;
  embodiment?: string;
};

export type RuntimeSlotAssignment = {
  /** Parallel to RUNTIME_SLOT_KINDS — empty string means unfilled (must hide). */
  stagedActorIds: string[];
  /** Declared humanoids not placed in any slot, with a machine-readable reason. */
  notStagedActorIds: { actorId: string; reason: string }[];
  /** Convenience accessors (empty string when unfilled). */
  patientActorId: string;
  clinicalTeamActorId: string;
  familyActorId: string;
  additionalActorId: string;
};

function isHumanoidActor(actor: RuntimeActorRef): boolean {
  const role = actor.role.toLowerCase();
  if (role === "system") return false;
  if (actor.embodiment === "virtual_device" || actor.embodiment === "voice_only") return false;
  if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
  return true;
}

function pickFirst(
  actors: RuntimeActorRef[],
  used: Set<string>,
  roles: readonly string[],
): RuntimeActorRef | undefined {
  const roleSet = new Set(roles.map((r) => r.toLowerCase()));
  return actors.find((a) => !used.has(a.actorId) && roleSet.has(a.role.toLowerCase()));
}

/**
 * Assign unique people to fixed slot kinds. Never clones; unfilled slots are "".
 */
export function assignRuntimeActorSlots(
  actors: readonly RuntimeActorRef[],
  options?: { maxVisibleSlots?: number },
): RuntimeSlotAssignment {
  const maxSlots = options?.maxVisibleSlots ?? MAX_VISIBLE_HUMANOID_SLOTS;
  const humanoids = actors.filter(isHumanoidActor);
  const used = new Set<string>();
  const staged: string[] = RUNTIME_SLOT_KINDS.map(() => "");

  // 1. Patient
  const patient =
    pickFirst(humanoids, used, ["patient"])
    ?? humanoids.find((a) => !used.has(a.actorId));
  if (patient) {
    staged[0] = patient.actorId;
    used.add(patient.actorId);
  }

  // 2. Clinical staff (role class — physician included as clinical, not a one-off)
  const clinical = pickFirst(humanoids, used, CLINICAL_ROLE_CLASS);
  if (clinical) {
    staged[1] = clinical.actorId;
    used.add(clinical.actorId);
  }

  // 3. Family / collateral
  const family = pickFirst(humanoids, used, FAMILY_ROLE_CLASS);
  if (family) {
    staged[2] = family.actorId;
    used.add(family.actorId);
  }

  // 4. Remaining humanoids into additional_cast (and any extra indices if max raised later)
  const remaining = humanoids.filter((a) => !used.has(a.actorId));
  let slotIndex = 3;
  const notStaged: { actorId: string; reason: string }[] = [];
  for (const actor of remaining) {
    if (slotIndex < maxSlots && slotIndex < staged.length) {
      staged[slotIndex] = actor.actorId;
      used.add(actor.actorId);
      slotIndex += 1;
    } else {
      notStaged.push({
        actorId: actor.actorId,
        reason:
          `exceeds_max_visible_humanoid_slots_${maxSlots}_priority_patient_clinical_family_then_bank_order`,
      });
    }
  }

  // If maxSlots < 4, blank later slots (defense for tests).
  for (let i = maxSlots; i < staged.length; i += 1) {
    if (staged[i]) {
      notStaged.push({
        actorId: staged[i]!,
        reason: `exceeds_max_visible_humanoid_slots_${maxSlots}_priority_patient_clinical_family_then_bank_order`,
      });
      staged[i] = "";
    }
  }

  return {
    stagedActorIds: staged,
    notStagedActorIds: notStaged,
    patientActorId: staged[0] ?? "",
    clinicalTeamActorId: staged[1] ?? "",
    familyActorId: staged[2] ?? "",
    additionalActorId: staged[3] ?? "",
  };
}

export function filledStagedActorIds(assignment: RuntimeSlotAssignment): string[] {
  return assignment.stagedActorIds.filter((id) => id.trim().length > 0);
}
