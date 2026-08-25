#!/usr/bin/env tsx
/**
 * dispatch-worker — the ONE supported way to dispatch a headless grok worker.
 *
 * WHY THIS EXISTS: every rule below was learned by losing work. They were written down in
 * `agentic-eval/docs/findings/delegation-reliability.md` and then violated anyway, because a
 * finding in a document only helps the person who happens to re-read it. Encoding them in the
 * dispatch path means they hold whether or not anyone remembers them.
 *
 * Each rule is annotated with the incident that produced it.
 *
 * BYPASS CHOKEPOINT: shell-tool attempts to run raw `grok -p` / `--single` / `--prompt-file` are
 * refused by `dispatch-chokepoint.ts` (PreToolUse). This module uses `spawn(binary, argv)` so it
 * never hits that matcher. Orchestrator isolation probes that must run with path denies OFF use the
 * named escape OPENCLINXR_RAW_GROK_SANCTIONED + OPENCLINXR_RAW_GROK_REASON (logged). The
 * chokepoint is a string matcher over shell command text — not an OS sandbox; see that file.
 */

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildRepoAgentSpawnPrompt } from "../../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.js";
import { getRepoRoleHarnessPolicy, resolveHarnessModelSpec } from "../../../packages/openclinxr/agent-loop/src/role-harness-policy.js";
import {
  DONE_WHEN_RULE_VOCABULARY,
  evaluateDoneWhenRule,
  isKnownDoneWhenRule,
  partitionDoneWhen,
  writeBaselineHashes,
  type DoneWhenEvalOptions,
} from "../../../packages/openclinxr/agent-loop/src/done-when-rules.js";
import type { DoneWhenCheck } from "../../../packages/openclinxr/agent-loop/src/slice-team.js";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { shouldRefuseDispatch, type BreakerRow } from "./retry-circuit-breaker.js";
import { classifyDeath } from "./death-reason.js";
import { deriveHandoffState } from "./worker-handoff-state.js";
import { assertLoopNotPaused } from "./loop-pause.js";
import { assertProductLaneNotStarved, assertPulseMeasurementAlive } from "./product-lane-gate.js";
import { setFactoryField } from "./board-cli.js";
import { evaluateProofTargetsBeforeDispatch } from "./proof-target-preflight.js";
import { provisionWorktreeAssetsSync } from "./worktree-asset-provisioning.js";
import { ensureWorktreeBaseFresh } from "./worktree-base-freshness.js";

/**
 * INCIDENT: a worker was capped at 50 turns and died at exactly turn 50; another survived by one
 * turn under a cap of 70. Median successful worker: 21 turns. Caps of 25-70 sit in the worst
 * possible band — generous-looking, yet lethal to substantial work. A killed worker wastes every
 * token already spent PLUS salvage time, so a cap is strictly worse than letting it finish.
 * Cost is controlled by scoping the task, not by capping turns. 150 is a runaway backstop.
 */
const DEFAULT_MAX_TURNS = 150;

/** INCIDENT: doc-hygiene overreach — workers rewrote unrelated docs without this set. */
const REQUIRED_ENV = { OPENCLINXR_WORKER: "1", GROK_SUBAGENTS: "1" } as const;

/**
 * SECURITY: `RUST_LOG=debug` and `--debug-file` cause grok to log the bearer API token in
 * plaintext. Never enable them. This is a hard refusal, not a warning.
 */
const FORBIDDEN_ENV = ["RUST_LOG", "GROK_DEBUG_FILE"] as const;

/**
 * ISSUE #242 (2026-08-09, measured not inferred): deepseek-* models are TEXT-ONLY. Every model id
 * the grok CLI exposes that starts with `deepseek` (flash, pro, pro-anthropic, deepseek,
 * pro-chat — all five probed against api.deepseek.com, plus via-moon which is a deepseek-backed
 * bridge) rejects any `messages[].content` array containing an `image_url` block with a hard
 * serde 400: "unknown variant `image_url`, expected `text`". The `Read` tool SUCCEEDS in loading
 * a PNG into the transcript as an image_url block, and the NEXT API call — the turn after the
 * read — is rejected wholesale: exit 1, no sessionId, no work, tokens already paid. Measured:
 * 113,449 input tokens burned for zero turns of work.
 *
 * The fence (chosen option, recorded): DENY the Read tool on image/video extensions for
 * text-only models, mechanically, in the dispatch path. Rejected alternatives:
 *  - refuse at brief time when proofs mention images — over-broad: a text-only worker CAN produce
 *    a PNG (captures are scripts); the producer/grader split ("the WORKER produces the artifact,
 *    the ORCHESTRATOR grades it") is exactly what cheap-tier capture work should be. A proof scan
 *    also misses the natural "look at what I just produced" read, which is the case that crashed.
 *  - auto-route such briefs to a vision model — silently changes tiering/cost, and routing
 *    judgment already lives in the spawn-spec path (requiresMultimodalReasoning -> grok-4-fast).
 * The deny fires for EVERY text-only dispatch regardless of prompt/proof content, converting the
 * fatal crash into a survivable "denied by a permission policy" read the worker can report past.
 */
const TEXT_ONLY_MODEL_PREFIXES = ["deepseek"] as const;

/** Raster + video containers the Read tool can embed into the transcript as image_url. */
const VISION_DENY_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".avif", ".tiff", ".tif", ".ico", ".webm", ".mp4",
] as const;

/** True when a model id can be assumed text-only (vision would hard-crash the API call). */
export function isTextOnlyModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return TEXT_ONLY_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Deny rules that stop a text-only worker from ever embedding an image into its transcript.
 * One rule per extension: the grok CLI `--deny` grammar is `Tool(glob)` with glob patterns, and
 * `Read(...)` is a documented rule kind. A leading double-star glob matches both relative and
 * absolute paths.
 */
export function buildTextOnlyVisionDenies(): string[] {
  return VISION_DENY_EXTENSIONS.map((ext) => `Read(**/*${ext})`);
}

/**
 * Prompt block appended to text-only dispatches so a denied Read is understood, not puzzled over.
 * The deny is the binding mechanism; this is comprehension only (prose does not bind — #242).
 */
export function buildTextOnlyVisionPromptAppendix(model: string): string {
  return [
    "",
    "=== TEXT-ONLY MODEL (no vision) ===",
    `You are running on ${model}, a text-only model. Reading an image or video file is DENIED for you `,
    "by permission policy — this is enforced, not advisory: the Read tool embeds the file into the",
    "transcript as an image_url block and the API rejects the whole request with a hard 400, killing",
    "the dispatch. Do not try to Read images/screenshots/video. If the task requires looking at a",
    "rendered artifact, say in your report exactly what you need to see and why; the orchestrator",
    "grades captures.",
    "=== END TEXT-ONLY MODEL ===",
  ].join("\n");
}

/** Where session ids survive the orchestrator process that created them. */
const LEDGER = ".openclinxr/openclaw/worker-sessions.jsonl";
/** Durable record of every breaker refusal — a silent gate cannot be audited. */
const BREAKER_EVENTS = ".openclinxr/openclaw/breaker-events.jsonl";

type DispatchOptions = {
  prompt: string;
  slice?: string;
  role?: string;
  model?: string;
  /**
   * ISSUE #461: the ONLY sanction for running a role below its policy tier. A role whose policy
   * names a higher model (e.g. standard_execution -> deepseek-v4-pro) with an explicit lower
   * model and no reason FAILS CLOSED — a warning is what five consecutive write slices did not
   * notice. fast_bounded / expert_review map to flash BY POLICY and never need this.
   */
  modelDowngradeReason?: string;
  /**
   * The ONLY way past the retry circuit breaker, and it must carry a reason.
   *
   * MEASURED: success-reset alone is CIRCULAR. On issue-341 the breaker refuses the dispatch at
   * 12:52 one millisecond before it runs, and that dispatch went on to PASS its proofs. The gate
   * blocks the recovery, so the pass that would reset it can never be recorded:
   *
   *     breaker must permit recovery -> recovery PASS resets breaker
   *     breaker refuses recovery     -> PASS can never be recorded
   *
   * A reasoned override is the only escape. It is recorded, not silent.
   */
  retryBreakerOverrideReason?: string;
  resume?: string;
  maxTurns?: number;
  /**
   * Starting directory only — NOT an isolation boundary.
   *
   * INCIDENT: a worker dispatched with `--cwd <worktree>` wrote its edits into the MAIN checkout
   * (the worktree stayed clean). Git-root resolution and the repo path named in the prompt both
   * win over `--cwd`. Consequences: serialize file-writing workers, because two concurrent writers
   * WILL collide in one tree; and for genuine isolation use `spawn_subagent isolation="worktree"`.
   */
  cwd?: string;
  streaming?: boolean;
  /**
   * Bind this worker to its own git worktree, so N writers can run concurrently.
   *
   * Pass an absolute worktree path, or `true` to have one created under WORKTREE_ROOT.
   * When set, dispatch adds a path-scoped DENY on the main checkout — see
   * {@link buildWorktreeIsolationDenies}. The worktree MUST live outside the main tree or the
   * deny would block the worker's own files.
   */
  worktree?: string | true;
  /** Branch for an auto-created worktree. Defaults to a name derived from the slice. */
  branch?: string;
  /**
   * INCIDENT (layer-3): a worktree-bound dispatch with no machine-checkable tree proofs is an
   * uncheckable contract — the worker's report is not evidence. Extra proofs layered on top of
   * (or instead of, when synthesizing) the trusted brief's done_when tree proofs.
   */
  proofs?: string[];
  /**
   * INCIDENT (layer-3): the ONLY way past an empty tree-proof set on a worktree-bound dispatch.
   * Must be paired with a non-empty contractReason so unproofed dispatches are visible, not silent.
   */
  contract?: "none";
  /** Required when contract is "none". Recorded on the ledger entry. */
  contractReason?: string;
  /**
   * INCIDENT (#48 / #41): paths the ORCHESTRATOR will dirty in main while this worker runs.
   * Concurrent-lane rules require orchestrator writes during the dispatch window; those must not
   * be reported as worker isolation leaks. Attribution is by declared set, not by presence —
   * undeclared main dirt still fails the leak detector (the --deny is only a literal-path matcher).
   */
  orchestratorPaths?: readonly string[];
  /**
   * #66: repo-relative asset paths to copy from main into the worker worktree (ignored GLBs,
   * cagematch lanes, etc.). Merged with trusted brief `assetPaths`. Only declared paths are
   * provisioned — whole-root copy is rejected on cost (see worktree-asset-provisioning.ts).
   */
  assetPaths?: readonly string[];
  /**
   * ISSUE #439: the session id the worker's NEW session is created with (`-s`). Chosen by the
   * caller BEFORE the process exists — never scraped from the child's output — so a dispatch
   * that dies before `end` still has a name. `buildArgv` generates one when this is omitted.
   * Never set on a resume: `-s` CREATES, and passing it beside `--resume` would silently fork a
   * second session and lose the transcript being resumed for.
   */
  sessionId?: string;
  /**
   * ISSUE #437: directory for the prompt file written by buildArgv (the prompt is passed via
   * `--prompt-file`, never as the value of `-p`). dispatch() supplies the trusted slice dir;
   * callers of buildArgv that omit it fall back to a scratch dir under ~/.grok.
   */
  promptFileDir?: string;
  /**
   * ISSUE #246: explicit orchestrator acknowledgment that the dispatch proofs are the INTENDED
   * replacement for the stored brief's done_when. Without it, a dispatch whose proofs differ from
   * the trusted brief is REFUSED (TrustedBriefDivergenceError). With it, the trusted brief's
   * done_when is rewritten to the dispatch proofs so the merge-time contract-verify gate binds the
   * corrected contract. This is the ONLY sanctioned way to change a trusted brief — an automatic
   * overwrite would let an accidentally-weak proof set silently replace a strict contract.
   */
  refreshTrustedBrief?: boolean;
  /**
   * PRODUCT-LANE GATE (2026-08-22): declare this dispatch targets a RELEASE lane (apps/,
   * packages/, asset-pipeline, factory). Product dispatches are never refused by
   * assertProductLaneNotStarved; non-product dispatches are refused once the product clock has
   * expired. Declaring product on a dispatch that lands no product bytes is visible at land —
   * the clock simply keeps running.
   */
  product?: boolean;
};

