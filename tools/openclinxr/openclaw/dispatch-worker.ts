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
  /**
   * #66: repo-relative paths the slice needs from main (often gitignored). Prepared into the
   * worker worktree by {@link prepareWorktreeForWorker} → provisionWorktreeAssets.
   */
  assetPaths?: string[];
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
 * Attribute main-tree dirt to worker leak vs orchestrator concurrent work.
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
 * Returns paths in `after` that are newly dirty relative to `before` AND not in orchestratorPaths.
 */
export function attributeIsolationLeak(input: {
  before: readonly string[];
  after: readonly string[];
  orchestratorPaths?: readonly string[];
}): string[] {
  const beforeSet = new Set(input.before);
  const orchestratorSet = new Set(input.orchestratorPaths ?? []);
  return input.after.filter((path) => !beforeSet.has(path) && !orchestratorSet.has(path));
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
 * `--output-format streaming-json`, which grok emits as NDJSON of agent-native ACP session-update
 * events — one JSON document per line, with sessionId NESTED at `params.sessionId` — NOT the
 * single JSON document that `--output-format json` produces (top-level `text`/`sessionId`/
 * `num_turns`/`stopReason`). `JSON.parse` of the whole stream throws, parseResult returned {},
 * and dispatch() threw "Dispatch produced no sessionId" AFTER the worker (issue-240) had
 * completed and committed its work (c1ea344e) — before recordSession and before the post-exit
 * proof re-run, so no contract report was written and integrate refused `contract-not-verified`,
 * forcing manual contract-verify-cli recovery. Measured on captured real output: the plain-json
 * shape parses and yields the sessionId; the streaming-json shape yields undefined. Fix: fall
 * back to a per-line NDJSON scan when whole-document parse fails, reading `params.sessionId`,
 * `params.update.stop_reason`, `params.update.usage.numTurns` (camelCase, on the
 * `turn_completed` event), and the concatenated `agent_message_chunk` text.
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

  // --output-format streaming-json: NDJSON of ACP session-update events.
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
    const params = (event["params"] ?? {}) as Record<string, unknown>;
    if (typeof params["sessionId"] === "string") {
      sessionId = params["sessionId"] as string;
    }
    const update = (params["update"] ?? {}) as Record<string, unknown>;
    if (typeof update["stop_reason"] === "string") {
      stopReason = update["stop_reason"] as string;
    }
    // Measured on real streaming-json output: turn count is `usage.numTurns` (camelCase) on the
    // turn_completed event. Keep the other spellings as defensive fallbacks.
    const usage = (update["usage"] ?? {}) as Record<string, unknown>;
    const turnsValue =
      update["numTurns"] ?? update["num_turns"] ?? usage["numTurns"] ?? usage["num_turns"];
    if (typeof turnsValue === "number") {
      turns = turnsValue;
    }
    if (update["sessionUpdate"] === "agent_message_chunk") {
      const content = (update["content"] ?? {}) as Record<string, unknown>;
      if (typeof content["text"] === "string") {
        textChunks.push(content["text"] as string);
      }
    }
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

  // #66: brief.assetPaths ∪ dispatch.assetPaths (unique, order preserved). Declaration drives
  // provisionWorktreeAssets inside prepareWorktreeForWorker — a provisioner nothing calls is docs.
  const assetPaths = uniqueStrings([
    ...(Array.isArray(assembled.brief?.assetPaths) ? assembled.brief!.assetPaths! : []),
    ...(options.assetPaths ?? []),
  ]);

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
      assetPaths.length > 0 ? { assetPaths } : undefined,
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

  // INCIDENT (#48 / #41): recordSession MUST precede the isolation-leak throw. A false-positive
  // leak abort discarded a correct worker and left NO sessionId — so the one dispatch most worth
  // a retrospective could never be resumed. Partial entry (sessionId present, proofs absent) is
  // worth more than a complete entry that never gets written. Proofs re-append below when present.
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
    ...(assembled.contractReason ? { contractReason: assembled.contractReason } : {}),
  };
  recordSession(repoRoot, entry);
  writeFileSync(join(repoRoot, ".openclinxr/openclaw/worker-last-result.json"), output);

  if (mainDirtyBefore) {
    // The deny should have made undeclared main writes impossible. Attribute orchestrator
    // concurrent work out of the leak set first (#48) — then fail loudly on residual dirt.
    const leaked = attributeIsolationLeak({
      before: [...mainDirtyBefore],
      after: mainTreeDirtyPaths(repoRoot),
      orchestratorPaths: options.orchestratorPaths,
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
    // Re-append with proofs + report path so the latest ledger line is complete.
    recordSession(repoRoot, entry);
  }

  if (proofs && proofsOk === false) {
    throw new ContractProofsFailedError(sliceId, proofs);
  }

  return entry;
}
