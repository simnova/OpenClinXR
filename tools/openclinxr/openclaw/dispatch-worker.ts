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
 * BYPASS CHOKEPOINT: shell-tool attempts to run raw `grok -p` / `--single` are refused by
 * `dispatch-chokepoint.ts` (PreToolUse). This module uses `spawn(binary, argv)` so it never
 * hits that matcher. Orchestrator isolation probes that must run with path denies OFF use the
 * named escape OPENCLINXR_RAW_GROK_SANCTIONED + OPENCLINXR_RAW_GROK_REASON (logged). The
 * chokepoint is a string matcher over shell command text — not an OS sandbox; see that file.
 */

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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
import { assertLoopNotPaused } from "./loop-pause.js";

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

/** Where session ids survive the orchestrator process that created them. */
const LEDGER = ".openclinxr/openclaw/worker-sessions.jsonl";

type DispatchOptions = {
  prompt: string;
  slice?: string;
  role?: string;
  model?: string;
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
};

export type DispatchLedgerEntry = {
  sessionId: string;
  slice?: string;
  role?: string;
  model: string;
  turns?: number;
  stopReason?: string;
  resumedFrom?: string;
  /** Set when the worker was bound to its own worktree (concurrent-writer safe). */
  worktree?: string;
  at: string;
  /**
   * INCIDENT (layer-3): after exit, orchestrator re-ran tree proofs against the worktree.
   * Absent means this entry predates contract wiring or contract was explicitly "none".
   */
  proofsOk?: boolean;
  proofs?: DoneWhenCheck[];
  contractSource?: "brief" | "brief+dispatch" | "synthesized" | "none";
  contractReportPath?: string;
  /** Present when an unproofed dispatch was explicitly opted out of the tier gate. */
  contractReason?: string;
};

/**
 * INCIDENT (layer-3): a worker that skips a required proof must FAIL MECHANICALLY. Throwing after
 * the ledger write means durability of sessionId wins over loudness — a lost sessionId is
 * unresumable; a failed proof is still visible on the ledger + contract-verify JSON.
 */
