/**
 * Authoring adapter (D9 / D13): draft a worldview from an already-authored
 * case. The LLM (or a seeded stand-in) may pick missing values ONCE. Those
 * picks are recorded into llmDraftStamp so a later bake is deterministic.
 * This module does not invoke Blender, Infinigen, or any baker.
 */

import { createHash } from "node:crypto";
import type { CompileGraphNode } from "./encounter-materialization-evidence.js";

/** Closed cosmetic set the factory already accepts. `hazel` is refused downstream. */
const BUILDABLE_EYE_COLORS = ["brown", "blue", "green"] as const;

export type WorldviewDraftScenario = {
  scenarioId: string;
  actors?: Array<{ actorId: string; phenotype?: { eye_color?: string } }>;
  environment?: { environmentId?: string; infinigenPrompt?: string };
  equipment?: string[];
};

export type LlmDraftStamp = {
  draftSeed: string;
  model: string;
  llmDraftStamp: string;
  recordedPicks: {
    eyeColorByActorId: Record<string, string>;
    infinigenPrompt?: string;
  };
};

export type DraftWorldviewResult = {
  compileNodes: CompileGraphNode[];
  llmDraftStamp: LlmDraftStamp;
};

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickIndex(seedKey: string, modulo: number): number {
  if (modulo <= 0) {
    throw new Error("unbuildable_pick_space");
  }
  return fnv1a(seedKey) % modulo;
}

function plannedNode(partial: Omit<CompileGraphNode, "parents" | "cacheKey" | "contentHash" | "lock" | "status">): CompileGraphNode {
  return {
    ...partial,
    parents: [],
    cacheKey: null,
    contentHash: null,
    lock: { locked: false },
    status: "planned_unsplit",
  };
}

/**
 * Seeded, recorded, adapter-only worldview draft. Same (scenario, seed) yields
 * the same compileNodes and llmDraftStamp. Unbuildable inputs throw.
 */
export function draftWorldviewFromCase(
  scenario: WorldviewDraftScenario,
  opts: { seed: string; model: string },
): DraftWorldviewResult {
  const seed = opts.seed.trim();
  const model = opts.model.trim();
  const scenarioId = scenario.scenarioId?.trim() ?? "";
  if (!seed) {
    throw new Error("draft_seed_required");
  }
  if (!model) {
    throw new Error("draft_model_required");
  }
  if (!scenarioId) {
    throw new Error("scenarioId_required");
  }

  const eyeColorByActorId: Record<string, string> = {};
  const compileNodes: CompileGraphNode[] = [];

  for (const actor of scenario.actors ?? []) {
    const actorId = actor.actorId?.trim() ?? "";
    if (!actorId) {
      throw new Error("unbuildable_actor_missing_id");
    }
    const existing = actor.phenotype?.eye_color?.trim();
    if (existing && !(BUILDABLE_EYE_COLORS as readonly string[]).includes(existing)) {
      throw new Error(`unbuildable_eye_color:${existing}`);
    }
    const eyeColor =
      existing && (BUILDABLE_EYE_COLORS as readonly string[]).includes(existing)
        ? existing
        : BUILDABLE_EYE_COLORS[pickIndex(`${seed}:${scenarioId}:eye:${actorId}`, BUILDABLE_EYE_COLORS.length)]!;
    if (!existing) {
      eyeColorByActorId[actorId] = eyeColor;
    }
    compileNodes.push(
      plannedNode({
        nodeId: `actor:${actorId}`,
        family: "ActorVariant",
        bakerId: "unsplit_character",
        spec: {
          scenarioId,
          actorId,
          variantSemanticKey: actorId,
          sourceBlobName: actorId,
        },
      }),
    );
  }

  const environmentId = scenario.environment?.environmentId?.trim();
  let infinigenPrompt = scenario.environment?.infinigenPrompt?.trim();
  if (environmentId) {
    if (!infinigenPrompt) {
      infinigenPrompt = `seeded-room:${scenarioId}:${seed}`;
    }
    compileNodes.push(
      plannedNode({
        nodeId: `room:${environmentId}`,
        family: "Room",
        bakerId: "room_environment",
        spec: {
          scenarioId,
          environmentId,
          variantSemanticKey: environmentId,
          sourceBlobName: infinigenPrompt,
        },
      }),
    );
  }

  for (const equipmentId of scenario.equipment ?? []) {
    const id = equipmentId.trim();
    if (!id) {
      throw new Error("unbuildable_equipment_empty_id");
    }
    compileNodes.push(
      plannedNode({
        nodeId: `equip:${id}`,
        family: "EquipVariant",
        bakerId: "unsplit_equipment",
        spec: {
          scenarioId,
          equipmentId: id,
          variantSemanticKey: id,
          sourceBlobName: id,
        },
      }),
    );
  }

  const llmDraftStamp = createHash("sha256")
    .update(`${seed}\n${model}\n${scenarioId}\n${compileNodes.map((n) => n.nodeId).join(",")}`)
    .digest("hex");

  return {
    compileNodes,
    llmDraftStamp: {
      draftSeed: seed,
      model,
      llmDraftStamp,
      recordedPicks: {
        eyeColorByActorId,
        ...(infinigenPrompt && !scenario.environment?.infinigenPrompt?.trim() ? { infinigenPrompt } : {}),
      },
    },
  };
}