export type DispatchLedgerEntry = {
  sessionId: string;
  slice?: string;
  role?: string;
  model: string;
  turns?: number;
  stopReason?: string;
  /**
   * Whether the worktree is actually integrable. `phase: "completed"` means the worker RAN;
   * issue-620 proved that is not the same fact — its final row was completed + cancelled +
   * proofsOk:true with four uncommitted files. Monitors should read THIS, not infer readiness.
   */
  handoff?: "ready_to_integrate" | "needs_resume" | "unknown";
  handoffDirtyFiles?: number;
  handoffAheadCommits?: number;
  handoffDetail?: string;
  resumedFrom?: string;
  /** Set when the worker was bound to its own worktree (concurrent-writer safe). */
  worktree?: string;
  at: string;
  /**
   * ISSUE #440: which write this line is. A fresh dispatch writes an early "spawned" line BEFORE
   * the child exists — so a dispatch that dies before returning still has a name in the ledger —
   * then re-appends the post-exit "completed" line with turns/stopReason/proofs. The last line
   * for a slice is the authoritative one. Readers that consume EVERY line (delegation-scorecard)
   * must skip "spawned". Absent on entries written before this field existed.
   *
   * ISSUE #563: "died" is the terminal line for a fresh dispatch whose child exited WITHOUT an
   * end event (arg-parse abort, crash, kill, provider auth/billing failure). It carries the
   * resumable session id (#439) but is NOT a completion: factory-pulse and campaign-track select
   * `phase === "completed"`, and a dead row there scored provider failures as throughput.
   */
  phase?: "spawned" | "completed" | "died";
  /** Death classification — present only on `died` rows. See death-reason.ts for why `phase` alone
   *  is not a measurable signal, and why a provider breaker must key on `deathCountsAgainstModel`. */
  deathClass?: string;
  deathRetryability?: string;
  deathCountsAgainstModel?: boolean;
  deathEvidence?: string;
  exitCode?: number;
  /**
   * INCIDENT (layer-3): after exit, orchestrator re-ran tree proofs against the worktree.
   * Absent means this entry predates contract wiring or contract was explicitly "none".
   */
  proofsOk?: boolean;
  proofs?: DoneWhenCheck[];
  contractSource?: "brief" | "brief+dispatch" | "brief-refreshed" | "synthesized" | "none";
  contractReportPath?: string;
  /** Present when an unproofed dispatch was explicitly opted out of the tier gate. */
  contractReason?: string;
  /**
   * Issue #396: proof targets flagged at dispatch start because merge-kill would refuse them at
   * land (gitignored + untracked in HEAD, not covered by the brief's opt-out). Recorded so the
   * flag is queryable after the run, not only visible in dispatch's console banner.
   */
  gitignoredProofTargetsWarned?: string[];
};

/**
 * INCIDENT (layer-3): a worker that skips a required proof must FAIL MECHANICALLY. Throwing after
 * the ledger write means durability of sessionId wins over loudness — a lost sessionId is
 * unresumable; a failed proof is still visible on the ledger + contract-verify JSON.
 */
export class ContractProofsFailedError extends Error {
  override readonly name = "ContractProofsFailedError";
  readonly checks: DoneWhenCheck[];

  constructor(sliceId: string, checks: DoneWhenCheck[]) {
    const failed = checks.filter((c) => !c.passed);
    const lines = failed.map((c) => `  - ${c.rule}: ${c.detail}`).join("\n");
    super(
      `Contract proofs failed for slice '${sliceId}' (${failed.length}/${checks.length} failed):\n${lines}`,
    );
    this.checks = checks;
  }
}

/**
 * ISSUE #246 (2026-08-09, measured): a corrected issue body does not refresh the trusted brief,
 * so the merge-time contract gate verifies against a superseded done_when.
 *
 * Sequence: first dispatch synthesizes `.openclinxr/slices/<id>/brief.json` from that moment's
 * proofs (written once). The orchestrator then corrects the issue's `## done_when` and
 * re-dispatches with the new proofs. `assembleDispatchContract` MERGES the new proofs with the
 * stored ones, so dispatch evaluates the union — while `contract-verify-cli` reads ONLY the
 * stored brief and evaluates the OLD rules. Measured on #241: dispatch evaluated 4 rules
 * (including a superseded `exists:.openclinxr/evidence/issue-241/pre-fix.json`), the merge gate
 * evaluated 2. `contract-verify` printed "RESULT: all tree proofs passed"; the rule count was the
 * only tell.
 *
 * FIX CHOICE (implementer's, recorded per the issue): REFUSE by default, refresh on explicit
 * opt-in. The stored brief is the anti-weakening plane — written once so a worker cannot change
 * the contract it is graded against (workers cannot write the shared coordination root). An
 * automatic overwrite would let any dispatch-time proof set replace a strict contract silently,
 * including an accidentally-weak one. A refusal preserves that property and makes the divergence
 * LOUD: the orchestrator must pass `refreshTrustedBrief: true` to acknowledge a deliberate
 * correction, which rewrites the trusted done_when to the corrected set so the merge gate binds it.
 */
export class TrustedBriefDivergenceError extends Error {
  override readonly name = "TrustedBriefDivergenceError";
  readonly sliceId: string;
  readonly storedTreeRules: readonly string[];
  readonly dispatchTreeRules: readonly string[];

  constructor(input: {
    sliceId: string;
    storedTreeRules: readonly string[];
    dispatchTreeRules: readonly string[];
  }) {
    const { sliceId, storedTreeRules, dispatchTreeRules } = input;
    super(
      `Dispatch proofs for slice '${sliceId}' differ from the trusted brief's done_when, and the `
      + `trusted brief is written once and is NOT auto-refreshed (anti-weakening: a worker must not `
      + `be able to change the contract it is graded against). contract-verify-cli would verify the `
      + `STORED rules (${storedTreeRules.length}) while dispatch would evaluate the new set `
      + `(${dispatchTreeRules.length}) — the issue #246 divergence. `
      + `If the issue's done_when was deliberately corrected, refresh the trusted brief explicitly: `
      + `pass refreshTrustedBrief: true to dispatch() (orchestrator-only; rewrites the corrected `
      + `done_when into the trusted plane so the merge-time gate verifies it).`,
    );
    this.sliceId = sliceId;
    this.storedTreeRules = storedTreeRules;
    this.dispatchTreeRules = dispatchTreeRules;
  }
}

export type TrustedBrief = {
  id?: string;
  done_when?: string[];
  /**
   * #66: repo-relative paths the slice needs from main (often gitignored). Prepared into the
   * worker worktree by {@link prepareWorktreeForWorker} → provisionWorktreeAssets.
   */
  assetPaths?: string[];
  /**
   * #217 opt-out: `exists:` / `min-bytes:` proof targets that are DELIBERATELY gitignored and
   * machine-local (capture trees, provider caches). merge-kill refuses a gitignored, untracked
   * proof target at integrate UNLESS it is listed here — so "this artifact is deliberately
   * untracked and the proof is machine-local" becomes a stated decision, not an accident.
   */
  gitignoredProofTargetsAllowed?: string[];
  synthesized?: boolean;
  [key: string]: unknown;
};

export type AssembledContract = {
  treeProofs: string[];
  contractSource: "brief" | "brief+dispatch" | "brief-refreshed" | "synthesized" | "none";
  trustedSliceDir: string;
  brief: TrustedBrief | null;
  contractReason?: string;
};

/**
 * INCIDENT (layer-3 / H2): brief + baseline live in the SHARED coordination root (main checkout
 * .openclinxr). Worktree-bound workers are denied Write/Edit on main, so they cannot forge the
 * contract. NEVER load brief/baseline from the worktree's own .openclinxr.
 */
export function trustedSliceDir(repoRoot: string, sliceId: string): string {
  return resolveSharedCoordinationPath(join(".openclinxr", "slices", sliceId), repoRoot);
}

export function loadTrustedBrief(trustedDir: string): TrustedBrief | null {
  const briefPath = join(trustedDir, "brief.json");
  if (!existsSync(briefPath)) return null;
  try {
    return JSON.parse(readFileSync(briefPath, "utf8")) as TrustedBrief;
  } catch {
    return null;
  }
}

/**
 * Assemble tree proofs from the trusted brief and optional dispatch-time proofs.
 * Synthesizes a minimal trusted brief when only dispatch proofs exist (no ceremony required).
 */
