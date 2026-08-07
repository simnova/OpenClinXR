/**
 * #107 cast-identity SSOT inspector — bank vs shipped bundle vs resolved cast.
 *
 * Enumerates stations from scenarioBank (typed actors field), never a text search.
 * claimScope: cast identity agreement between bank, shipped learner-runtime-bundle,
 * resolveScenarioActorCast, and Mock Dialogue naming.
 * notEvidenceFor: clinical likeness, wardrobe quality, Quest readiness, dialogue quality.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import {
  bankPatientDisplayNameForScenario,
  initialDialogueTextForScenario,
} from "../../../apps/ui-xr/src/initial-dialogue-text.js";

export type StationCastAgreement = {
  scenarioId: string;
  bankHumanoidActorIds: string[];
  bundleHumanoidActorIds: string[];
  resolvedCastActorIds: string[];
  initialDialogueText: string;
  bankPatientDisplayName: string;
};

export type CastIdentityAgreementReport = {
  stations: StationCastAgreement[];
};

export const CAST_IDENTITY_SSOT_DIR = ".openclinxr/evidence/cast-identity-ssot";
export const CAST_IDENTITY_SSOT_NAME = "cast-identity-agreement.json";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Same non-mesh filter as actor-casting.isHumanoidCastActor (not exported). */
function isHumanoidCastActor(actor: { actorId: string; role: string }): boolean {
  const role = actor.role.toLowerCase();
  if (role === "system") return false;
  if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
  return true;
}

function bundlePathFor(scenarioId: string): string {
  return path.join(
    repoRoot,
    "apps/ui-xr/public/xr-assets/generated",
    scenarioId,
    "learner-runtime-bundle.v1.json",
  );
}

async function readBundleActors(scenarioId: string): Promise<{
  actorIds: string[];
  initialDialogueText: string | null;
}> {
  const abs = bundlePathFor(scenarioId);
  if (!existsSync(abs)) return { actorIds: [], initialDialogueText: null };
  try {
    const raw = JSON.parse(await readFile(abs, "utf8")) as {
      actors?: Array<{ actorId?: unknown; role?: unknown }>;
      sceneManifest?: { stationContext?: { initialDialogueText?: unknown } };
    };
    const actorIds = (raw.actors ?? [])
      .filter(
        (a): a is { actorId: string; role: string } =>
          typeof a.actorId === "string" && typeof a.role === "string",
      )
      .filter(isHumanoidCastActor)
      .map((a) => a.actorId);
    const dialogue = raw.sceneManifest?.stationContext?.initialDialogueText;
    return {
      actorIds,
      initialDialogueText: typeof dialogue === "string" && dialogue.length > 0 ? dialogue : null,
    };
  } catch {
    return { actorIds: [], initialDialogueText: null };
  }
}

/**
 * Enumerate every bank scenario and compare bank cast, shipped bundle cast,
 * resolveScenarioActorCast, and the Mock Dialogue line the runtime would show.
 */
export async function inspectCastIdentityAgreement(): Promise<CastIdentityAgreementReport> {
  const stations: StationCastAgreement[] = [];

  for (const scenario of scenarioBank) {
    const scenarioId = scenario.scenarioId;
    const bankHumanoidActorIds = scenario.actors
      .filter(isHumanoidCastActor)
      .map((a) => a.actorId);
    const resolvedCastActorIds = resolveScenarioActorCast(scenarioId).map((c) => c.actorId);
    const bundle = await readBundleActors(scenarioId);
    const bankPatientDisplayName = bankPatientDisplayNameForScenario(scenarioId);
    const initialDialogueText = initialDialogueTextForScenario({
      scenarioId,
      runtimeInitialDialogueText: bundle.initialDialogueText,
      bundleMismatch: false,
    });

    stations.push({
      scenarioId,
      bankHumanoidActorIds,
      bundleHumanoidActorIds: bundle.actorIds,
      resolvedCastActorIds,
      initialDialogueText,
      bankPatientDisplayName,
    });
  }

  const report: CastIdentityAgreementReport = { stations };
  const outDir = path.join(repoRoot, CAST_IDENTITY_SSOT_DIR);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, CAST_IDENTITY_SSOT_NAME),
    `${JSON.stringify(
      {
        schemaVersion: "openclinxr.cast-identity-ssot.v1",
        kind: "cast_identity_agreement",
        generatedAt: new Date().toISOString(),
        claimScope: [
          "bank_vs_shipped_bundle_cast_set_equality",
          "resolveScenarioActorCast_matches_bank_humanoids",
          "mock_dialogue_names_bank_patient",
        ],
        notEvidenceFor: [
          "clinical_likeness",
          "wardrobe_quality",
          "quest_readiness",
          "dialogue_quality",
        ],
        report,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return report;
}
