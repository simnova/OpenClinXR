/**
 * #114 inspector — every bank station: does it ship a bundle, and whose Trace Actions
 * does the running derivation resolve?
 *
 * claimScope: bundle identity + bank-aligned action set (bundle or no bundle).
 * notEvidenceFor: geometry quality, wardrobe, clinical validity, Quest readiness.
 *
 * Trace tags use the same derivation the app uses (`deriveRuntimeTraceActionTagsFromBundle`)
 * with the selected station id, matching `createRuntimeStateFromBundle(..., selectedScenarioId)`.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  authoredTraceTagsForScenario,
  deriveRuntimeTraceActionTagsFromBundle,
} from "../../../apps/ui-xr/src/scenario-conversation-surface.js";

export type StationIdentity = {
  scenarioId: string;
  shipsBundle: boolean;
  bundleScenarioId: string;
  bundleHumanoidActorIds: string[];
  bankHumanoidActorIds: string[];
  resolvedTraceTags: string[];
  bankTraceTags: string[];
  bundleInitialDialogueText: string;
};

export type BundlelessStationIdentityReport = {
  stations: StationIdentity[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

/** Same filter as factory bankHumanoidActorsForPreset / casting SSOT. */
export function isHumanoidBankActor(actor: { actorId: string; role: string }): boolean {
  const role = actor.role.toLowerCase();
  if (role === "system") return false;
  if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
  return true;
}

function humanoidActorIdsFromBundle(bundle: {
  actors?: ReadonlyArray<{ actorId: string; embodiment?: string | null }>;
}): string[] {
  return (bundle.actors ?? [])
    .filter((actor) => actor.embodiment !== "virtual_device" && actor.embodiment !== "voice_only")
    .map((actor) => actor.actorId);
}

async function readShippedLearnerBundle(scenarioId: string): Promise<{
  scenarioId: string;
  actors?: Array<{ actorId: string; embodiment?: string | null }>;
  sceneManifest?: { stationContext?: { initialDialogueText?: string }; dialogueTurns?: unknown };
} | null> {
  const bundlePath = path.join(generatedRoot, scenarioId, "learner-runtime-bundle.v1.json");
  if (!existsSync(bundlePath)) return null;
  return JSON.parse(await readFile(bundlePath, "utf8")) as {
    scenarioId: string;
    actors?: Array<{ actorId: string; embodiment?: string | null }>;
    sceneManifest?: { stationContext?: { initialDialogueText?: string }; dialogueTurns?: unknown };
  };
}

/**
 * Enumerate every bank station. When a static bundle is missing, mirror boot: the ED
 * local fixture stays loaded, but tag derivation keys on the selected station (#114).
 */
export async function inspectBundlelessStationIdentity(): Promise<BundlelessStationIdentityReport> {
  const edFallback = createEdChestPainLocalLearnerRuntimeAssetBundle();
  const stations: StationIdentity[] = [];

  for (const scenario of scenarioBank) {
    const scenarioId = scenario.scenarioId;
    const shipped = await readShippedLearnerBundle(scenarioId);
    const shipsBundle = shipped !== null;
    const effectiveBundle = shipsBundle
      ? (shipped as typeof edFallback)
      : edFallback;

    const resolvedTraceTags = deriveRuntimeTraceActionTagsFromBundle(
      effectiveBundle,
      scenarioId,
    );

    stations.push({
      scenarioId,
      shipsBundle,
      bundleScenarioId: shipsBundle ? (shipped?.scenarioId ?? "") : "",
      bundleHumanoidActorIds: shipsBundle ? humanoidActorIdsFromBundle(shipped ?? {}) : [],
      bankHumanoidActorIds: scenario.actors.filter(isHumanoidBankActor).map((actor) => actor.actorId),
      resolvedTraceTags,
      bankTraceTags: authoredTraceTagsForScenario(scenarioId),
      bundleInitialDialogueText: shipsBundle
        ? (shipped?.sceneManifest?.stationContext?.initialDialogueText ?? "")
        : "",
    });
  }

  return { stations };
}