export function assembleDispatchContract(input: {
  repoRoot: string;
  sliceId: string;
  dispatchProofs?: string[];
  contract?: "none";
  contractReason?: string;
  refreshTrustedBrief?: boolean;
}): AssembledContract {
  const trustedDir = trustedSliceDir(input.repoRoot, input.sliceId);
  mkdirSync(trustedDir, { recursive: true });

  if (input.contract === "none") {
    return {
      treeProofs: [],
      contractSource: "none",
      trustedSliceDir: trustedDir,
      brief: loadTrustedBrief(trustedDir),
      ...(input.contractReason ? { contractReason: input.contractReason } : {}),
    };
  }

  let brief = loadTrustedBrief(trustedDir);
  const briefRules = Array.isArray(brief?.done_when) ? brief!.done_when! : [];
  const briefTree = partitionDoneWhen(briefRules).treeProofs;
  const dispatchTree = partitionDoneWhen(input.dispatchProofs ?? []).treeProofs;

  if (!brief && dispatchTree.length > 0) {
    // INCIDENT (layer-3): no brief but proofs were supplied at dispatch — synthesize a minimal
    // trusted brief so the trusted plane stays authoritative without ceremony.
    brief = {
      schemaVersion: "openclinxr.slice-brief.v1",
      id: input.sliceId,
      goal: `synthesized contract for dispatch of ${input.sliceId}`,
      q_gate: "Q5",
      autonomy: "worker",
      roles: {},
      done_when: dispatchTree,
      synthesized: true,
    };
    writeFileSync(join(trustedDir, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`);
    return {
      treeProofs: dispatchTree,
      contractSource: "synthesized",
      trustedSliceDir: trustedDir,
      brief,
    };
  }

  // ISSUE #246: a dispatch whose proofs differ from the stored brief's done_when must REFUSE or
  // explicitly REFRESH — never silently merge, or the merge-time contract-verify gate keeps
  // evaluating the superseded set while dispatch evaluates the union. Compare TREE rules as sets
  // (order changes are not a divergence; rule set changes are).
  if (brief && Array.isArray(input.dispatchProofs) && input.dispatchProofs.length > 0) {
    const storedSorted = [...briefTree].sort();
    const dispatchSorted = [...dispatchTree].sort();
    const diverged =
      storedSorted.length !== dispatchSorted.length
      || storedSorted.some((rule, index) => rule !== dispatchSorted[index]);
    if (diverged) {
      if (!input.refreshTrustedBrief) {
        throw new TrustedBriefDivergenceError({
          sliceId: input.sliceId,
          storedTreeRules: briefTree,
          dispatchTreeRules: dispatchTree,
        });
      }
      // Explicit orchestrator acknowledgment: the corrected done_when replaces the stored one, so
      // contract-verify-cli binds the corrected set at merge time. This is the ONLY sanctioned
      // way to change a trusted brief — an automatic overwrite would let an accidentally-weak
      // proof set silently replace a strict contract.
      brief = {
        ...brief!,
        done_when: [...input.dispatchProofs],
        refreshed: true,
        refreshedAt: new Date().toISOString(),
      };
      writeFileSync(join(trustedDir, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`);
      return {
        treeProofs: dispatchTree,
        contractSource: "brief-refreshed",
        trustedSliceDir: trustedDir,
        brief,
      };
    }
  }

  const treeProofs = [...briefTree, ...dispatchTree.filter((r) => !briefTree.includes(r))];
  let contractSource: AssembledContract["contractSource"];
  if (briefTree.length > 0 && dispatchTree.length > 0) contractSource = "brief+dispatch";
  else if (briefTree.length > 0) contractSource = "brief";
  else if (dispatchTree.length > 0) contractSource = "synthesized";
  else contractSource = "none";

  return {
    treeProofs,
    contractSource,
    trustedSliceDir: trustedDir,
    brief,
  };
}

/**
 * INCIDENT (layer-3): worktree-bound dispatch with EMPTY tree proofs is uncheckable. The worker
 * can claim anything; nothing mechanical re-runs. The only escape is contract:"none" WITH a
 * non-empty reason recorded on the ledger so silence is impossible.
 */
export function assertWorktreeContractGate(input: {
  worktreeBound: boolean;
  treeProofs: string[];
  sliceId: string;
  contract?: "none";
  contractReason?: string;
}): void {
  if (!input.worktreeBound) return;

  if (input.contract === "none") {
    if (!input.contractReason || input.contractReason.trim().length === 0) {
      throw new Error(
        `Worktree-bound dispatch for slice '${input.sliceId}' set contract:"none" but contractReason is empty. `
        + `An unproofed dispatch must record WHY so it is visible on the ledger, not silent.`,
      );
    }
    return;
  }

  if (input.treeProofs.length === 0) {
    throw new Error(
      `Worktree-bound dispatch for slice '${input.sliceId}' has no machine-checkable tree proofs `
      + `(exists:|min-bytes:|run:|changed:). The contract is uncheckable — worker report is not evidence. `
      + `Add done_when tree proofs to the trusted brief, pass options.proofs, or set contract:"none" `
      + `with a non-empty contractReason.`,
    );
  }
}

/** Prompt block stating plainly: orchestrator re-runs these; your report is not evidence. */
export function buildContractPromptAppendix(treeProofs: string[]): string {
  if (treeProofs.length === 0) return "";
  return [
    "",
    "=== CONTRACT PROOFS (orchestrator-enforced) ===",
    "After you exit, the orchestrator re-runs these tree proofs against YOUR worktree.",
    "Your report text is NOT evidence. Skipping a proof fails the dispatch mechanically.",
    "Rules:",
    ...treeProofs.map((r) => `  - ${r}`),
    "=== END CONTRACT PROOFS ===",
  ].join("\n");
}

/**
 * #435: `role:` was a label reaching only the ledger — nothing in the dispatched prompt bound the
 * role's charter. Compose the PROVEN baker output (buildRepoAgentSpawnPrompt) into the worker
 * prompt so every dispatch runs with its role's Persona, memory, and escalation contract.
 *
 * roleDir is RESOLVED from disk (agents/<group>/<role> requiring charter.md, memory.md,
 * index.json — the grok-agent-cli.ts discovery shape), never hardcoded. Unknown roles return ""
 * so a bad role id cannot break dispatch. The baker is CALLED, not copied: re-authoring the
 * Persona text here would fork the role contract into a second drifting copy (D1).
 */
/**
 * RE-ENABLED 2026-08-19 behind `--prompt-file` (issue #437). The revert record follows verbatim —
 * it is the measured evidence for WHY the prompt moved off argv.
 *
 * REVERTED FROM THE DISPATCH PATH 2026-08-19 — the function is fine, composing it was not.
 *
 * MEASURED, by bisect: with `buildRoleCharterAppendix(options.role, repoRoot)` composed into the
 * dispatched prompt, `dispatch()` HANGS after "REUSING managed worktree ... Resetting" and **never
 * exec's grok** — polled 60s, zero child processes, process still alive at 90s. With that single
 * line disabled and nothing else changed, a grok child spawns in **6 seconds**.
 *
 * Three dispatches died this way (#436 x2, one instrumented probe) and there were **zero** worker
 * merges between b39f7633 and this revert. The last successful dispatch (#435, 70 turns) ran on the
 * PRE-join dispatcher.
 *
 * The function itself is not the fault and is left exported and tested: called directly it returns
 * 2,596-4,362 chars for all five dispatch roles, binds Persona/charter.md/memory.md/UNABLE:, and
 * degrades to "" for an unknown role without throwing — including with a worktree passed as
 * repoRoot. **Isolation proved the function; only the full path proved the hang.** That gap is the
 * lesson: a unit probe of a composer says nothing about the spawn that consumes its output.
 *
 * CAUSE NOW IDENTIFIED (issue #437, 2026-08-19): the trigger is the prompt travelling as the value
 * of `-p`. Flag-looking tokens inside the composed appendix (`--output-logs`, `--filter` — the
 * only two in the whole appendix, both inside chars 400-800) reached grok's OWN argument scan; a
 * bisect showed 2,843 chars of padding spawns while a 1,421-char appendix does not, metacharacters
 * and newlines ruled out. `dispatch()` now writes the prompt to a file and passes `--prompt-file`
 * (a documented first-class headless entry point), and compose is re-enabled behind it.
 */
export function buildRoleCharterAppendix(roleId: string, repoRoot?: string): string {
  if (!roleId || roleId.trim().length === 0) return "";
  const root = repoRoot ?? defaultRepoRoot();
  const roleDir = resolveRoleDir(root, roleId);
  const policy = getRepoRoleHarnessPolicy(roleId);
  if (!roleDir || !policy) return "";
  const baked = buildRepoAgentSpawnPrompt({ roleId, roleDir, policy });
  return [
    "",
    "=== ROLE CHARTER (orchestrator-injected) ===",
    baked,
    "=== END ROLE CHARTER ===",
  ].join("\n");
}

/**
 * ISSUE #448 — a dispatch without a REAL role is refused, never defaulted.
 *
 * Seven dispatches (#441-#447) passed role=None and every worker got no charter and no status
 * reporting directive — they were mute by construction. A missing role, or a role that composes
 * an EMPTY appendix (no charter directory or no harness policy), FAILS CLOSED before worktree
 * creation and before any spawn, exactly like assertLoopNotPaused. A present-but-meaningless role
 * would compose a charter for the wrong agent, which is the same hole wearing a label.
 *
 * buildRoleCharterAppendix keeps its degrade-to-empty behaviour for the composed-prompt contract
 * (the-worker-is-told-to-report-on-its-own-card clause 3); this assert is the hard gate on top.
 */
export function assertDispatchRole(roleId: string | undefined, repoRoot: string): void {
  if (!roleId || roleId.trim().length === 0) {
    throw new Error(
      `dispatch: role is required. Seven dispatches (#441-#447) passed no role and their workers `
      + `got no charter and no status-reporting directive — a worker without a role cannot report `
      + `on its own card. Pass the agents/** role id (e.g. "openclaw-drift-police", "xr-systems-architect").`,
    );
  }
  if (buildRoleCharterAppendix(roleId, repoRoot) === "") {
    throw new Error(
      `dispatch: role "${roleId}" is not a dispatchable repo role (no agents/<group>/<roleId> with `
      + `charter.md + memory.md + index.json, or no harness policy). A present-but-meaningless role `
      + `composes a charter for the wrong agent — FAIL CLOSED, never default.`,
    );
  }
}

let moduleRepoRoot: string | undefined;

/** Module location determines the default repo root when callers do not pass one. */
function defaultRepoRoot(): string {
  if (!moduleRepoRoot) {
    moduleRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  }
  return moduleRepoRoot;
}

