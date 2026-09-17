/**
 * World Compile Graph typed ports (WCG typed-edge gate).
 *
 * MEASURED 2026-09-17. Two places in this package already agree on part of a closed
 * edge-kind vocabulary: `faculty-compile-lock.tsx:buildCompileEdges` deterministically
 * emits only `body_to_clothing` and `wardrobe_to_equipment`, and
 * `environment-generation-queue-panel.test.tsx:1175,1218` already asserts
 * `edge.kind === "body_to_clothing" || edge.kind === "wardrobe_to_equipment"` for that
 * output. Nothing enforced it as a real constraint: `seed-worldview-queue.tsx`'s
 * `mergeWorldviewCompileEdges` appended edges stamped with `kind: "ActorVariant"` (a node
 * FAMILY name, not an edge kind), `"fixtureSlot"`, `"trellisBake"` and `"authored"` —
 * none of them validated against anything, and none of them checked that the edge's
 * endpoints were even the right kind of node for that relationship.
 *
 * This module is the missing type-check: a closed `CompileEdgeKind` vocabulary, a port
 * type derived from each compile-graph node id's own shape (the id already encodes it —
 * `actor:<id>:body` vs `:wardrobe`, `equip:<id>`, `room:<id>`, `fixture:<id>`,
 * `trellis:<id>`), and a `validateCompileEdge` gate that REFUSES a candidate edge whose
 * kind does not exist, whose kind has no backing baker yet (`body_to_hair` /
 * `body_to_viseme` / `body_to_motion` — named in the WCG brief's edge-kind enum but no
 * `CompileNodeFamily` baker produces that output yet; declaring the edge anyway would be
 * exactly the "declaring a family is not licence to invent a node" mistake
 * `tools/openclinxr/factory/encounter-materialization-evidence.ts:7-29` already refuses
 * for node families), or whose endpoints are the wrong port type for that kind (a
 * body output may only feed a wardrobe input, never an equipment or room input).
 *
 * Browser-safe by construction: no `node:` import, pure functions only, so it can be
 * called from both the admin UI (`seed-worldview-queue.tsx`,
 * `environment-generation-queue-panel.tsx`) and re-implemented server-side against the
 * persisted evidence.v1 `compileEdges` field
 * (`tools/openclinxr/factory/encounter-materialization-evidence.ts`) without either side
 * importing the other's package.
 *
 * claimScope: edge-kind vocabulary and node-id-shape port typing for the World Compile
 * Graph as authored through this admin package. notEvidenceFor: runtime readiness, Quest
 * readiness, clinical validity, or that a bake actually ran — this only says a proposed
 * dependency is well-typed, never that the artifact exists.
 */

/**
 * Closed edge-kind vocabulary. `body_to_clothing` and `wardrobe_to_equipment` are the
 * kinds already deterministically emitted by `buildCompileEdges`. `equip_to_fixture_slot`,
 * `trellis_model_to_room` and `standalone_node_declared` name the three worldview actions
 * that previously stamped ad hoc, unvalidated strings. `room_independent` /
 * `equip_independent` / `requires_evidence` are carried over from
 * `docs/openclinxr/world-compile-graph-brief-2026-08-27.md`'s closed edge enum for the
 * same reason `body_to_hair` / `body_to_viseme` / `body_to_motion` are carried over as
 * RESERVED, NOT YET BUILDABLE: naming a kind here does not by itself license using it —
 * `validateCompileEdge` still checks it against a baker/port rule below.
 */
export const COMPILE_EDGE_KINDS = [
  "body_to_clothing",
  "wardrobe_to_equipment",
  "equip_to_fixture_slot",
  "trellis_model_to_room",
  "standalone_node_declared",
  "room_independent",
  "equip_independent",
  "requires_evidence",
  "body_to_hair",
  "body_to_viseme",
  "body_to_motion",
] as const;
export type CompileEdgeKind = (typeof COMPILE_EDGE_KINDS)[number];

/** Reserved in the vocabulary (so an old dated JSON naming them still parses as a known
 * kind) but refused by `validateCompileEdge`: no `CompileNodeFamily` baker produces a
 * hair, viseme or motion output today. */
