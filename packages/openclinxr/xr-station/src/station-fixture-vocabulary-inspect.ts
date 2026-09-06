/**
 * #186 — offline fixture vocabulary measure (runtime builders, no Playwright).
 * Lives under apps/ui-xr so `three` resolves with the rest of the station builders.
 *
 * claimScope: one object per ownable role; identity fixtures multi-mesh.
 * notEvidenceFor: clinical validity, Quest readiness, generated rooms.
 */

import {
  ENVIRONMENT_SHELL_DESCRIPTORS,
} from "@openclinxr/asset-registry";
import {
  buildDeclaredEquipmentGeometry,
  planStationEquipmentMounts,
} from "./station-equipment.js";
import { buildStationEnvironment } from "./station-environment.js";
import {
  roleClassFromEquipmentId,
  roleClassFromFixtureSlotId,
} from "./fixture-role-ownership.js";
import { BoxGeometry, Mesh, type Object3D } from "three";

export type EnvironmentRow = {
  environmentId: string;
  fixtureSlotIds: string[];
  builtFixtureKinds: string[];
  meshesPerRole: Record<string, number>;
  duplicateRoles: string[];
  undifferentiatedPropIds: string[];
};

export type StationFixtureVocabularyReport = {
  environments: EnvironmentRow[];
  fixtureKindVocabulary: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

function countMeshes(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof Mesh) n += 1;
  });
  return n;
}

function hasOnlyBodyCube(root: Object3D): boolean {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  if (meshes.length === 0) return true;
  if (meshes.length !== 1) return false;
  const geo = meshes[0]!.geometry;
  if (!(geo instanceof BoxGeometry)) return false;
  const { width, height, depth } = geo.parameters;
  return Math.abs(width - 1) < 0.02 && Math.abs(height - 1) < 0.02 && Math.abs(depth - 1) < 0.02;
}

/**
 * Optional equipment id list per environment (caller may supply from manifests).
 * Default empty — ownership still measured on fixture channel alone.
 */
export async function inspectStationFixtureVocabulary(input?: {
  equipmentByEnvironment?: Readonly<Record<string, readonly string[]>>;
}): Promise<StationFixtureVocabularyReport> {
  const kindVocab = new Set<string>();
  const environments: EnvironmentRow[] = [];
  const equipmentByEnvironment = input?.equipmentByEnvironment ?? {};

  for (const [environmentId, descriptor] of Object.entries(ENVIRONMENT_SHELL_DESCRIPTORS)) {
    const shell = buildStationEnvironment({ environmentId });
    const fixtureSlotIds = descriptor.fixtureSlots.map((s) => s.slotId);
    const ownedRoles = (shell.userData.fixtureOwnedRoles as string[] | undefined) ?? [];
    const ownedSet = new Set(ownedRoles);

    const meshesPerRole: Record<string, number> = {};
    const builtFixtureKinds: string[] = [];
    const undifferentiatedPropIds: string[] = [];

    for (const child of shell.children) {
      const slotId = child.userData?.fixtureSlotId as string | undefined;
      if (typeof slotId !== "string" || slotId.length === 0) continue;
      if (child.userData?.isMarkerCube === true) continue;

      const role =
        (child.userData?.openClinXrFixtureRole as string | undefined)
        ?? roleClassFromFixtureSlotId(slotId);
      meshesPerRole[role] = (meshesPerRole[role] ?? 0) + 1;

      const kind = (child.userData?.openClinXrFixtureKind as string | undefined)
        ?? (child.userData?.openClinXrChairKind as string | undefined)
        ?? (typeof child.userData?.deckTopYMeters === "number" ? "procedural_stretcher" : "layout");
      builtFixtureKinds.push(kind);
      kindVocab.add(kind);

      const identity = /door|board|chair|desk|counter|surface|stretcher|overbed/iu.test(slotId);
      if (identity) {
        const meshCount = countMeshes(child);
        if (meshCount < 2 || hasOnlyBodyCube(child)) {
          undifferentiatedPropIds.push(slotId);
        }
      }
    }

    const equipmentIds = [...(equipmentByEnvironment[environmentId] ?? [])];
    const plan = planStationEquipmentMounts({
      scenarioId: `inspect_${environmentId}`,
      equipment: equipmentIds.map((equipmentId) => ({ equipmentId })),
      equipmentPlacements: Object.fromEntries(
        equipmentIds.map((id) => [id, { position: { x: 0, y: 0, z: 0 } }]),
      ),
      fixtureOwnedRoles: ownedSet,
    });
    for (const item of plan) {
      const role = roleClassFromEquipmentId(item.equipmentId) ?? "layout_other";
      if (
        role === "support_surface"
        || role === "seating"
        || role === "door"
        || role === "wall_board"
        || role === "work_surface"
      ) {
        meshesPerRole[role] = (meshesPerRole[role] ?? 0) + 1;
      }
      if (/door|board|chair|desk|counter/iu.test(item.equipmentId)) {
        if (item.source === "fallback") undifferentiatedPropIds.push(item.equipmentId);
        const geo = buildDeclaredEquipmentGeometry(item.equipmentId);
        if (hasOnlyBodyCube(geo) || countMeshes(geo) < 2) {
          undifferentiatedPropIds.push(item.equipmentId);
        }
      }
    }

    const ignoreDual = new Set([
      "family_seating",
      "layout_other",
      "clinical_device",
      "learner_start",
    ]);
    const duplicateRoles = Object.entries(meshesPerRole)
      .filter(([, n]) => n > 1)
      .filter(([role]) => !ignoreDual.has(role))
      .map(([role]) => role)
      .sort();

    environments.push({
      environmentId,
      fixtureSlotIds,
      builtFixtureKinds: [...new Set(builtFixtureKinds)].sort(),
      meshesPerRole,
      duplicateRoles,
      undifferentiatedPropIds: [...new Set(undifferentiatedPropIds)].sort(),
    });
  }

  environments.sort((a, b) => a.environmentId.localeCompare(b.environmentId));

  return {
    environments,
    fixtureKindVocabulary: [...kindVocab].sort(),
    claimScope:
      "parametric shell fixture vocabulary + ownership-filtered equipment across all ENVIRONMENT_SHELL_DESCRIPTORS",
    notEvidenceFor: [
      "clinical_staging_validity",
      "quest_readiness",
      "generated_room_assets",
      "exam_equivalence",
    ],
  };
}