/** Resolve agents/<group>/<roleId> from disk, requiring charter.md + memory.md + index.json. */
function resolveRoleDir(repoRoot: string, roleId: string): string | null {
  const agentsDir = join(repoRoot, "agents");
  if (!existsSync(agentsDir)) return null;
  for (const group of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    let roleEntries: Dirent[];
    try {
      roleEntries = readdirSync(join(agentsDir, group.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const role of roleEntries) {
      if (!role.isDirectory() || role.name !== roleId) continue;
      const roleDir = join("agents", group.name, role.name);
      const required = ["charter.md", "memory.md", "index.json"];
      if (required.every((file) => existsSync(join(repoRoot, roleDir, file)))) {
        return roleDir;
      }
    }
  }
  return null;
}

/**
 * INCIDENT (2026-08-05): dispatched as `grok -p --resume <id> "<prompt>"`. `-p` is short for
 * `--single` and takes the PROMPT as its value, so `--resume` was swallowed as the prompt and the
 * run aborted with "a value is required for '--single <PROMPT>'". The wrapper shell still exited
 * 0 (the trailing echo), so it LOOKED like a completed worker that had simply done nothing.
 *
 * Correct order is always: `--prompt-file <path>` FIRST, then every other flag.
 *
 * ISSUE #437 (2026-08-19, measured by bisect): the prompt is NO LONGER an argv element at all.
 * Composing the role charter into the `-p` value hung dispatch FIVE times — no grok child, no
 * exception, process alive past 90 s. The trigger is flag-looking tokens inside the prompt text
 * (`--output-logs`, `--filter` in the composed appendix) reaching grok's OWN argument scan. The
 * prompt is written to a file and passed via `--prompt-file` (a documented first-class headless
 * entry point), which removes the whole class; escaping the two known tokens would re-arm on the
 * next brief that names a CLI flag, and briefs here routinely do.
 */
/** Scratch location for prompt files when the caller did not supply a promptFileDir. */
const DEFAULT_PROMPT_FILE_DIR = join(homedir(), ".grok", "dispatch-prompts");

/**
 * ISSUE #461 — dispatch ignored the role registry and silently ran every write role on flash.
 *
 * Five consecutive write slices dispatched xr-systems-architect (standard_execution -> pro) and
 * every one ran flash: the model was defaulted at five sites (`--model` in buildArgv, the ledger,
 * and the three vision-appendix sites) with no reference to the role. role-harness-policy.ts
 * already maps tier -> grok model; this is the ONE resolver, called from all five sites.
 *
 * A downgrade is a RANK, not "flash is wrong": fast_bounded and expert_review map to flash BY
 * POLICY, so flash on those roles needs no reason. The refusal is a role whose policy names a
 * HIGHER tier being run on a lower one, without a stated modelDowngradeReason — a warning is what
 * five slices ignored. The roleless path stays flash-first (dispatch-worker.test.ts:132 pins it).
 */
const MODEL_RANK = new Map<string, number>([
  ["deepseek-v4-flash", 0],
  ["deepseek-v4-pro", 1],
  ["grok-build", 2],
]);

export type ResolvedDispatchModel = {
  model: string;
  /** Policy tier of the bound role ("fast_bounded" | "standard_execution" | ...); undefined roleless. */
  tier: string | undefined;
};

export function resolveDispatchModel(
  options: Pick<DispatchOptions, "role" | "model" | "modelDowngradeReason">,
): ResolvedDispatchModel {
  const tier = options.role ? getRepoRoleHarnessPolicy(options.role)?.policyTier : undefined;
  const policyModel = tier ? resolveHarnessModelSpec(tier, "grok").model : undefined;
  if (options.model && policyModel && options.model !== policyModel) {
    const explicitRank = MODEL_RANK.get(options.model);
    const policyRank = MODEL_RANK.get(policyModel);
    if (
      explicitRank !== undefined && policyRank !== undefined
      && explicitRank < policyRank && !options.modelDowngradeReason
    ) {
      throw new Error(
        `dispatch: role "${options.role}" is ${tier} -> policy model ${policyModel}; explicit model `
        + `"${options.model}" is a DOWNGRADE with no modelDowngradeReason. Five consecutive write slices silently `
        + `ran flash because the default ignored the role. Name a reason, or drop the model argument and let `
        + `policy fill it.`,
      );
    }
  }
  return { model: options.model ?? policyModel ?? "deepseek-v4-flash", tier };
}

export function buildArgv(options: DispatchOptions): string[] {
  const argv = ["--prompt-file", writePromptFile(options)];
  if (options.resume) {
    // ISSUE #439: -s CREATES a new session; -r resumes. Using -s on a resume would silently fork
    // a SECOND session and lose the transcript we were resuming for (probed: the CLI refuses the
    // pair, but the refusal is not the point — the id must never be conflated). The resumed
    // session's id can only come from the child.
    argv.push("--resume", options.resume);
  } else {
    // ISSUE #439: choose the id BEFORE the process exists, so a child that dies before `end`
    // still has a name. randomUUID per dispatch (or the caller's pre-chosen id) — grok errors on
    // a duplicate UUID, so nothing is keyed on the slice id.
    argv.push("--session-id", options.sessionId ?? randomUUID());
  }
  // ISSUE #461: the model is a property of the role's policy — one resolver, called from all five
  // sites. The roleless path stays flash-first (dispatch-worker.test.ts:132 pins that).
  argv.push("--model", resolveDispatchModel(options).model);
  argv.push("--always-approve");
  // streaming-json emits a usage event per turn — the only way to see a stall while the worker is
  // still alive. Plain json yields aggregates only, i.e. you learn about the death afterwards.
  argv.push("--output-format", options.streaming ? "streaming-json" : "json");
  argv.push("--max-turns", String(options.maxTurns ?? DEFAULT_MAX_TURNS));
  if (options.cwd) argv.push("--cwd", options.cwd);
  return argv;
}

/** Write the FULL prompt to disk and return the path buildArgv passes to grok. */
function writePromptFile(options: DispatchOptions): string {
  const dir = options.promptFileDir ?? DEFAULT_PROMPT_FILE_DIR;
  mkdirSync(dir, { recursive: true });
  // ISSUE #461 (exposed by the proof suite): the unscoped scratch fallback shares one dir with
  // every other unscoped caller, and a fixed name let concurrent callers clobber each other's
  // prompt file mid-flight — the worker then executes the wrong prompt. A slice id names the
  // file (the trusted-slice exact-prompt record depends on that); scratch calls get a unique one.
  const path = join(dir, `prompt-${options.slice ?? randomUUID()}.md`);
  writeFileSync(path, options.prompt, "utf8");
  return path;
}

/** Worktrees live OUTSIDE the main checkout so the main-tree deny cannot block them. */
export const WORKTREE_ROOT = join(homedir(), ".grok", "worktrees", "src-openclinxr");

/**
 * The hard write boundary.
 *
 * PROVEN 2026-08-05 with a control/treatment pair: a worker given `--cwd <elsewhere>` and asked to
 * write an ABSOLUTE path under main created the file (control). The same prompt with these denies
 * produced "The write was denied by a permission policy" and no file (treatment).
 *
 * This is why isolation is enforced here rather than by prompt wording or a post-run dirty check:
 * a prompt directive is advisory, and a dirty check is detection AFTER the damage — with two
 * concurrent writers you cannot even attribute which file came from which worker. `--cwd` is not a
 * boundary either; it only sets the starting directory.
 */
export function buildWorktreeIsolationDenies(mainRoot: string): string[] {
  return [`Write(${mainRoot}/**)`, `Edit(${mainRoot}/**)`];
}



/**
 * Validate `proofs` before they reach rule evaluation.
 *
 * INCIDENT 2026-08-05: passing the shape from an earlier design —
 * `[{ id, description, kind: "command", run }]` — surfaced as
 * `TypeError: rule.startsWith is not a function` from deep inside the evaluator. The error named
 * neither the bad value nor the expected format, and cost four dispatch attempts to diagnose.
 * Proofs are done_when STRINGS. A confusing error for a plausible mistake is a missing test, not
 * user error — so this fails early and says exactly what was passed and what was wanted.
 */
export function assertProofShape(proofs: readonly string[]): void {
  for (const proof of proofs) {
    if (typeof proof !== "string") {
      throw new Error(
        `Proof must be a done_when string, got ${typeof proof}: ${JSON.stringify(proof)}. `
        + `Use e.g. "run:pnpm architecture" or "changed:path/to/evidence.md" — not an object. `
        + `Recognised prefixes: ${[...DONE_WHEN_RULE_VOCABULARY.prefixes, ...DONE_WHEN_RULE_VOCABULARY.exact].join(", ")}`,
      );
    }
    if (!isKnownDoneWhenRule(proof)) {
      throw new Error(
        `Proof "${proof}" has no recognised rule prefix, so nothing would evaluate it and the `
        + `contract would pass vacuously. Expected one of: ${[...DONE_WHEN_RULE_VOCABULARY.prefixes, ...DONE_WHEN_RULE_VOCABULARY.exact].join(", ")}`,
      );
    }
  }

  // Narrative rules (handoff:/skeptic:/handoffs:all-done) read the worker's OWN handoff JSON —
  // its account of itself, which is exactly what the contract exists not to trust. Only
  // exists:/min-bytes:/run:/changed: inspect the tree. Reuse the evaluator's partition rather than
  // re-deriving the split here; re-deriving a rule list is what drifted earlier today.
  if (proofs.length > 0) {
    const { treeProofs, narrative } = partitionDoneWhen([...proofs]);
    if (treeProofs.length === 0) {
      throw new Error(
        `All ${narrative.length} supplied proof(s) are NARRATIVE (${narrative.join(", ")}), which read `
        + `the worker's own handoff JSON rather than the tree — the worker's account of itself is not `
        + `evidence. A worktree-bound dispatch needs at least one TREE proof `
        + `(${DONE_WHEN_RULE_VOCABULARY.prefixes.filter((p) => p !== "handoff:" && p !== "skeptic:").join(", ")}). `
        + `Narrative rules are fine alongside one.`,
      );
    }
  }
}

export type ResolveWorkerWorktreeOptions = {
  /** Repo-relative assets to copy from main into the worktree (#66). */
  assetPaths?: readonly string[];
};

/**
 * Resolve (creating if needed) the worktree this worker is bound to.
 *
 * Returns the worktree path, which becomes both the worker's cwd and the repo root named in its
 * prompt. Never returns a path inside `mainRoot`.
 */
export function resolveWorkerWorktree(
  mainRoot: string,
  worktree: string | true,
  name: string,
  branch?: string,
  options?: ResolveWorkerWorktreeOptions,
): string {
  const prepareOpts = {
    repoRoot: mainRoot,
    ...(options?.assetPaths?.length ? { assetPaths: [...options.assetPaths] } : {}),
  };
  if (typeof worktree === "string") {
    if (worktree.startsWith(`${mainRoot}/`)) {
      throw new Error(
        `Worktree ${worktree} is INSIDE the main checkout. The isolation deny covers ${mainRoot}/** `
        + `and would block the worker's own edits. Place worktrees outside main (see WORKTREE_ROOT).`,
      );
    }
    // Pre-existing worktree path: prepare only when it is already on disk (unit tests pass
    // synthetic absolute paths that are not real checkouts).
    if (existsSync(worktree)) prepareWorktreeForWorker(worktree, prepareOpts);
    return worktree;
  }
  const target = join(WORKTREE_ROOT, name);
  const managedBranch = branch ?? `wt/${name}`;
  if (!existsSync(target)) {
    mkdirSync(WORKTREE_ROOT, { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", managedBranch, target], {
      cwd: mainRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    // #148: reuse without reset inherited previous-run commits + dirt (incl. work reverted on
    // main). Reset git state to main's tip and announce loudly; keep node_modules (#66).
    // Caller-supplied absolute paths above are NOT reset — synthetic unit-test paths.
    ensureWorktreeBaseFresh({
      worktreePath: target,
      mainRoot,
      branch: managedBranch,
      slice: name,
    });
  }
  // #47: git worktree add checks out tracked files only — node_modules is never present until
  // we prepare. Do this before any worker spawn so brief verify cannot cache-green a dead tree.
  // #66: also provision declared ignored assets (cagematch lanes, etc.) from main.
  prepareWorktreeForWorker(target, prepareOpts);
  return target;
}

/** Files the main checkout gained during a dispatch — belt-and-braces behind the deny. */
export function mainTreeDirtyPaths(mainRoot: string): string[] {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: mainRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3));
  } catch {
    return [];
  }
}

/**
 * HEAD sha of the main checkout at snapshot time — the leak-window anchor (#344).
 * Undefined when the sha cannot be read; the caller then filters nothing (fail closed).
 */
export function mainHeadSha(mainRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: mainRoot, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Repo-relative paths touched by commits made to the main checkout in (sinceSha, HEAD].
 *
 * #344: any such path is positive evidence of a second writer — a peer lane's direct commits or
 * another dispatch's `--no-ff` integrate (a merge commit, hence `-m --first-parent` to read the
 * first-parent diff). A worker that only writes files cannot forge this evidence. Empty on any
 * git error (unknown sha, rewritten history) — the caller then filters nothing, keeping the
 * detector strict.
 */
export function pathsTouchedByCommitsSince(mainRoot: string, sinceSha: string): string[] {
  try {
    const commits = execFileSync("git", ["rev-list", `${sinceSha}..HEAD`], {
      cwd: mainRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const touched = new Set<string>();
    for (const commit of commits) {
      const files = execFileSync(
        "git",
        ["diff-tree", "--first-parent", "-m", "--no-commit-id", "--name-only", "-r", commit],
        { cwd: mainRoot, encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
      for (const file of files) touched.add(file);
    }
    return [...touched];
  } catch {
    return [];
  }
}

/**
 * Attribute main-tree dirt to worker leak vs concurrent work by any other writer.
 *
 * INCIDENT (#48 / #41): snapshotted main dirty set at dispatch start, then treated ANY new dirt
 * as a worker leak. The orchestrator had created board-session-map.ts in main while the worker
 * ran (required by "dispatch both lanes BEFORE verifying either"). Correct worker work was
 * aborted; session never landed on the ledger.
 *
 * Mechanism (chosen deliberately): caller-declared `orchestratorPaths`. A worktree-bound worker's
 * legitimate writes land in its worktree; main dirt is either (a) orchestrator concurrent work —
 * declared here — or (b) a real deny escape. Trusting ALL main dirt would silence the detector;
 * the detector is the only watcher for computed-path escapes past the literal `--deny` matcher.
 *
 * INCIDENT (#344 / #665): the declared-set mechanism admits exactly TWO writers — the worker and
 * the orchestrator. A PEER AGENT LANE is neither, so its main writes fell through to "real deny
 * escape" by elimination and failed two healthy dispatches whose windows overlapped a peer
 * lane's (#344's equipment lane; #665's landmark commit `5fae7afd`). Commit evidence closes the
 * committed half: a commit made to main during the window is positive proof somebody else wrote
 * the path, cheap to obtain, and unforgeable by a worker that only writes files. Paths touched
 * by such commits arrive in `concurrentlyCommittedPaths` and are not attributed to the worker.
 * An UNCOMMITTED peer-lane write remains misattributed — no evidence distinguishes it from an
 * escape, and the detector stays strict rather than going blind.
 *
 * Returns paths in `after` that are newly dirty relative to `before`, not in orchestratorPaths,
 * and not touched by a concurrently-committed path.
 */
export function attributeIsolationLeak(input: {
  before: readonly string[];
  after: readonly string[];
  orchestratorPaths?: readonly string[];
  concurrentlyCommittedPaths?: readonly string[];
}): string[] {
  const beforeSet = new Set(input.before);
  const orchestratorSet = new Set(input.orchestratorPaths ?? []);
  const committedSet = new Set(input.concurrentlyCommittedPaths ?? []);
  return input.after.filter(
    (path) => !beforeSet.has(path) && !orchestratorSet.has(path) && !committedSet.has(path),
  );
}

/**
 * Injected command runner for {@link prepareWorktreeForWorker}.
 *
 * Contracts assert the build was *executed* (not that files appeared): a file-presence check
 * alone can be satisfied by `mkdir dist && touch index.js` without compiling anything.
 */
export type PrepareWorktreeCommandRunner = (command: string, args: readonly string[]) => void;

/**
 * Stable readiness marker for "workspace packages are built" (MADR 0033 build-emitting packages).
 * Listing every package's dist goes stale as the set changes; shared-schemas is a core leaf that
 * many resolve-entry failures named in the #54 experiment.
 */
export const WORKSPACE_DIST_MARKER = "packages/openclinxr/shared-schemas/dist/index.js";

export type PrepareWorktreeOptions = {
  run?: PrepareWorktreeCommandRunner;
  /**
   * #66: repo-relative asset paths to copy from {@link repoRoot} (main) into this worktree.
   * Only declared paths are provisioned. Empty/undefined = no asset copy (tracked files only).
   */
  assetPaths?: readonly string[];
  /** Source of declared assets; defaults to process.cwd() inside the provisioner. */
  repoRoot?: string;
};

/**
 * Prepare a freshly created (or bare) worktree so the worker can run brief verify without
 * discovering a missing node_modules mid-session — and without failing to resolve workspace
 * package entry points because `dist/` was never built.
 *
 * INCIDENT (#47): 3/3 retro'd workers burned opening turns on absent node_modules; #37 got a
 * cache-green `pnpm architecture` on a tree that could not build — which reads as a pass.
 *
 * INCIDENT (#54): `pnpm install` alone is not enough. Workspace packages are build-emitting
 * (MADR 0033); their `exports` point at gitignored `dist/`. A bare worktree + install failed
 * 17 test files on "Failed to resolve entry for package @openclinxr/shared-schemas" (and peers);
 * `pnpm packages:build` then took the same tree to 138/0. Early-return on the vitest binary
 * alone left install-only trees "ready" forever — adding a build step without changing that
 * check would leave the bug fully reachable on exactly the trees that need it.
 *
 * INCIDENT (#66 / thrash): install+build still leave gitignored inputs (cagematch, local
 * `.openclinxr` evidence) absent. Workers spent ~30–40 turns re-copying by hand. Declared
 * `assetPaths` are provisioned here so a real dispatch uses the provisioner (not documentation).
 *
 * Mechanism:
 * 1. `pnpm install --prefer-offline --frozen-lockfile` when vitest is missing.
 * 2. `pnpm packages:build` when the workspace dist marker is missing (always after a fresh
 *    install; also when vitest exists but dist does not).
 * 3. `provisionWorktreeAssets` for brief/dispatch-declared paths (copy/clone, never symlink).
 * Content-addressable store + shared `TURBO_CACHE_DIR` make install/build mostly linking/restore.
 *
 * Rejected: copy/symlink dist from main (stale SHA / isolation theater); build only
 * brief-touched packages (transitive resolve failures); symlink or whole-root asset copy (#66).
 *
 * No HEAD stamp to skip rebuild: optional; skip until cold-cache cost is measured.
 *
 * No-ops install/build (returns method:"existing") only when BOTH vitest and workspace dist are
 * present — asset provisioning still runs when assetPaths are declared.
 */
export function prepareWorktreeForWorker(
  worktreePath: string,
  options?: PrepareWorktreeOptions,
): {
  method: "existing" | "install" | "build";
  nodeModulesPath: string;
  provisioned?: { path: string; bytes: number }[];
} {
  if (!existsSync(worktreePath)) {
    throw new Error(`prepareWorktreeForWorker: path does not exist: ${worktreePath}`);
  }
  const nodeModulesPath = join(worktreePath, "node_modules");
  // vitest is a root devDependency every brief verify path needs; its presence is a better
  // readiness signal than "directory exists" (half-deleted trees still have the folder).
  const readinessMarker = join(nodeModulesPath, ".bin", "vitest");
  const distMarker = join(worktreePath, WORKSPACE_DIST_MARKER);

  const run: PrepareWorktreeCommandRunner =
    options?.run
    ?? ((command, args) => {
      execFileSync(command, [...args], {
        cwd: worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    });

  let method: "existing" | "install" | "build" = "existing";

  // #54: ready only when install AND workspace package dist are present. Vitest alone is not enough.
  if (!(existsSync(readinessMarker) && existsSync(distMarker))) {
    method = "build";

    if (!existsSync(readinessMarker)) {
      run("pnpm", ["install", "--prefer-offline", "--frozen-lockfile"]);
      if (!existsSync(readinessMarker)) {
        throw new Error(
          `prepareWorktreeForWorker: pnpm install finished but ${readinessMarker} is missing. `
          + `Refusing to hand a non-buildable worktree to a worker (cache-green-then-force-red class, #37).`,
        );
      }
      method = "install";
    }

    if (!existsSync(distMarker)) {
      // Script name includes "build" so injected-run contracts can assert execution without
      // trusting file presence alone.
      run("pnpm", ["packages:build"]);
      if (method !== "install") method = "build";
    }

    if (!existsSync(distMarker)) {
      throw new Error(
        `prepareWorktreeForWorker: packages build finished but workspace dist is still missing `
        + `(expected ${distMarker}). Refusing to hand over a worktree that cannot resolve workspace `
        + `package entry points (#54).`,
      );
    }
  }

  // #66: provision declared assets even when install/build already existed. A provisioner that
  // only runs on cold trees would leave warm worktrees missing ignored inputs.
  let provisioned: { path: string; bytes: number }[] | undefined;
  if (options?.assetPaths && options.assetPaths.length > 0) {
    const report = provisionWorktreeAssetsSync({
      worktreePath,
      assetPaths: [...options.assetPaths],
      ...(options.repoRoot ? { repoRoot: options.repoRoot } : {}),
    });
    provisioned = report.provisioned;
  }

  return {
    method,
    nodeModulesPath,
    ...(provisioned ? { provisioned } : {}),
  };
}

export function assertSafeEnvironment(env: NodeJS.ProcessEnv): void {
  for (const key of FORBIDDEN_ENV) {
    if (env[key]) {
      throw new Error(
        `${key} is set. REFUSING TO DISPATCH: grok logs the bearer API token in plaintext under `
        + `debug logging. Unset it and re-run. This is a credential-leak guard, not a style rule.`,
      );
    }
  }
}

/** Preserve first-seen order; drop empty strings. */
function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * ISSUE #440: the identity fields both ledger lines for one dispatch share. The early ("spawned")
 * line and the post-exit ("completed") line must agree on these, or a reader cannot trust either
 * line's identity. Post-exit-only knowledge (turns, stopReason, proofs) is added by the caller.
 */
function ledgerIdentity(
  options: DispatchOptions,
  assembled: AssembledContract,
  worktreePath: string | undefined,
): Pick<
  DispatchLedgerEntry,
  "slice" | "role" | "model" | "resumedFrom" | "worktree" | "contractSource" | "contractReason"
> {
  return {
    ...(options.slice ? { slice: options.slice } : {}),
    ...(options.role ? { role: options.role } : {}),
    // ISSUE #461: the ledger records the model policy actually resolves — five consecutive write
    // slices dispatched xr-systems-architect (standard_execution -> pro) and the ledger said flash.
    model: resolveDispatchModel(options).model,
    ...(options.resume ? { resumedFrom: options.resume } : {}),
    ...(worktreePath ? { worktree: worktreePath } : {}),
    contractSource: assembled.contractSource,
    ...(assembled.contractReason ? { contractReason: assembled.contractReason } : {}),
  };
}

/**
 * Persist the session id where it outlives this process.
 *
 * INCIDENT: 41 session ids from one session existed only in the orchestrator's scratch files.
 * `--resume` survives process exit and recovers a worker that died at ~90% — but only if you
 * still have the id. Four workers were hand-salvaged because the id had been thrown away.
 */
export function recordSession(repoRoot: string, entry: DispatchLedgerEntry): string {
  // Shared across worktrees: an orchestrator in one worktree must be able to resume a worker
  // dispatched from another, otherwise the ledger only helps the process that already had the id.
  const path = resolveSharedCoordinationPath(LEDGER, repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  return path;
}

export function readSessions(repoRoot: string): DispatchLedgerEntry[] {
  const path = resolveSharedCoordinationPath(LEDGER, repoRoot);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DispatchLedgerEntry];
      } catch {
        return [];
      }
    });
}

/** Most recent session for a slice — the id you want when resuming a dead worker. */
export function latestSessionFor(repoRoot: string, slice: string): DispatchLedgerEntry | undefined {
  return readSessions(repoRoot)
    .filter((entry) => entry.slice === slice)
    .at(-1);
}

/**
 * INCIDENT (2026-08-05): the worker's answer is under `text`, NOT `result`. Reading `result` gave
 * `null` for every dispatch, which read as "the worker produced nothing" — while the worker had in
 * fact done the work and committed it. Three runs were misjudged before the tree was checked.
 * Corollary: verify the TREE, never the report field you assume exists.
 *
 * INCIDENT (#241, 2026-08-09): with `streaming: true`, `buildArgv` passes
 * `--output-format streaming-json`, which grok emits as NDJSON of FLAT ACP events — one JSON
 * object per line discriminated by a TOP-LEVEL `type` field — NOT the single JSON document that
 * `--output-format json` produces (top-level `text`/`sessionId`/`num_turns`/`stopReason`).
 * `JSON.parse` of the whole stream throws, parseResult returned {}, and dispatch() threw
 * "Dispatch produced no sessionId" AFTER the worker (issue-240) had completed and committed its
 * work (c1ea344e) — before recordSession and before the post-exit proof re-run, so no contract
 * report was written and integrate refused `contract-not-verified`, forcing manual
 * contract-verify-cli recovery.
 *
 * First fix 9dd8122c added a fallback reading `params.sessionId`, `params.update.stop_reason`,
 * `params.update.usage.numTurns` and `params.update.sessionUpdate === "agent_message_chunk"`.
 * It matched NOTHING: no `params` wrapper exists in this harness's output — the fix returned {}
 * by a longer route and issue #242 reproduced the same throw from a main containing it.
 *
 * MEASURED on captured real output (reproduced with
 * `grok -p "Reply with exactly: PROBE" --model deepseek-v4-flash --output-format streaming-json
 * --max-turns 2`; 6,989 bytes, 35 lines; tracked fixture
 * tools/openclinxr/openclaw/__fixtures__/streaming-json-sample.ndjson):
 *   - `{"type":"available_commands",...}` — tool list, ignore
 *   - `{"type":"thought","data":...}`        — reasoning, ignore
 *   - `{"type":"text","data":"..."}`         — assistant text chunks; concatenate `.data`
 *   - `{"type":"usage","usage":{...}}`       — token usage, carries NO numTurns
 *   - `{"type":"end","stopReason":"end_turn","sessionId":"...","num_turns":N,...}` — sessionId,
 *     stopReason and num_turns are TOP LEVEL on the `end` event.
 * The fallback reads exactly that measured shape. The plain-json branch above is unchanged.
 */
export function parseResult(raw: string): { sessionId?: string; turns?: number; stopReason?: string; text?: string } {
  // --output-format json: a single JSON document with top-level fields.
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const hasPlainShape =
        obj["sessionId"] !== undefined
        || obj["text"] !== undefined
        || obj["num_turns"] !== undefined
        || obj["stopReason"] !== undefined
        || obj["subtype"] !== undefined;
      if (hasPlainShape) {
        return {
          text: (obj["text"] ?? obj["result"]) as string | undefined,
          sessionId: obj["sessionId"] as string | undefined,
          turns: obj["num_turns"] as number | undefined,
          stopReason: (obj["stopReason"] ?? obj["subtype"]) as string | undefined,
        };
      }
    }
  } catch {
    // Not a single JSON document — fall through to the NDJSON scan.
  }

  // --output-format streaming-json: NDJSON of FLAT ACP events with a top-level `type` field.
  let sessionId: string | undefined;
  let turns: number | undefined;
  let stopReason: string | undefined;
  const textChunks: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // tolerate an unterminated final line from a chunk boundary
    }
    if (event["type"] === "end") {
      // Measured: sessionId, stopReason and num_turns ride the `end` event at TOP LEVEL.
      if (typeof event["sessionId"] === "string") {
        sessionId = event["sessionId"] as string;
      }
      if (typeof event["stopReason"] === "string") {
        stopReason = event["stopReason"] as string;
      }
      const turnsValue = event["num_turns"] ?? event["turns"];
      if (typeof turnsValue === "number") {
        turns = turnsValue;
      }
    } else if (event["type"] === "text") {
      // Measured: assistant text chunks carry the text in `.data` (concatenated across lines).
      if (typeof event["data"] === "string") {
        textChunks.push(event["data"] as string);
      }
    }
    // `thought`, `available_commands` and `usage` carry nothing dispatch needs.
  }
  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(turns !== undefined ? { turns } : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(textChunks.length > 0 ? { text: textChunks.join("") } : {}),
  };
}