export const COMPILE_EDGE_KINDS_WITHOUT_A_BAKER: ReadonlySet<CompileEdgeKind> = new Set([
  "body_to_hair",
  "body_to_viseme",
  "body_to_motion",
]);

/** The self-loop kind `reduceWorldviewAddNode` produces for a standalone extra node. */
export const SELF_LOOP_EDGE_KINDS: ReadonlySet<CompileEdgeKind> = new Set(["standalone_node_declared"]);

/** Compile-graph "output/input port" a node id's own shape declares. */
export const COMPILE_EDGE_PORT_TYPES = [
  "body",
  "wardrobe",
  "character_unsplit",
  "equipment",
  "room",
  "dialogue",
  "placement",
  "fixture_slot",
  "trellis_model",
] as const;
export type CompileEdgePortType = (typeof COMPILE_EDGE_PORT_TYPES)[number];

/**
 * Derive the port type a compile-graph node id declares, from the id's own shape —
 * the same shapes `encounter-materialization-evidence.ts:emitCompileNodes` /
 * `splitCharacterBakers` mint server-side (`actor:<id>`, `actor:<id>:body`,
 * `actor:<id>:wardrobe`, `equip:<id>`, `room:<id>`, `dialogue:<id>`, `placement:<id>`)
 * plus the two worldview-only id shapes this package mints for fixture-slot binds and
 * TRELLIS bakes (`fixture:<slot>`, `trellis:<modelId>`). Returns `null` for a shape that
 * declares no known port — an edge naming such a node is refused, not assumed.
 */
export function derivePortTypeFromNodeId(nodeId: string): CompileEdgePortType | null {
  if (nodeId.startsWith("actor:")) {
    if (nodeId.endsWith(":body")) return "body";
    if (nodeId.endsWith(":wardrobe")) return "wardrobe";
    return "character_unsplit";
  }
  if (nodeId.startsWith("equip:")) return "equipment";
  if (nodeId.startsWith("room:")) return "room";
  if (nodeId.startsWith("dialogue:")) return "dialogue";
  if (nodeId.startsWith("placement:")) return "placement";
  if (nodeId.startsWith("fixture:")) return "fixture_slot";
  if (nodeId.startsWith("trellis:")) return "trellis_model";
  return null;
}

type NodeRefRule = { from: readonly CompileEdgePortType[]; to: readonly CompileEdgePortType[] };

/** Port-compatibility table for kinds whose endpoints are compile-graph node ids. */
const NODE_REF_EDGE_RULES: Partial<Record<CompileEdgeKind, NodeRefRule>> = {
  body_to_clothing: { from: ["body"], to: ["wardrobe"] },
  wardrobe_to_equipment: { from: ["wardrobe"], to: ["equipment"] },
  equip_to_fixture_slot: { from: ["equipment"], to: ["fixture_slot"] },
  trellis_model_to_room: { from: ["trellis_model"], to: ["room"] },
  room_independent: { from: ["room"], to: ["body", "wardrobe", "character_unsplit"] },
  equip_independent: { from: ["equipment"], to: ["body", "wardrobe", "character_unsplit"] },
};

/** `requires_evidence` connects a work-order input id to an evidence-ref URI — neither
 * is a compile-graph node id, so this kind is checked by pattern, not by port lookup. */
const REQUIRES_EVIDENCE_FROM_PATTERN = /^(actor|equipment)-materialization-input:/;
const REQUIRES_EVIDENCE_TO_PATTERN = /^(actor|equipment)-materialization-evidence:\/\//;

export type CompileEdgeCandidate = { from: string; to: string; kind: string };

export type CompileEdgeValidation = { ok: true } | { ok: false; reason: string };

/**
 * Refuse a candidate compile edge unless its kind is known, buildable, and its
 * endpoints are the port types that kind requires. This is the type-check the
 * operator asked for: "a given output may only connect to a compatible input."
 */
