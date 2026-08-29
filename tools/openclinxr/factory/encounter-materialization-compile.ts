import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256ContentHashOfArtifactAt } from "./encounter-asset-generation-queue.js";
import {
  buildEncounterMaterializationEvidenceReport,
  type CompileGraphNode,
  type EncounterMaterializationEvidenceReport,
  emitCompileNodes,
  planWardrobeBake,
  splitCharacterBakers,
  validateEncounterMaterializationEvidenceReport,
  type WardrobeBakeDecision,
} from "./encounter-materialization-evidence.js";
import {
  type FacultyCompileLock,
  facultyCompileLocksPathForScenario,
  persistFacultyCompileLocks,
  readFacultyCompileLocksFile,
} from "./encounter-materialization-faculty-locks.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

/**
 * World Compile Graph compile runner (WCG brief 2026-08-27, Phase 4).
 *
 * One compile = one `compileVersion`. The output stays
 * `openclinxr.encounter-materialization-evidence.v1` with additive optional
 * fields only (compileNodes, compileVersion, compileEdges), so dated JSON
 * keeps validating and no fourth factory ledger is minted.
 *
 * A compile never claims a baker ran. ActorVariant nodes are split into
 * body + wardrobe bakers; each wardrobe gets a `planWardrobeBake` decision.
 * Bake => the node records `wouldInvoke: "blender"`; skip => the baker is
 * recorded in `skippedBakers` and wouldInvoke stays null.
 *
 * Skip-capable bakers (body + wardrobe) also stamp a recipe `cacheKey` (WCG
 * brief Q3): sha256 over bakerId, bakerVersion, the spec the baker reads (after
 * overridePatch), parent OUTPUT hashes, and the seed. Recipe identity is
 * stamped whether or not this compile invokes the baker; contentHash stays the
 * observed artifact hash and lock stays metadata, never recipe input.
 *
 * contentHash is never a placeholder literal: a node's hash is the sha256 of
 * the artifact bytes at an explicitly provided path, or the copied prior
 * value, or null. The queue stub literal
 * `local-deterministic-encounter-definition-contract` is always refused.
 */

/** The queue stub hash that never names artifact bytes. */
export const CONTENT_HASH_STUB_LITERAL = "local-deterministic-encounter-definition-contract";

/**
 * WCG baker version stamped into every recipe key. Bump to invalidate all
 * recipes for a baker (a changed baker means changed output semantics).
 */
export const WCG_BAKER_VERSION = "wcg-v1";

/**
 * WCG brief Q3 recipe formula:
 *   cacheKey = sha256(canonicalJson({ bakerId, bakerVersion, spec,
 *   parentOutputHashes, seed }))
 *
 * The recipe identifies the baker's INPUTS — the case slice it reads, the
 * parent artifacts it consumes, the seed — never its output. contentHash stays
 * the observed artifact hash; lock/overridePatch metadata never enters spec.
 */
