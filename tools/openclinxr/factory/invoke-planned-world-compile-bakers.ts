import type { CompilePlanNode } from "./encounter-materialization-compile.js";
import type { WardrobeBakeDecision } from "./encounter-materialization-evidence.js";

/**
 * WCG brief — planned bakers get invoked (issue #0).
 *
 * compileEncounterMaterialization is the PLAN half: a wardrobe node's
 * `wouldInvoke` is "blender" exactly when the compile's bake decision says bake
 * (first_bake / body_changed). Locked wardrobes (locked_skip / locked_stale)
 * and cache hits keep wouldInvoke === null and are recorded in skippedBakers —
 * lock skip survives invocation: a node the plan did not mark wouldInvoke is
 * NEVER handed to a baker runner.
 *
 * This module is the INVOCATION half: iterate the planned nodes and run a
 * baker runner for each wouldInvoke === "blender" node. The runner is injected
 * so a unit test can pass a fake runner (no live Blender) while the
 * dark-factory world_compile station passes the chain's real baker runner
 * (multi-case-runner.ts runChainWorldCompileBaker). D9: bake duration is not a
 * constraint for a real baker.
 *
 * claimScope: a production caller iterates wouldInvoke === "blender" and
 * invokes a baker runner for those nodes. notEvidenceFor: a real Blender
 * process in a unit test; Quest; #167; baker split.
 */

/** A compile node the plan marked for invocation (wouldInvoke === "blender"). */
export type PlannedWorldCompileBakerNode = CompilePlanNode & { wouldInvoke: "blender" };

export type WorldCompileBakerRunnerInput = {
  node: PlannedWorldCompileBakerNode;
  /** Current artifact path for the node's bake output (null when the chain produced none). */
  artifactPath: string | null;
};

/** Runs the actual bake for one planned node. May be a fake in tests. */
export type WorldCompileBakerRunner = (input: WorldCompileBakerRunnerInput) => Promise<void> | void;

export type PlannedBakerInvocationRecord = {
  nodeId: string;
  bakerId: string;
  family: string;
  /** The bake decision that marked this node wouldInvoke (wardrobe nodes). */
  bakeReason: WardrobeBakeDecision["reason"] | null;
  artifactPath: string | null;
  cacheKey: string | null;
};

export type PlannedBakerInvocationFailure = {
  nodeId: string;
  error: string;
};

export type PlannedBakerInvocationReport = {
  schemaVersion: "openclinxr.world-compile.planned-baker-invocation.v1";
  runner: string;
  /** Nodes the plan marked wouldInvoke === "blender" and the runner was called for. */
  plannedCount: number;
  /** Runner calls that completed without throwing. */
  invokedCount: number;
  /** Planned nodes the runner was called for but threw. */
  failedCount: number;
  /** Nodes NOT handed to the runner: the plan says skip (lock skip stays). */
  skippedCount: number;
  invocations: PlannedBakerInvocationRecord[];
  failures: PlannedBakerInvocationFailure[];
  skippedNodeIds: string[];
};

export type InvokePlannedWorldCompileBakersOptions = {
  /** nodeId -> current artifact path for the node's bake output. */
  artifactPathsByNodeId?: Record<string, string>;
  /** Name stamped on the report (the production runner identity). */
  runnerName?: string;
};

/**
 * Iterate the compile plan and invoke a baker runner for every node the plan
 * marked wouldInvoke === "blender". Nodes the plan skipped (wouldInvoke ===
 * null: locked_skip / cache_hit / locked_stale / non-blender bakers) are
 * counted in skippedNodeIds and never reach the runner.
 *
 * A throwing runner is recorded in `failures` and does not stop the remaining
 * planned nodes — the invocation report is the deliverable, and a failing bake
 * must be visible, not fatal to the whole plan.
 */
export async function invokePlannedWorldCompileBakers(
  nodes: CompilePlanNode[],
  runner: WorldCompileBakerRunner,
  options: InvokePlannedWorldCompileBakersOptions = {},
): Promise<PlannedBakerInvocationReport> {
  const planned = nodes.filter((n): n is PlannedWorldCompileBakerNode => n.wouldInvoke === "blender");
  const skippedNodeIds = nodes.filter((n) => n.wouldInvoke !== "blender").map((n) => n.nodeId);
  const invocations: PlannedBakerInvocationRecord[] = [];
  const failures: PlannedBakerInvocationFailure[] = [];
  for (const node of planned) {
    const artifactPath = options.artifactPathsByNodeId?.[node.nodeId] ?? null;
    try {
      await runner({ node, artifactPath });
      invocations.push({
        nodeId: node.nodeId,
        bakerId: node.bakerId,
        family: node.family,
        bakeReason: node.bakeDecision?.reason ?? null,
        artifactPath,
        cacheKey: node.cacheKey,
      });
    } catch (err) {
      failures.push({ nodeId: node.nodeId, error: errMessage(err) });
    }
  }
  return {
    schemaVersion: "openclinxr.world-compile.planned-baker-invocation.v1",
    runner: options.runnerName ?? "unset",
    plannedCount: planned.length,
    invokedCount: invocations.length,
    failedCount: failures.length,
    skippedCount: skippedNodeIds.length,
    invocations,
    failures,
    skippedNodeIds,
  };
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n").slice(0, 3).join(" ");
  return String(err);
}