export function validateCompileEdge(edge: CompileEdgeCandidate): CompileEdgeValidation {
  const kind = edge.kind as CompileEdgeKind;
  if (!(COMPILE_EDGE_KINDS as readonly string[]).includes(edge.kind)) {
    return {
      ok: false,
      reason: `unknown compile edge kind "${edge.kind}"; must be one of ${COMPILE_EDGE_KINDS.join(", ")}`,
    };
  }
  if (COMPILE_EDGE_KINDS_WITHOUT_A_BAKER.has(kind)) {
    return {
      ok: false,
      reason: `compile edge kind "${kind}" has no backing baker yet; declaring the edge without a baker invents a node the factory does not build`,
    };
  }
  if (kind === "requires_evidence") {
    if (!REQUIRES_EVIDENCE_FROM_PATTERN.test(edge.from)) {
      return { ok: false, reason: `requires_evidence edge "from" must match ${REQUIRES_EVIDENCE_FROM_PATTERN}; got "${edge.from}"` };
    }
    if (!REQUIRES_EVIDENCE_TO_PATTERN.test(edge.to)) {
      return { ok: false, reason: `requires_evidence edge "to" must match ${REQUIRES_EVIDENCE_TO_PATTERN}; got "${edge.to}"` };
    }
    return { ok: true };
  }
  if (SELF_LOOP_EDGE_KINDS.has(kind)) {
    if (edge.from !== edge.to) {
      return { ok: false, reason: `${kind} edge must be a self-loop (from === to); got "${edge.from}" -> "${edge.to}"` };
    }
    return { ok: true };
  }
  const rule = NODE_REF_EDGE_RULES[kind];
  if (!rule) {
    return { ok: false, reason: `compile edge kind "${kind}" has no port-compatibility rule` };
  }
  const fromType = derivePortTypeFromNodeId(edge.from);
  const toType = derivePortTypeFromNodeId(edge.to);
  if (fromType === null) {
    return { ok: false, reason: `edge "from" node "${edge.from}" has no recognizable compile-graph port shape` };
  }
  if (toType === null) {
    return { ok: false, reason: `edge "to" node "${edge.to}" has no recognizable compile-graph port shape` };
  }
  if (!rule.from.includes(fromType)) {
    return {
      ok: false,
      reason: `"${kind}" requires a ${rule.from.join("|")} output port; "${edge.from}" is a ${fromType} port`,
    };
  }
  if (!rule.to.includes(toType)) {
    return {
      ok: false,
      reason: `"${kind}" requires a ${rule.to.join("|")} input port; "${edge.to}" is a ${toType} port`,
    };
  }
  return { ok: true };
}

/**
 * Infer which single compile edge kind connects two node-id-shaped ports, for the
 * "connect nodes" worldview action where a user picks two existing nodes rather than
 * an already-typed kind. Returns `null` when no closed-vocabulary kind connects that
 * pair of port types — the caller must refuse the connection rather than invent one.
 */
export function inferCompileEdgeKind(fromNodeId: string, toNodeId: string): CompileEdgeKind | null {
  const fromType = derivePortTypeFromNodeId(fromNodeId);
  const toType = derivePortTypeFromNodeId(toNodeId);
  if (fromType === null || toType === null) {
    return null;
  }
  for (const [kind, rule] of Object.entries(NODE_REF_EDGE_RULES) as Array<[CompileEdgeKind, NodeRefRule]>) {
    if (rule.from.includes(fromType) && rule.to.includes(toType)) {
      return kind;
    }
  }
  return null;
}

/**
 * Resolve a user-picked (from, to) pair into a validated edge or a refusal reason.
 * Wraps `inferCompileEdgeKind` + `validateCompileEdge` so a caller need not construct
 * a candidate edge by hand.
 */
export function resolveCompileEdgeConnection(
  fromNodeId: string,
  toNodeId: string,
): { ok: true; edge: { from: string; to: string; kind: CompileEdgeKind } } | { ok: false; reason: string } {
  const kind = inferCompileEdgeKind(fromNodeId, toNodeId);
  if (kind === null) {
    const fromType = derivePortTypeFromNodeId(fromNodeId) ?? "unrecognized";
    const toType = derivePortTypeFromNodeId(toNodeId) ?? "unrecognized";
    return {
      ok: false,
      reason: `no compile edge kind connects a ${fromType} output to a ${toType} input`,
    };
  }
  const edge = { from: fromNodeId, to: toNodeId, kind };
  const validation = validateCompileEdge(edge);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  return { ok: true, edge };
}