export class ContractProofsFailedError extends Error {
  readonly name = "ContractProofsFailedError";
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

type TrustedBrief = {
  id?: string;
  done_when?: string[];
  synthesized?: boolean;
  [key: string]: unknown;
};

export type AssembledContract = {
  treeProofs: string[];
  contractSource: "brief" | "brief+dispatch" | "synthesized" | "none";
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
 * INCIDENT (2026-08-05): dispatched as `grok -p --resume <id> "<prompt>"`. `-p` is short for
 * `--single` and takes the PROMPT as its value, so `--resume` was swallowed as the prompt and the
 * run aborted with "a value is required for '--single <PROMPT>'". The wrapper shell still exited
 * 0 (the trailing echo), so it LOOKED like a completed worker that had simply done nothing.
 *
 * Correct order is always: `-p "<prompt>"` FIRST, then every other flag.
 */
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
}

export function buildArgv(options: DispatchOptions): string[] {
  const argv = ["-p", options.prompt];
  if (options.resume) argv.push("--resume", options.resume);
  argv.push("--model", options.model ?? "deepseek-v4-pro");
  argv.push("--always-approve");
  // streaming-json emits a usage event per turn — the only way to see a stall while the worker is
  // still alive. Plain json yields aggregates only, i.e. you learn about the death afterwards.
  argv.push("--output-format", options.streaming ? "streaming-json" : "json");
  argv.push("--max-turns", String(options.maxTurns ?? DEFAULT_MAX_TURNS));
  if (options.cwd) argv.push("--cwd", options.cwd);
  return argv;
}

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
): string {
  if (typeof worktree === "string") {
    if (worktree.startsWith(`${mainRoot}/`)) {
      throw new Error(
        `Worktree ${worktree} is INSIDE the main checkout. The isolation deny covers ${mainRoot}/** `
        + `and would block the worker's own edits. Place worktrees outside main (see WORKTREE_ROOT).`,
      );
    }
    return worktree;
  }
  const target = join(WORKTREE_ROOT, name);
  if (!existsSync(target)) {
    mkdirSync(WORKTREE_ROOT, { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", branch ?? `wt/${name}`, target], {
      cwd: mainRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
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
 */
function parseResult(raw: string): { sessionId?: string; turns?: number; stopReason?: string; text?: string } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      text: (parsed["text"] ?? parsed["result"]) as string | undefined,
      sessionId: parsed["sessionId"] as string | undefined,
      turns: parsed["num_turns"] as number | undefined,
      stopReason: (parsed["stopReason"] ?? parsed["subtype"]) as string | undefined,
    };
  } catch {
    return {};
  }
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

  // --- Layer-3 contract assembly (trusted plane) ---
  //
  // Ordered BEFORE worktree creation deliberately. When the gate first shipped it ran after, and a
  // refused dispatch still left an orphan worktree and branch behind — measured: `demo-no-proofs`
  // existed on disk despite never spawning a worker. A refusal must cost nothing, or the cleanup
  // burden quietly argues for loosening the gate.
  const sliceId = options.slice ?? "unscoped";
  const assembled = assembleDispatchContract({
    repoRoot,
    sliceId,
    dispatchProofs: options.proofs,
    contract: options.contract,
    contractReason: options.contractReason,
  });
  assertWorktreeContractGate({
    worktreeBound: Boolean(options.worktree),
    treeProofs: assembled.treeProofs,
    sliceId,
    contract: options.contract,
    contractReason: options.contractReason,
  });

  // Worktree binding: resolve the tree, point the worker at it, and install the HARD deny on main.
  // Done here rather than left to callers so no dispatch path can forget the boundary.
  let effective = options;
  let worktreePath: string | undefined;
  if (options.worktree) {
    worktreePath = resolveWorkerWorktree(
      repoRoot,
      options.worktree,
      options.slice ?? options.role ?? "worker",
      options.branch,
    );
    effective = {
      ...options,
      cwd: worktreePath,
      // The worker must never see the main path as its repo root — every absolute path it copies
      // out of a prompt, AGENTS.md, or role memory would otherwise point at main.
      prompt: options.prompt.split(repoRoot).join(worktreePath),
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

  if (assembled.treeProofs.length > 0) {
    effective = {
      ...effective,
      prompt: `${effective.prompt}${buildContractPromptAppendix(assembled.treeProofs)}`,
    };
  }

  const argv = buildArgv(effective);
  if (worktreePath) argv.push(...buildWorktreeIsolationDenies(repoRoot).flatMap((rule) => ["--deny", rule]));
  const binary = join(homedir(), ".grok/bin/grok");
  const mainDirtyBefore = worktreePath ? new Set(mainTreeDirtyPaths(repoRoot)) : undefined;

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

  if (!parsed.sessionId) {
    // A missing sessionId means an arg-parse abort or an immediate crash — surface stderr, because
    // this is exactly the case that previously looked like a silent success.
    throw new Error(
      `Dispatch produced no sessionId (exit ${code}). This usually means grok rejected the `
      + `arguments and never started. stderr:\n${stderr.join("").slice(0, 800)}`,
    );
  }

  if (mainDirtyBefore) {
    // The deny should have made this impossible. If it fires, the boundary leaked and the run is
    // NOT trustworthy — fail loudly rather than let a "successful" worker quietly dirty main.
    const leaked = mainTreeDirtyPaths(repoRoot).filter((file) => !mainDirtyBefore.has(file));
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
  } else if (assembled.contractSource === "none") {
    proofsOk = undefined;
  }

  const entry: DispatchLedgerEntry = {
    sessionId: parsed.sessionId,
    ...(options.slice ? { slice: options.slice } : {}),
    ...(options.role ? { role: options.role } : {}),
    model: options.model ?? "deepseek-v4-pro",
    ...(parsed.turns !== undefined ? { turns: parsed.turns } : {}),
    ...(parsed.stopReason ? { stopReason: parsed.stopReason } : {}),
    ...(options.resume ? { resumedFrom: options.resume } : {}),
    ...(worktreePath ? { worktree: worktreePath } : {}),
    at: new Date().toISOString(),
    contractSource: assembled.contractSource,
    ...(proofs !== undefined ? { proofs } : {}),
    ...(proofsOk !== undefined ? { proofsOk } : {}),
    ...(assembled.contractReason ? { contractReason: assembled.contractReason } : {}),
  };

  // INCIDENT (layer-3): write ledger FIRST — durability of sessionId beats loudness.
  recordSession(repoRoot, entry);
  writeFileSync(join(repoRoot, ".openclinxr/openclaw/worker-last-result.json"), output);

  if (proofs) {
    const reportDir = resolveSharedCoordinationPath(".openclinxr/openclaw", repoRoot);
    mkdirSync(reportDir, { recursive: true });
    contractReportPath = join(reportDir, `contract-verify-${parsed.sessionId}.json`);
    writeFileSync(
      contractReportPath,
      `${JSON.stringify(
        {
          schemaVersion: "openclinxr.contract-verify.v1",
          sliceId,
          sessionId: parsed.sessionId,
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
    // Re-append with report path so the latest ledger line is complete.
    recordSession(repoRoot, entry);
  }

  if (proofs && proofsOk === false) {
    throw new ContractProofsFailedError(sliceId, proofs);
  }

  return entry;
}