export function compileCacheKey(input: {
  bakerId: string;
  bakerVersion: string;
  spec: CompileGraphNode["spec"];
  parentOutputHashes: string[];
  seed: string;
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** Recipe key for a node: parent OUTPUT hashes (contentHash), never parent cacheKeys. */
function recipeKeyFor(node: CompileGraphNode, parentOutputHashes: string[]): string {
  return compileCacheKey({
    bakerId: node.bakerId,
    bakerVersion: WCG_BAKER_VERSION,
    spec: specAfterOverride(node),
    parentOutputHashes,
    seed: node.spec.scenarioId ?? node.spec.actorId ?? "",
  });
}

/**
 * The spec slice the baker actually reads (WCG brief Q3: spec' = apply(spec,
 * overridePatch)). A faculty override therefore changes the recipe key — lock is
 * metadata and stays out of the recipe, but the patched spec is what a bake reads.
 */
function specAfterOverride(node: CompileGraphNode): CompileGraphNode["spec"] {
  if (!node.overridePatch) return node.spec;
  const patched = { ...node.spec } as Record<string, unknown>;
  const key = node.overridePatch.path.replace(/^\//, "");
  if (node.overridePatch.op === "remove") {
    delete patched[key];
  } else {
    patched[key] = node.overridePatch.value;
  }
  return patched as CompileGraphNode["spec"];
}

/** Deterministic JSON serialization (recursively sorted object keys) for hashing. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortCanonical(value[key]);
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CompileEncounterMaterializationOptions = {
  /** Path to a prior dated evidence JSON (e.g. docs/openclinxr/encounter-materialization-evidence-*.json). */
  priorPath?: string;
  /** In-memory prior evidence report. Takes precedence over priorPath. */
  prior?: EncounterMaterializationEvidenceReport;
  /** Bundle report used to build a fresh evidence report when no prior is given. */
  bundleReport?: GeneratedEdStationRuntimeBundleReport;
  /** caseDefVersion to stamp on the compiled report (copied from prior when absent). */
  caseDefVersion?: number;
  /** Output path for the compiled JSON. Defaults to a dated sibling of priorPath. */
  outPath?: string;
  /**
   * Current baked-artifact path per node id (e.g. "actor:X:body" or
   * "actor:X:wardrobe"). Hashed with sha256ContentHashOfArtifactAt; a missing
   * file yields null (WCG dirty rule: unknown edge = dirty).
   */
  artifactPathsByNodeId?: Record<string, string>;
  /** Explicit current body output hash per body node id; overrides the artifact-path hash. */
  bodyHashNowByNodeId?: Record<string, string>;
  /**
   * Faculty compile locks applied via persistFacultyCompileLocks BEFORE the
   * wardrobe bake plan is computed, so a locked wardrobe skips blender on this
   * compile. The persisted nodes become the copy-prior source for the run.
   */
  facultyLocks?: FacultyCompileLock[];
  /**
   * Path to the admin-persisted compile-locks file (apps/api writes
   * .openclinxr/compile-locks/<scenarioId>.json). Defaults to the repo-rooted
   * per-scenario path; absent file is a no-op.
   */
  compileLocksPath?: string;
  /**
   * Faculty compile graph from POST /internal/world-compile (W14a). When
   * present and non-empty, these nodes are the copy-prior source instead of
   * only the dated evidence JSON.
   */
  compileNodes?: CompileGraphNode[];
  /** Faculty Infinigen prompt stamped onto Room node specs (W6 / W14a). */
  infinigenPrompt?: string;
};

/** A compile node annotated with the bake plan this compile produced. */
export type CompilePlanNode = CompileGraphNode & {
  /** "blender" only when this node's baker is invoked by this compile; null means the baker is skipped or has no bake step. */
  wouldInvoke: "blender" | null;
  /** The wardrobe bake decision (ActorVariant wardrobe nodes only). */
  bakeDecision?: WardrobeBakeDecision;
};

export type CompileEncounterMaterializationResult = {
  report: EncounterMaterializationEvidenceReport;
  /** nodeIds of wardrobe bakers skipped by this compile (bake === false). */
  skippedBakers: string[];
  compileVersion: number;
};

export async function compileEncounterMaterialization(
  opts: CompileEncounterMaterializationOptions,
): Promise<CompileEncounterMaterializationResult> {
  const base = await resolveBaseReport(opts);
  let report = base.report;
  let priorNodes = base.priorNodes;
  const priorCompileVersion = base.priorCompileVersion;
  const compileVersion = priorCompileVersion + 1;

  // Faculty locks persist into compileNodes first; the copy-prior rule below
  // then re-applies them at split granularity, so planWardrobeBake sees the
  // lock and skips a locked wardrobe on this very compile. Explicit
  // opts.facultyLocks win over the admin-persisted file on nodeId collisions.
  const facultyLocks = await resolveFacultyCompileLocks(opts, base.report.scenarioId);
  if (facultyLocks.length > 0) {
    const persisted = await persistFacultyCompileLocks({ prior: report, locks: facultyLocks });
    report = persisted;
    priorNodes = persisted.compileNodes ?? [];
  }

  // WCG-0 copy-prior rule: emitCompileNodes copies prior lock/contentHash by nodeId.
  const unsplitNodes = stampRoomInfinigenPrompt(emitCompileNodes(report, priorNodes), opts.infinigenPrompt);

  const plannedNodes: CompilePlanNode[] = [];
  const skippedBakers: string[] = [];
  const sidecarWrites: Array<{ glbPath: string; bodyHashAtWardrobeBake: string | null; bodyHashNow: string | null }> = [];
  for (const node of unsplitNodes) {
    if (node.family === "ActorVariant" && node.bakerId === "unsplit_character") {
      const [body, wardrobe] = splitCharacterBakers(node);
      // Split priors store locks on the split children (this runner's own
      // output), so re-apply the copy-prior rule at split granularity too.
      const plannedBody = copyPriorByNodeId(body, priorNodes);
      const plannedWardrobe = copyPriorByNodeId(wardrobe, priorNodes);
      const bodyHashNow = resolveBodyHashNow(opts, plannedBody);
      const bodyHashAtWardrobeBake = resolveBodyHashAtWardrobeBake(priorNodes, node, plannedWardrobe);
      // Resolve the wardrobe's artifact hash BEFORE the bake plan: a GLB that
      // exists on disk is baked, so first_bake/cache_hit/locked_skip must be
      // decided against the artifact, not only the copied prior value.
      const wardrobeHashNow = resolveContentHash(plannedWardrobe, opts);
      const decision = decideWardrobeBake({ ...plannedWardrobe, contentHash: wardrobeHashNow }, bodyHashAtWardrobeBake, bodyHashNow);
      // Skip-capable bakers stamp a recipe cacheKey from their inputs (spec
      // after overridePatch + parent OUTPUT hashes + seed), never from a prior
      // cacheKey or a lock. Stamped whether or not this compile invokes the baker.
      const bodyOutputHash = resolveContentHash(plannedBody, opts);
      plannedNodes.push({
        ...plannedBody,
        contentHash: bodyOutputHash,
        cacheKey: recipeKeyFor(plannedBody, []),
        wouldInvoke: null,
      });
      plannedNodes.push({
        ...plannedWardrobe,
        contentHash: wardrobeHashNow,
        cacheKey: recipeKeyFor(plannedWardrobe, bodyOutputHash ? [bodyOutputHash] : []),
        wouldInvoke: decision.bake ? "blender" : null,
        bakeDecision: decision,
      });
      if (!decision.bake) {
        skippedBakers.push(plannedWardrobe.nodeId);
        const glbPath = opts.artifactPathsByNodeId?.[plannedWardrobe.nodeId];
        if (glbPath && /\.glb$/i.test(glbPath)) {
          sidecarWrites.push({ glbPath, bodyHashAtWardrobeBake, bodyHashNow });
        }
      }
      continue;
    }
    plannedNodes.push({
      ...copyPriorByNodeId(node, priorNodes),
      contentHash: resolveContentHash(node, opts),
      wouldInvoke: null,
    });
  }

  // A skipped wardrobe baker tells the Python generate() not to invoke
  // automate_blender: write the wcg-wardrobe-lock sidecar next to its GLB.
  for (const write of sidecarWrites) {
    await writeWardrobeLockSidecar(write.glbPath, write.bodyHashAtWardrobeBake, write.bodyHashNow);
  }

  const compiledReport: EncounterMaterializationEvidenceReport = {
    ...report,
    caseDefVersion: opts.caseDefVersion ?? report.caseDefVersion,
    compileVersion,
    compileEdges: mergeCompileEdges(plannedNodes, report.compileEdges ?? []),
    compileNodes: plannedNodes,
  };

  const targetPath = opts.outPath ?? (base.priorPath ? datedSiblingPath(base.priorPath, report.scenarioId) : null);
  if (targetPath) {
    await writeFile(targetPath, `${JSON.stringify(compiledReport, null, 2)}\n`, "utf8");
  }

  return { report: compiledReport, skippedBakers, compileVersion };
}

async function resolveBaseReport(opts: CompileEncounterMaterializationOptions): Promise<{
  report: EncounterMaterializationEvidenceReport;
  priorNodes: CompileGraphNode[];
  priorCompileVersion: number;
  priorPath: string | null;
}> {
  let report = opts.prior ?? null;
  const priorPath = opts.priorPath ?? null;
  if (!report && priorPath) {
    const raw = JSON.parse(await readFile(priorPath, "utf8")) as unknown;
    const validation = validateEncounterMaterializationEvidenceReport(raw);
    if (!validation.ok) {
      throw new Error(`prior evidence JSON failed validation: ${validation.errors.join("; ")}`);
    }
    report = raw as EncounterMaterializationEvidenceReport;
  }
  if (!report) {
    if (!opts.bundleReport) {
      throw new Error("compileEncounterMaterialization requires opts.prior, opts.priorPath, or opts.bundleReport");
    }
    report = buildEncounterMaterializationEvidenceReport({ bundleReport: opts.bundleReport });
  }
  return {
    report,
    priorNodes:
      opts.compileNodes && opts.compileNodes.length > 0 ? opts.compileNodes : (report.compileNodes ?? []),
    priorCompileVersion: report.compileVersion ?? 0,
    priorPath,
  };
}

function stampRoomInfinigenPrompt(nodes: CompileGraphNode[], infinigenPrompt: string | undefined): CompileGraphNode[] {
  const prompt = infinigenPrompt?.trim();
  if (!prompt) return nodes;
  return nodes.map((node) => {
    if (node.family !== "Room") return node;
    return {
      ...node,
      spec: { ...node.spec, infinigenPrompt: prompt },
    };
  });
}

/** Admin-persisted compile-locks file + explicit facultyLocks, explicit wins on collision. */
async function resolveFacultyCompileLocks(
  opts: CompileEncounterMaterializationOptions,
  scenarioId: string | null,
): Promise<FacultyCompileLock[]> {
  const explicit = opts.facultyLocks ?? [];
  if (!scenarioId) {
    return explicit;
  }
  const filePath = opts.compileLocksPath ?? facultyCompileLocksPathForScenario(scenarioId);
  const fileLocks = await readFacultyCompileLocksFile(filePath, scenarioId);
  return [...fileLocks, ...explicit];
}

/** WCG-0 copy-prior rule at node granularity: lock/contentHash/overridePatch by nodeId. */
function copyPriorByNodeId(node: CompileGraphNode, priorNodes: CompileGraphNode[]): CompileGraphNode {
  const prior = priorNodes.find((p) => p.nodeId === node.nodeId);
  if (!prior) return node;
  return { ...node, contentHash: prior.contentHash, lock: prior.lock, overridePatch: prior.overridePatch };
}

/** Current body output hash: explicit value, else sha256 of the artifact bytes, else null. */
function resolveBodyHashNow(opts: CompileEncounterMaterializationOptions, body: CompileGraphNode): string | null {
  const explicit = opts.bodyHashNowByNodeId?.[body.nodeId];
  if (explicit !== undefined) return explicit;
  const artifactPath = opts.artifactPathsByNodeId?.[body.nodeId];
  if (artifactPath) return sha256ContentHashOfArtifactAt(artifactPath);
  return null;
}

/**
 * The body output hash the wardrobe was last baked against. Prefers the prior
 * split body node's contentHash (the wardrobe's parent in this runner's
 * output), then the locked wardrobe's lockedContentHash (faculty lock record),
 * then the Phase-0 unsplit node's contentHash (pre-split whole-character bake).
 */
function resolveBodyHashAtWardrobeBake(
  priorNodes: CompileGraphNode[],
  unsplitNode: CompileGraphNode,
  wardrobe: CompileGraphNode,
): string | null {
  const bodyNodeId = `actor:${unsplitNode.spec.actorId}:body`;
  const priorBody = priorNodes.find((p) => p.nodeId === bodyNodeId);
  if (priorBody?.contentHash) return priorBody.contentHash;
  if (wardrobe.lock.lockedContentHash) return wardrobe.lock.lockedContentHash;
  if (unsplitNode.contentHash) return unsplitNode.contentHash;
  return null;
}

/** planWardrobeBake plus the WCG dirty rule for an unresolvable body hash (unknown edge = dirty). */
function decideWardrobeBake(
  wardrobe: CompileGraphNode,
  bodyHashAtWardrobeBake: string | null,
  bodyHashNow: string | null,
): WardrobeBakeDecision {
  if (bodyHashNow === null) {
    if (wardrobe.contentHash === null) return { bake: true, reason: "first_bake", stale: false };
    if (wardrobe.lock.locked) return { bake: false, reason: "locked_stale", stale: true };
    return { bake: true, reason: "body_changed", stale: false };
  }
  return planWardrobeBake(wardrobe, bodyHashAtWardrobeBake, bodyHashNow);
}

/**
 * A node's contentHash is the sha256 of its artifact bytes when an artifact
 * path is given, else the copied prior value, else null. The queue stub literal
 * is never emitted as a bake identity.
 */
function resolveContentHash(node: CompileGraphNode, opts: CompileEncounterMaterializationOptions): string | null {
  const artifactPath = opts.artifactPathsByNodeId?.[node.nodeId];
  if (artifactPath) return sha256ContentHashOfArtifactAt(artifactPath);
  if (node.contentHash === CONTENT_HASH_STUB_LITERAL) return null;
  return node.contentHash;
}

/** body_to_clothing edges for each split wardrobe, deduped against prior edges. */
function mergeCompileEdges(
  plannedNodes: CompilePlanNode[],
  priorEdges: NonNullable<EncounterMaterializationEvidenceReport["compileEdges"]>,
): NonNullable<EncounterMaterializationEvidenceReport["compileEdges"]> {
  const edges = [...priorEdges];
  const seen = new Set(edges.map((edge) => `${edge.from}|${edge.to}|${edge.kind}`));
  for (const node of plannedNodes) {
    if (node.family !== "ActorVariant" || node.bakerId !== "body_character") continue;
    const wardrobeId = node.nodeId.replace(/:body$/, ":wardrobe");
    if (plannedNodes.some((p) => p.nodeId === wardrobeId && p.bakerId === "wardrobe_character")) {
      const key = `${node.nodeId}|${wardrobeId}|body_to_clothing`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: node.nodeId, to: wardrobeId, kind: "body_to_clothing" });
      }
    }
  }
  return edges;
}

