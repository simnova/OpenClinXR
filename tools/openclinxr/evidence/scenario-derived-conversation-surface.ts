/**
 * #106 — inspect each station's conversation surface via the app's own resolver.
 *
 * Enumerates from scenarioBank (what ships), never a hardcoded station list.
 * offeredTraceTags + turns come from apps/ui-xr scenario-conversation-surface —
 * the same path createRuntimeStateFromBundle / remoteActorTurnForTraceTag use.
 *
 * claimScope: action-set set-equality with authored requiredTraceTags; safety-critical
 * turns spoken by the station's own cast.
 * notEvidenceFor: clinical quality of authored dialogue, wardrobe, geometry, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authoredSafetyCriticalTraceTagsForScenario,
  authoredTraceTagsForScenario,
  deriveScenarioTraceActionTags,
  resolveRemoteActorTurnForTraceTag,
  scenarioActorIdsForScenario,
} from "../../../apps/ui-xr/src/scenario-conversation-surface.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";

export const CONVERSATION_SURFACE_DIR = ".openclinxr/evidence/scenario-derived-conversation-surface";
export const CONVERSATION_SURFACE_NAME = "scenario-conversation-surface.json";

export type StationConversationSurface = {
  scenarioId: string;
  offeredTraceTags: string[];
  authoredTraceTags: string[];
  authoredSafetyCriticalTraceTags: string[];
  scenarioActorIds: string[];
  turns: { traceTag: string; actorId: string; learnerUtterance: string }[];
};

export type ScenarioConversationSurfaceReport = {
  stations: StationConversationSurface[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.scenario-derived-conversation-surface.v1";
  kind: "scenario_derived_conversation_surface";
  label: string;
  generatedAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
  /** Stations whose offered action set ≠ authored requiredTraceTags. */
  actionSetOffenders: string[];
  report: ScenarioConversationSurfaceReport;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function artifactPath(): string {
  return path.join(repoRoot, CONVERSATION_SURFACE_DIR, CONVERSATION_SURFACE_NAME);
}

/**
 * Run the app's conversation-surface resolver over every scenario the bank declares.
 * Writes `.openclinxr/evidence/scenario-derived-conversation-surface/scenario-conversation-surface.json`.
 */
export async function inspectScenarioConversationSurface(): Promise<ScenarioConversationSurfaceReport> {
  const stations: StationConversationSurface[] = scenarioBank.map((scenario) => {
    const scenarioId = scenario.scenarioId;
    // Same resolver as createRuntimeStateFromBundle when dialogueTurns are empty/missing.
    const offeredTraceTags = deriveScenarioTraceActionTags({ scenarioId, dialogueTurns: null });
    const turns: StationConversationSurface["turns"] = [];
    for (const tag of offeredTraceTags) {
      const plan = resolveRemoteActorTurnForTraceTag(tag, scenarioId);
      if (plan) {
        turns.push({
          traceTag: tag,
          actorId: plan.actorId,
          learnerUtterance: plan.learnerUtterance,
        });
      }
    }
    return {
      scenarioId,
      offeredTraceTags,
      authoredTraceTags: authoredTraceTagsForScenario(scenarioId),
      authoredSafetyCriticalTraceTags: authoredSafetyCriticalTraceTagsForScenario(scenarioId),
      scenarioActorIds: scenarioActorIdsForScenario(scenarioId),
      turns,
    };
  });

  const report: ScenarioConversationSurfaceReport = { stations };
  const actionSetOffenders = stations
    .filter((station) => {
      const offered = [...new Set(station.offeredTraceTags)].sort().join("\0");
      const authored = [...new Set(station.authoredTraceTags)].sort().join("\0");
      return offered !== authored;
    })
    .map((station) => station.scenarioId);

  const payload: ArtifactPayload = {
    schemaVersion: "openclinxr.scenario-derived-conversation-surface.v1",
    kind: "scenario_derived_conversation_surface",
    label: "scenario-derived-conversation-surface",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "offered_trace_tags_equal_authored_required_trace_tags",
      "safety_critical_turns_use_station_cast",
    ],
    notEvidenceFor: [
      "clinical_dialogue_quality",
      "wardrobe",
      "geometry",
      "quest_readiness",
      "scoring_validity",
    ],
    actionSetOffenders,
    report,
  };

  await mkdir(path.dirname(artifactPath()), { recursive: true });
  await writeFile(artifactPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return report;
}