/** Re-evaluate tree proofs against the worktree using the trusted baselineDir. */
export async function evaluateDispatchTreeProofs(input: {
  treeRoot: string;
  baselineDir: string;
  sliceId: string;
  treeProofs: string[];
}): Promise<DoneWhenCheck[]> {
  const options: DoneWhenEvalOptions = { baselineDir: input.baselineDir };
  const checks: DoneWhenCheck[] = [];
  for (const rule of input.treeProofs) {
    checks.push(await evaluateDoneWhenRule(input.treeRoot, rule, input.sliceId, {}, options));
  }
  return checks;
}

export async function dispatch(repoRoot: string, options: DispatchOptions): Promise<DispatchLedgerEntry> {
  assertSafeEnvironment(process.env);
  if (options.proofs) assertProofShape(options.proofs);

  /**
   * INCIDENT (layer-6): the delegation scorecard measured land rate, durability and ratchet debt
   * for weeks while being wired to NOTHING. A metric that cannot halt the machine it measures is
   * decoration — it reports the loop degrading and the loop keeps going.
   *
   * This is the halt. It is FIRST, before the worktree is created and before any spawn, so a
   * tripped loop costs zero worker tokens. The pause bit lives in the shared coordination root
   * precisely because the main-tree write-deny puts it out of a worktree-bound worker's reach:
   * the thing being halted cannot clear its own halt.
   */
  assertLoopNotPaused(repoRoot);

  /**
   * MEASURED 2026-08-24 over 1,156 ledger rows: two slices consumed 33 of 584 dispatch sessions and
   * produced nothing. `issue-436` was cancelled at ONE TURN twelve times, the second only fifteen
   * seconds after the first; `issue-341` hit a 150-turn ceiling seven times, the second 1.2 h after
   * the first. Together they hold 16 of 62 proof failures — a quarter of the factory's measured
   * failure is re-dispatching an unchanged slice into an unchanged wall.
   *
   * Placed with the pause check, BEFORE the worktree and the spawn, so a refusal costs zero tokens.
   * Refuses only an automatic repeat; the message names what to change instead.
   */
  assertNotRepeatingIntoTheSameWall(repoRoot, sliceId2(options), options.retryBreakerOverrideReason);

  // ISSUE #448: role is the worker's charter + status directive. A missing or unknown role
  // FAILS CLOSED here, before any worktree or brief is created — a refusal must cost nothing.
  const sliceId = options.slice ?? "unscoped";
  assertDispatchRole(options.role, repoRoot);

  // PRODUCT-LANE GATE (superagent ruling 2026-08-22): the 06:00Z..14:55Z window landed 40 commits
  // and ZERO on any product path — four slices on one capture-harness predicate, four on ledger
  // accounting, while 36 of 38 fixture actors have no phenotype and the materializer consumes
  // none of it. Evidence-only stretches are now BOUNDED mechanically: once PRODUCT_IDLE_LIMIT
  // consecutive commits land without touching a release lane, every non-product dispatch refuses
  // here, before any worktree or worker token. Escape is exactly one act: land product bytes.
  assertProductLaneNotStarved(repoRoot, { slice: sliceId, product: options.product === true });

  // PULSE FRESHNESS GATE (same ruling, second half): the hourly pulse fired through that window
  // but nothing consumed it, with a 4h05m hole because worker-heavy stretches suppress the
  // SessionStart hook. dispatch() self-heals a stale pulse by refreshing it (~10 s) and refuses
  // only on BROKEN measurement (refresh failed / DATA_STALE row), never on a bad verdict —
  // PRODUCING_NOTHING is data for the tick's NEEDS-DECISION record, not a halt.
  const pulseGate = assertPulseMeasurementAlive(repoRoot);
  if (pulseGate.refreshed) {
    console.log(`dispatch: pulse refreshed in-dispatch; verdict=${pulseGate.verdict ?? "none"}`);
  }

  // ISSUE #461: the model is a property of the role's policy, never a per-site default. Five
  // consecutive write slices dispatched xr-systems-architect (standard_execution -> pro) and
  // every one ran flash — no warning, no gate. Resolve + refuse HERE, before contract assembly
  // and worktree creation, so a downgrade refusal costs nothing. The same resolver feeds
  // buildArgv, the ledger and the vision appendix (all five sites).
  const dispatchModel = resolveDispatchModel(options);
  console.log(`dispatch: role=${options.role ?? "(roleless)"} tier=${dispatchModel.tier ?? "none"} model=${dispatchModel.model}`);

  // --- Layer-3 contract assembly (trusted plane) ---
  //
  // Ordered BEFORE worktree creation deliberately. When the gate first shipped it ran after, and a
  // refused dispatch still left an orphan worktree and branch behind — measured: `demo-no-proofs`
  // existed on disk despite never spawning a worker. A refusal must cost nothing, or the cleanup
  // burden quietly argues for loosening the gate.
  const assembled = assembleDispatchContract({
    repoRoot,
    sliceId,
    dispatchProofs: options.proofs,
    contract: options.contract,
    contractReason: options.contractReason,
    refreshTrustedBrief: options.refreshTrustedBrief,
  });
  assertWorktreeContractGate({
    worktreeBound: Boolean(options.worktree),
    treeProofs: assembled.treeProofs,
    sliceId,
    contract: options.contract,
    contractReason: options.contractReason,
  });

  // ISSUE #448: the board is the dequeue queue. The dispatcher (machine) ensures the card is on
  // the board (item-add when absent) and marks Factory=Dispatched BEFORE any worktree creation or
  // spawn, so a worker that cannot be tracked is never dispatched. Ordered AFTER the contract
  // gates so a refused dispatch (divergence, unproofed worktree) leaves the card at Planted — it
  // was never dispatched. A gh failure here REFUSES the dispatch (chosen and recorded: a
  // silently-untracked worker is the mute-worker state this issue exists to fix, and gh is
  // already load-bearing for the loop's briefs/comments). Slices with no card (no board record,
  // not issue-<n>) warn and continue — there is nothing to track.
  const factoryWrite = setFactoryField(repoRoot, sliceId, "Dispatched");
  if (!factoryWrite.ok && factoryWrite.skipped) {
    console.warn(
      `WARNING (issue #448): no board card resolvable for slice '${sliceId}' — Factory stays unset. `
      + `Only slices with a board record or an issue-<n> id are tracked.`,
    );
  }

  // ISSUE #396 (measured 2026-08-14): the gitignored-proof-target gate used to fire only at MERGE
  // time — #392 (38 turns) and #367 (51 turns) both completed contract-green and were REFUSED at
  // land for an `exists:` proof on a gitignored target a clean clone cannot have. Pre-flight it
  // HERE, before worktree creation and before any spawn, against the RESOLVED proof set and the
  // trusted brief's opt-out, with the SAME evaluator merge-kill uses at land. LOUD but not fatal:
  // the opt-out is a stated decision, and a worker may legitimately force-add the target (which is
  // what the land gate then requires). A refusal would break both, so this warns and records.
  const gitignoredProofTargetsWarned = evaluateProofTargetsBeforeDispatch(
    repoRoot,
    assembled.treeProofs,
    Array.isArray(assembled.brief?.gitignoredProofTargetsAllowed)
      ? assembled.brief!.gitignoredProofTargetsAllowed!
      : undefined,
  )
    .filter((v) => v.unlandable)
    .map((v) => v.target);
  if (gitignoredProofTargetsWarned.length > 0) {
    console.warn(
      [
        "",
        "WARNING (issue #396): proof target(s) are gitignored and untracked in HEAD — merge-kill would",
        "REFUSE this slice at land unless the worker force-adds them or the brief names them in",
        "gitignoredProofTargetsAllowed:",
        ...gitignoredProofTargetsWarned.map((t) => `  - ${t}`),
        "Force-add the target, declare the opt-out, or expect a land refusal after the work is done.",
        "",
      ].join("\n"),
    );
  }

  // #66: brief.assetPaths ∪ dispatch.assetPaths (unique, order preserved). Declaration drives
  // provisionWorktreeAssets inside prepareWorktreeForWorker — a provisioner nothing calls is docs.
  const assetPaths = uniqueStrings([
    ...(Array.isArray(assembled.brief?.assetPaths) ? assembled.brief!.assetPaths! : []),
    ...(options.assetPaths ?? []),
  ]);

  // Worktree binding: resolve the tree, point the worker at it, and install the HARD deny on main.
  // Done here rather than left to callers so no dispatch path can forget the boundary.
  // ISSUE #437: the prompt file lands in the TRUSTED slice dir (the worker cannot write it — the
  // main-tree deny covers it — and it survives as the exact-prompt record for the slice).
  // ISSUE #439: choose the session id HERE, before the process exists. parseResult's scrape of
  // the child's `end` event used to be the ONLY name a dispatch had — a child that dies before
  // `end` had no id at all (issue-240 paid that bill). `-s` CREATES; on a resume the id is the
  // resumed session's own and can only come from the child, so none is chosen here.
  const chosenSessionId = options.resume ? undefined : randomUUID();
  let effective = { ...options, sessionId: chosenSessionId, promptFileDir: assembled.trustedSliceDir };
  let worktreePath: string | undefined;
  if (options.worktree) {
    worktreePath = resolveWorkerWorktree(
      repoRoot,
      options.worktree,
      options.slice ?? options.role ?? "worker",
      options.branch,
      assetPaths.length > 0 ? { assetPaths } : undefined,
    );
    effective = {
      ...effective,
      cwd: worktreePath,
      // The worker must never see the main path as its repo root — every absolute path it copies
      // out of a prompt, AGENTS.md, or role memory would otherwise point at main.
      prompt: effective.prompt.split(repoRoot).join(worktreePath),
    };
  }

  const treeRootForProofs = worktreePath ?? effective.cwd ?? repoRoot;

  // INCIDENT (layer-3 / H1): write baseline BEFORE the worker runs, hashing the worktree pre-work
  // state into the TRUSTED dir the worker cannot write.
  if (assembled.treeProofs.some((r) => r.startsWith("changed:"))) {
    await writeBaselineHashes({
      treeRoot: treeRootForProofs,
      baselineDir: assembled.trustedSliceDir,
      sliceId,
      rules: assembled.treeProofs,
    });
  }

  // #435: bind the role's charter into the worker prompt — role: is no longer a ledger-only label.
  // Unknown roles compose "" so a bad role id cannot break dispatch.
  // RE-ENABLED 2026-08-19 (issue #437): compose hung dispatch while the prompt was the value of
  // `-p` (embedded flag tokens reached grok's argv scan); the prompt now travels via
  // `--prompt-file`, so compose is safe again — verified by a real dispatch reaching a sessionId.
  if (options.role) {
    effective = {
      ...effective,
      prompt: `${effective.prompt}${buildRoleCharterAppendix(options.role, repoRoot)}`,
    };
  }

  if (assembled.treeProofs.length > 0) {
    effective = {
      ...effective,
      prompt: `${effective.prompt}${buildContractPromptAppendix(assembled.treeProofs)}`,
    };
  }

  // ISSUE #242: tell the worker it is text-only so a denied image Read is understood rather than
  // puzzled over. The Read denies appended to argv below are the enforcement; this is worker
  // comprehension only.
  // ISSUE #461: single resolution for the three vision sites — the model is the role's policy
  // model, never a per-site flash default.
  const resolvedModel = resolveDispatchModel(effective).model;
  if (isTextOnlyModel(resolvedModel)) {
    effective = {
      ...effective,
      prompt: `${effective.prompt}${buildTextOnlyVisionPromptAppendix(resolvedModel)}`,
    };
  }

  const argv = buildArgv(effective);
  if (worktreePath) argv.push(...buildWorktreeIsolationDenies(repoRoot).flatMap((rule) => ["--deny", rule]));
  // ISSUE #242: a text-only model reading a PNG embeds an image_url block the API rejects with a
  // hard 400 on the turn after the read (measured: 113,449 input tokens, exit 1, no sessionId).
  // Deny the Read tool on image/video extensions mechanically, before spawn, for every text-only
  // dispatch — regardless of what the prompt or proofs say. Denied reads are survivable; the 400
  // is not. Must run even when the model is the implicit default (deepseek-v4-flash).
  const effectiveModel = resolvedModel;
  if (isTextOnlyModel(effectiveModel)) {
    argv.push(...buildTextOnlyVisionDenies().flatMap((rule) => ["--deny", rule]));
  }
  const binary = join(homedir(), ".grok/bin/grok");
  const mainDirtyBefore = worktreePath ? new Set(mainTreeDirtyPaths(repoRoot)) : undefined;
  // #344: anchor the leak window at the same instant as the dirty snapshot. A commit made to
  // main after this sha is evidence of a second writer (a peer lane or another integrate), and
  // the paths it touches must not be attributed to this worker.
  const mainHeadBefore = worktreePath ? mainHeadSha(repoRoot) : undefined;

  // ISSUE #440: name the child BEFORE it exists. A dispatch that dies before returning — arg-parse
  // abort, crash, reap — used to leave no ledger entry, so recovery meant scavenging
  // ~/.grok/sessions/<worktree>/ newest-first, where a wrong id does not error, it CONFABULATES.
  // #439 chose the id up front; this write puts it in the ledger before the spawn. The completed
  // entry is re-appended after exit so the last line stays authoritative. A resumed session's id
  // can only come from the child, so a resume writes no early line.
  const earlyEntry: DispatchLedgerEntry | undefined = chosenSessionId
    ? {
        sessionId: chosenSessionId,
        ...ledgerIdentity(options, assembled, worktreePath),
        at: new Date().toISOString(),
        phase: "spawned",
      }
    : undefined;
  if (earlyEntry) {
    recordSession(repoRoot, earlyEntry);
  }

  const chunks: string[] = [];
  const stderr: string[] = [];
  const child = spawn(binary, argv, {
    cwd: effective.cwd ?? repoRoot,
    env: { ...process.env, ...REQUIRED_ENV },
  });
  child.stdout.on("data", (data: Buffer) => chunks.push(data.toString()));
  child.stderr.on("data", (data: Buffer) => stderr.push(data.toString()));

  const code = await new Promise<number>((resolve) => child.on("close", (value: number | null) => resolve(value ?? 1)));
  const output = chunks.join("");
  const parsed = parseResult(output);

  // ISSUE #439: a fresh dispatch's id was chosen before spawn; parseResult's scrape is now only
  // the RESUME source (and a consistency check for fresh ones). A child that dies before `end`
  // keeps the id we gave it.
  const sessionId = chosenSessionId ?? parsed.sessionId;
  if (chosenSessionId && parsed.sessionId && parsed.sessionId !== chosenSessionId) {
    // The docs say `-s` creates the session with the supplied UUID; if grok ever reports a
    // different id the ledger/report below are keyed on the wrong name and every resume would
    // confabulate or 404. Surface it rather than let the divergence stay silent.
    console.warn(
      `WARNING (issue #439): grok reported session id ${parsed.sessionId}, but dispatch supplied `
      + `${chosenSessionId}. The ledger and contract report are keyed on the SUPPLIED id.`,
    );
  }

  if (!sessionId) {
    // A missing sessionId means an arg-parse abort or an immediate crash — surface stderr, because
    // this is exactly the case that previously looked like a silent success. Only reachable on a
    // resume (a fresh dispatch always has the id chosen above).
    throw new Error(
      `Dispatch produced no sessionId (exit ${code}). This usually means grok rejected the `
      + `arguments and never started. stderr:\n${stderr.join("").slice(0, 800)}`,
    );
  }

  // INCIDENT (#48 / #41): recordSession MUST precede the isolation-leak throw. A false-positive
  // leak abort discarded a correct worker and left NO sessionId — so the one dispatch most worth
  // a retrospective could never be resumed. Partial entry (sessionId present, proofs absent) is
  // worth more than a complete entry that never gets written. Proofs re-append below when present.
  // ISSUE #439: the same rule now covers a child that dies before `end` — the entry below is
  // written keyed on the CHOSEN id before the early-death throw, so the dead child has a name in
  // the ledger and is resumable without scavenging ~/.grok/sessions.
  /**
   * MACHINE-DERIVED HANDOFF STATE — `completed` means the worker RAN, not that its work is ready.
   *
   * MEASURED on issue-620: the authoritative final row read `completed / turns 150 / cancelled /
   * proofsOk: true` while FOUR files sat dirty and uncommitted. factory-pulse.ts:94 counted it as a
   * completion and a pass; campaign-track.ts:48 selected it as the slice's outcome. A bare resume
   * later committed the work and wrote no row, so the ledger's last word stayed the intermediate
   * state. Integration was never at risk — its own commit/diff gates refuse an uncommitted land —
   * so this is a monitoring and recovery ambiguity.
   *
   * `phase` is deliberately unchanged; readiness gets its own field so monitors stop inferring it.
   */
  const handoffAssessment = worktreePath ? deriveHandoffState(worktreePath) : undefined;
  const entry: DispatchLedgerEntry = {
    sessionId,
    ...ledgerIdentity(options, assembled, worktreePath),
    ...(parsed.turns !== undefined ? { turns: parsed.turns } : {}),
    ...(parsed.stopReason ? { stopReason: parsed.stopReason } : {}),
    ...(handoffAssessment ? {
      handoff: handoffAssessment.handoff,
      handoffDirtyFiles: handoffAssessment.dirtyFiles,
      handoffAheadCommits: handoffAssessment.aheadCommits,
      handoffDetail: handoffAssessment.detail,
    } : {}),
    at: new Date().toISOString(),
    phase: parsed.sessionId ? "completed" : "died",
    /**
     * WHY it died, classified from the child's own stderr and exit code.
     *
     * Before this, a death row carried no reason at all: a 402, a 429, a 500 and a missing-worktree
     * ENOENT were one value, `phase: "died"`. That made provider health unmeasurable — the 16 deaths
     * measured 2026-08-24 cannot be told apart, and the ox-alpha 19% vs deepseek-v4-pro 4% split
     * being used to weigh the model ladder (#626) cannot distinguish an unreliable provider from a
     * harness bug handing it a worktree that did not exist.
     *
     * `deathCountsAgainstModel` is the field a future provider breaker must key on — never `phase`.
     * Harness failures and reaper kills are false by construction, so a breaker cannot open on a
     * healthy provider because the dispatcher misfired.
     */
    ...(parsed.sessionId ? {} : (() => {
      const d = classifyDeath(stderr.join(""), code);
      return {
        deathClass: d.deathClass,
        deathRetryability: d.retryability,
        deathCountsAgainstModel: d.countsAgainstModel,
        ...(d.evidence ? { deathEvidence: d.evidence } : {}),
        ...(d.exitCode !== null ? { exitCode: d.exitCode } : {}),
      };
    })()),
    ...(gitignoredProofTargetsWarned.length > 0 ? { gitignoredProofTargetsWarned } : {}),
  };
  recordSession(repoRoot, entry);

  if (!parsed.sessionId && chosenSessionId) {
    // A fresh dispatch whose child never reached `end` — arg-parse abort, crash, or kill. Fail
    // loud (a missing end event is never a completed dispatch), but the id above is already in
    // the ledger, so the child has a name and can be resumed directly.
    throw new Error(
      `Dispatch died before emitting an end event (exit ${code}); session id ${sessionId}. `
      + `The session may still be resumable with --resume ${sessionId}. stderr:\n${stderr.join("").slice(0, 800)}`,
    );
  }
  // recordSession resolves through the SHARED coordination root (which may live in the main
  // checkout), but this mirror write is repoRoot-relative — a worktree that never had a
  // .openclinxr/openclaw would ENOENT here. mkdir like recordSession does, or a fresh worktree
  // turns a completed dispatch into a post-success crash.
  const lastResultPath = join(repoRoot, ".openclinxr/openclaw/worker-last-result.json");
  mkdirSync(dirname(lastResultPath), { recursive: true });
  writeFileSync(lastResultPath, output);

  if (mainDirtyBefore) {
    // The deny should have made undeclared main writes impossible. Attribute orchestrator
    // concurrent work out of the leak set first (#48), then paths a peer lane committed during
    // the window (#344) — then fail loudly on residual dirt.
    const leaked = attributeIsolationLeak({
      before: [...mainDirtyBefore],
      after: mainTreeDirtyPaths(repoRoot),
      orchestratorPaths: options.orchestratorPaths,
      concurrentlyCommittedPaths: mainHeadBefore
        ? pathsTouchedByCommitsSince(repoRoot, mainHeadBefore)
        : undefined,
    });
    if (leaked.length > 0) {
      throw new Error(
        `Worktree-bound worker leaked writes into the MAIN checkout despite the path deny: `
        + `${leaked.slice(0, 10).join(", ")}. Treat this dispatch as failed and investigate the `
        + `isolation boundary before running concurrent writers again.`,
      );
    }
  }

  // INCIDENT (layer-3): evaluate tree proofs AFTER exit. Skip narrative entirely.
  let proofs: DoneWhenCheck[] | undefined;
  let proofsOk: boolean | undefined;
  let contractReportPath: string | undefined;
  if (assembled.treeProofs.length > 0) {
    proofs = await evaluateDispatchTreeProofs({
      treeRoot: treeRootForProofs,
      baselineDir: assembled.trustedSliceDir,
      sliceId,
      treeProofs: assembled.treeProofs,
    });
    proofsOk = proofs.every((c) => c.passed);
    entry.proofs = proofs;
    entry.proofsOk = proofsOk;
  } else if (assembled.contractSource === "none") {
    proofsOk = undefined;
  }

  if (proofs) {
    const reportDir = resolveSharedCoordinationPath(".openclinxr/openclaw", repoRoot);
    mkdirSync(reportDir, { recursive: true });
    contractReportPath = join(reportDir, `contract-verify-${sessionId}.json`);
    writeFileSync(
      contractReportPath,
      `${JSON.stringify(
        {
          schemaVersion: "openclinxr.contract-verify.v1",
          sliceId,
          sessionId,
          treeRoot: treeRootForProofs,
          baselineDir: assembled.trustedSliceDir,
          contractSource: assembled.contractSource,
          proofsOk,
          checks: proofs,
          at: entry.at,
        },
        null,
        2,
      )}\n`,
    );
    entry.contractReportPath = contractReportPath;
    // Re-append with proofs + report path so the latest ledger line is complete.
    recordSession(repoRoot, entry);
  }

  if (proofs && proofsOk === false) {
    throw new ContractProofsFailedError(sliceId, proofs);
  }

  return entry;
}