/** Dated sibling output next to the prior JSON, matching the dated-evidence file convention. */
function datedSiblingPath(priorPath: string, scenarioId: string | null): string {
  const scenario = scenarioId ?? "scenario";
  return path.join(path.dirname(priorPath), `encounter-materialization-evidence-${scenario}-${new Date().toISOString().slice(0, 10)}.json`);
}

/**
 * Faculty wardrobe-lock sidecar consumed by
 * orchestrate_character.py generate(): {skipBlender:true} tells the wardrobe
 * baker (stage=both/blender) not to invoke automate_blender. Sits next to the
 * GLB, matching Path(output_glb).with_name(stem + ".wcg-wardrobe-lock.json").
 */
export function wardrobeLockSidecarPathFor(glbPath: string): string {
  return glbPath.replace(/\.glb$/i, ".wcg-wardrobe-lock.json");
}

async function writeWardrobeLockSidecar(glbPath: string, bodyHashAtWardrobeBake: string | null, bodyHashNow: string | null): Promise<void> {
  const payload: Record<string, unknown> = { skipBlender: true, locked: true };
  if (bodyHashAtWardrobeBake) payload.bodyHashAtBake = bodyHashAtWardrobeBake;
  if (bodyHashNow) payload.bodyHashNow = bodyHashNow;
  await writeFile(wardrobeLockSidecarPathFor(glbPath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