/** `options.slice` before the local `sliceId` is computed — the guard runs first by design. */
function sliceId2(options: Pick<DispatchOptions, "slice">): string {
  return options.slice ?? "unscoped";
}

/**
 * Fail closed when the ledger shows this slice already walked into the same wall twice.
 *
 * Reads the ledger defensively: a missing or malformed ledger must never block a dispatch, because
 * a guard that fails open on absent history is correct and one that fails closed would brick a
 * fresh checkout.
 */
export function assertNotRepeatingIntoTheSameWall(
  repoRoot: string,
  slice: string,
  overrideReason?: string,
): void {
  if (slice === "unscoped") return;
  let rows: BreakerRow[] = [];
  try {
    // MUST use the shared resolver, not join(repoRoot, ...). Proven 2026-08-24: from a worktree
    // root the two diverge — shared resolves to the MAIN checkout's ledger, raw to a file inside the
    // worktree that does not exist. The ledger WRITERS already use the resolver, so a raw read made
    // this gate see no history and fail open silently in exactly the context dispatches run in.
    const raw = readFileSync(resolveSharedCoordinationPath(LEDGER, repoRoot), "utf8");
    rows = raw.split("\n").filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l) as BreakerRow]; } catch { return []; }
    });
  } catch {
    return; // no ledger, no history, no refusal
  }
  const verdict = shouldRefuseDispatch(rows, slice, Date.now());
  if (!verdict.refuse) return;

  /**
   * A SILENT GATE IS THE WORST KIND. This guard runs before the board update and before any session
   * ledger row, so without this append nothing durable explains why a slice stopped dispatching and
   * the next reader would have to re-run the breaker to find out.
   *
   * `lastPassAt` beside `triggeredBy` is what makes a FALSE refusal recognisable without re-running
   * anything: a refusal whose last pass is recent relative to its triggering sessions is the shape
   * that was measured on issue-341 and fixed in 3baa71af. Written best-effort — a failed append
   * must never be the reason a dispatch cannot be refused.
   */
  /**
   * An override does not silence the gate — it changes the record from a refusal to a documented
   * decision, so the next reader sees BOTH that the breaker fired and who chose to proceed.
   */
  const overridden = typeof overrideReason === "string" && overrideReason.trim().length > 0;

  /**
   * ASYMMETRIC DURABILITY, and the asymmetry is the point.
   *
   * A REFUSAL's record is best-effort: the dispatch is being stopped either way, so a failed append
   * must never become the reason a storm cannot be refused.
   *
   * An OVERRIDE's record FAILS CLOSED. An override that proceeds without leaving a record is
   * strictly worse than no override at all — it is an unlogged bypass of a safety gate, and the
   * whole justification for allowing one is that it is documented. Measured hole in 6ecbf29e: the
   * append sat in a swallowed try/catch followed by `return`, so a write failure let the dispatch
   * through in silence.
   */
  const record = () => appendFileSync(
      resolveSharedCoordinationPath(BREAKER_EVENTS, repoRoot),
      `${JSON.stringify({
        kind: overridden ? "dispatch-breaker-overridden" : "dispatch-refused",
        overrideReason: overridden ? overrideReason.trim() : undefined,
        at: verdict.evaluatedAt,
        slice,
        clause: verdict.clause,
        detail: verdict.detail,
        lastPassAt: verdict.lastPassAt,
        triggeredBy: verdict.triggeredBy,
      })}\n`,
      "utf8",
    );

  if (overridden) {
    try {
      record();
    } catch (cause) {
      throw new Error(
        `dispatch REFUSED (${verdict.clause}): an override was supplied but its record could not be `
        + `written to ${BREAKER_EVENTS}, and an unrecorded override is an unlogged bypass of a safety `
        + `gate. Fix the write and retry. Cause: ${String(cause)}`,
      );
    }
    return;
  }

  try {
    record();
  } catch { /* a refusal's record is evidence, never a gate — the dispatch stops regardless */ }

  throw new Error(
    `dispatch REFUSED (${verdict.clause}): ${verdict.detail} ` +
    `Last proof PASS for this slice: ${verdict.lastPassAt ?? "none"}. ` +
    `Recorded to ${BREAKER_EVENTS}. Pass retryBreakerOverrideReason to proceed anyway — a reasoned ` +
    `override is the ONLY escape, because success-reset alone is circular: the gate refuses the very ` +
    `dispatch whose PASS would reset it. This is a circuit breaker, not a permanent close — it clears ` +
    `when the window rolls off, and a PASS resets it immediately. ` +
    `Repeating the dispatch unchanged is the behaviour that produced 16 of 62 measured proof failures.`,
  );
}
