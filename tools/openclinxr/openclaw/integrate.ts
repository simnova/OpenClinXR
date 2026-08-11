#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { loadTrustedBrief, readSessions, trustedSliceDir } from "./dispatch-worker.js";
import { stagedTreeHash, writeGateReport } from "./integrate-gate.js";
import { runMergeKill, type MergeKillReport } from "./merge-kill.js";

/**
 * The land boundary — the only supported way work reaches main.
 *
 * WHY THIS EXISTS: merge-kill exited 2 into the void. Nothing called it, so every guarantee built
 * beneath it (task contract, diff-class policy, kill criteria) was advisory and a human remained the
 * gate. Merge is the last enforceable choke point, and merge-kill is the only mechanism that failed
 * closed on a change `pnpm architecture` passed GREEN — a SIZE_FREEZE ceiling raised 607→999. No
 * rule gate can catch that one, because the gate is what got widened.
 *
 * Two properties this must have, both learned the hard way:
 *   1. Refusal has NO side effect. Reporting a kill after landing is not a gate.
 *   2. Landing records an INTEGRATION EVENT. The scorecard previously inferred "landed" by regexing
 *      `Merge branch 'wt/…'` out of commit subjects, which read 33% when the true figure was 100% —
 *      slices integrated by copying intended files leave no such subject. An explicit event is the
 *      fact; a commit-message pattern is folklore.
 */

const EVENTS = ".openclinxr/openclaw/integration-events.jsonl";

export type IntegrateInput = {
  repoRoot: string;
  base: string;
  head: string;
  slice: string;
  /** Layer-3 contract result, when the work came from a contracted dispatch. */
  contract?: { proofsOk: boolean; proofs: { rule: string; passed: boolean; detail: string }[] } | null;
  /** Evaluate and report, but never touch the tree. */
  dryRun?: boolean;
};

export type IntegrationEvent = {
  slice: string;
  /** Build-emitting packages rebuilt after the merge (#152 / #196). */
  rebuiltPackages?: string[];
  base: string;
  head: string;
  at: string;
};

export type IntegrateResult = {
  killReport: MergeKillReport;
  landed: boolean;
  /** 0 = landed, 2 = refused by merge-kill. Mirrors the merge-kill CLI so callers can propagate it. */
  exitCode: 0 | 2;
  event?: IntegrationEvent;
};

export function integrationEvents(repoRoot: string): IntegrationEvent[] {
  const path = join(repoRoot, EVENTS);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as IntegrationEvent];
      } catch {
        return [];
      }
    });
}

function recordEvent(repoRoot: string, event: IntegrationEvent): void {
  const path = join(repoRoot, EVENTS);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

/**
 * Find the contract this slice's worker actually produced.
 *
 * The dispatch ledger records `contractReportPath` per session. Without this lookup the CLI passed
 * `contract: null`, merge-kill fired `contract-not-verified`, and a slice whose proofs had ALL
 * PASSED was refused — the report existed and nothing read it. Same shape as every other gap today:
 * the pieces were built and left unconnected.
 */
export function contractForSlice(
  repoRoot: string,
  slice: string,
  /** The branch or sha about to land. Enables the fresher merge report to win over a stale ledger. */
  head?: string,
): IntegrateInput["contract"] {
  /**
   * A merge report that verified THE EXACT COMMIT being landed outranks the dispatch ledger.
   *
   * INCIDENT: #43's worker failed one proof, was resumed, fixed it, and committed. The ledger still
   * held `proofsOk: false` from the first attempt, so integrate refused a slice whose every proof
   * passed on independent re-run. The ledger records what a dispatch OBSERVED at the time; the merge
   * report records proofs RE-EXECUTED against the candidate tree. When the latter is anchored to the
   * head being landed it is strictly better evidence, and stale-beats-fresh is the wrong precedence.
   *
   * Anchoring is what keeps this a strengthening. Without a sha match a report could bless a
   * different commit — the exact failure `integrate-gate` avoids by keying on the staged tree hash
   * rather than on a file existing.
   */
  const merge = mergeVerifyContractForSlice(repoRoot, slice, head);
  if (merge !== null) return merge;

  const entry = readSessions(repoRoot).filter((session) => session.slice === slice).at(-1) as
    | { proofsOk?: boolean; proofs?: { rule: string; passed: boolean; detail: string }[] }
    | undefined;
  if (entry?.proofsOk !== undefined) {
    return { proofsOk: entry.proofsOk, proofs: entry.proofs ?? [] };
  }
  return null;
}

/** Resolve a branch/sha to a commit, or undefined when it cannot be resolved. */
function resolveSha(repoRoot: string, rev: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", rev], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Fall back to the merge-time re-verification report.
 *
 * `contract-verify-cli.ts` re-runs the tree proofs against the candidate tree and writes
 * `contract-verify-<slice>-merge.json` — and NOTHING READ IT. Tenth instance of the same class,
 * found when a dispatch aborted before writing its ledger entry: the worker's proofs all passed on
 * independent re-run, the merge report said so, and integrate refused because it only ever looked at
 * the ledger.
 *
 * This STRENGTHENS the gate rather than relaxing it. The ledger entry is the dispatcher's own record
 * of a worker it supervised; this report is proofs re-executed against the tree about to land, which
 * is the better evidence of the two. A missing or failed report still refuses, and a report whose
 * `proofsOk` is false is passed through as false — never coerced.
 */
function mergeVerifyContractForSlice(
  repoRoot: string,
  slice: string,
  head?: string,
): IntegrateInput["contract"] {
  const path = resolveSharedCoordinationPath(
    `.openclinxr/openclaw/contract-verify-${slice}-merge.json`,
    repoRoot,
  );
  if (!existsSync(path)) return null;
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as {
      sliceId?: string;
      headSha?: string;
      proofsOk?: boolean;
      checks?: { rule: string; passed: boolean; detail?: string }[];
    };
    // A report for a different slice is not evidence about this one.
    if (report.sliceId !== undefined && report.sliceId !== slice) return null;
    if (report.proofsOk === undefined) return null;

    // Anchored freshness: usable only when it verified the very commit about to land. An unanchored
    // report (no headSha, or a head that will not resolve) is not refused outright — it simply
    // cannot outrank the ledger, so control falls through to the dispatch record.
    if (head !== undefined) {
      const headSha = resolveSha(repoRoot, head);
      if (!report.headSha || !headSha || report.headSha !== headSha) return null;
    } else if (!report.headSha) {
      return null;
    }
    return {
      proofsOk: report.proofsOk,
      proofs: (report.checks ?? []).map((check) => ({
        rule: check.rule,
        passed: check.passed,
        detail: check.detail ?? "",
      })),
    };
  } catch {
    return null;
  }
}

/**
 * #84: empty `--head` is an operator/orchestrator error, not a forged proof.
 *
 * `git diff base...` with an empty head resolves to `base...base` (zero files, exit 0). That trips
 * merge-kill's empty-diff-with-passing-proofs rule and blames the WORKER for an ORCHESTRATOR typo.
 * Refuse by name before any kill logic runs. A genuine head===base still reaches merge-kill.
 */
export function assertIntegrateHeadUsable(head: string): void {
  if (typeof head !== "string" || head.trim() === "") {
    throw new Error(
      `integrate: --head is required and must not be empty. `
      + `An empty head makes \`git diff base...\` resolve to base...base (zero files) and would `
      + `mis-attribute an orchestrator CLI omission to the worker via the empty-diff kill. `
      + `Pass the worker branch or commit SHA.`,
    );
  }
}


/**
 * #196 / #152: a land that changes a build-emitting package leaves the checkout STALE.
 *
 * `dist/` is gitignored, so `git merge` carries the source and not the build. The worker's proofs
 * were true in its worktree — where the package had been built — and false on main a minute later.
 * Observed 2026-08-08: `dist/environment-zone-templates.js` EXISTED but predated the new export, so
 * the import resolved and handed back `undefined`. Five contracts failed with
 * `TypeError: resolveFixtureSlotsForRoom is not a function`, which reads like a logic bug rather
 * than a build problem. A MISSING artifact fails loudly at import; a STALE one fails at call time.
 *
 * No `done_when` can catch this — a proof that runs in the worktree cannot see what integration
 * carries. So the land path rebuilds, and reports what it rebuilt.
 */
export function packagesNeedingRebuild(repoRoot: string, base: string, head: string): string[] {
  let changed: string;
  try {
    changed = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const line of changed.split("\n")) {
    const match = /^(packages\/[^/]+\/[^/]+)\/src\//u.exec(line.trim());
    if (!match) continue;
    const pkgJson = join(repoRoot, match[1]!, "package.json");
    if (!existsSync(pkgJson)) continue;
    try {
      const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      // Only packages that actually emit a build, and only if they name themselves.
      if (manifest.name && manifest.scripts?.["build"]) names.add(manifest.name);
    } catch {
      // An unreadable manifest is not this function's problem to report.
    }
  }
  return [...names].sort();
}

/**
 * #217 opt-out list from the TRUSTED brief, never from a worker's report.
 *
 * The brief lives in the shared coordination root, which workers cannot write. A target listed
 * in `gitignoredProofTargetsAllowed` is a stated decision that the artifact is deliberately
 * untracked and the proof is machine-local; anything else under a gitignored path that the
 * branch does not land is refused by merge-kill's `gitignored-proof-target` criterion.
 */
export function allowedGitignoredProofTargets(repoRoot: string, slice: string): string[] {
  const brief = loadTrustedBrief(trustedSliceDir(repoRoot, slice));
  return Array.isArray(brief?.gitignoredProofTargetsAllowed)
    ? brief!.gitignoredProofTargetsAllowed!
    : [];
}

export function integrate(input: IntegrateInput): IntegrateResult {
  // Operator mistake must be named as such BEFORE merge-kill can reframe it as forgery (#84).
  assertIntegrateHeadUsable(input.head);

  // Kill FIRST. Nothing below this line may run if it fires.
  const killReport = runMergeKill({
    repoRoot: input.repoRoot,
    base: input.base,
    head: input.head,
    ...(input.contract !== undefined ? { contract: input.contract } : {}),
    // #217 opt-out: the trusted brief may state that a gitignored proof target is deliberately
    // machine-local (capture trees, provider caches). merge-kill refuses such a target unless
    // it is listed here — so the decision is explicit, never an accident.
    allowedGitignoredProofTargets: allowedGitignoredProofTargets(input.repoRoot, input.slice),
  });

  if (killReport.killed) {
    return { killReport, landed: false, exitCode: 2 };
  }
  if (input.dryRun) {
    return { killReport, landed: false, exitCode: 0 };
  }

  // Land in two steps so the gate report can be keyed to the tree ACTUALLY being committed.
  // `--no-commit` leaves the index staged; `git write-tree` then hashes it. That hash is knowable
  // before any commit object exists, which is what lets the pre-commit hook compare like for like
  // and covers file-copy landings identically to merges.
    // --no-ff as well as --no-commit: a fast-forward would move the ref with nothing left to commit,
  // so there would be no commit for the pre-commit gate to inspect and no consistent tree to key the
  // report to. Forcing a merge commit gives one shape for both.
  // Capture BEFORE the merge. Afterwards `base...head` is empty — the branch is an ancestor — so a
  // detector run post-merge returns nothing and the rebuild silently never fires. That is exactly
  // what shipped in 8144ca5: I probed packagesNeedingRebuild() against a simulated pre-merge range
  // and it passed, then wired it in AFTER the commit where the same call sees no changes. Tested
  // the function, not the integration.
  const rebuildTargets = packagesNeedingRebuild(input.repoRoot, input.base, input.head);

  execFileSync("git", ["merge", "--no-edit", "--no-ff", "--no-commit", input.head], {
    cwd: input.repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeGateReport(input.repoRoot, {
    killed: false,
    treeHash: stagedTreeHash(input.repoRoot),
    base: input.base,
    head: input.head,
    mode: "merge",
  });
  try {
    execFileSync("git", ["commit", "--no-edit"], {
      cwd: input.repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPENCLINXR_INTEGRATING: "1" },
    });
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String((error as { stderr?: Buffer }).stderr) : "";
    throw new Error(`integrate: merge commit failed — ${detail.slice(0, 300)}`);
  }

  // Rebuild AFTER the commit: the sources are now on the branch, and a failure here is a stale
  // checkout rather than a reason to refuse a merge that already passed every gate.
  const rebuilt = rebuildTargets;
  for (const pkg of rebuilt) {
    try {
      execFileSync("pnpm", ["--filter", pkg, "build"], {
        cwd: input.repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const detail = error instanceof Error && "stderr" in error ? String((error as { stderr?: Buffer }).stderr) : "";
      throw new Error(
        `integrate: landed, but rebuilding ${pkg} FAILED — the checkout is stale and contracts will `
        + `fail against a dist/ that predates this merge. ${detail.slice(0, 300)}`,
      );
    }
  }

  const event: IntegrationEvent = {
    slice: input.slice,
    ...(rebuilt.length > 0 ? { rebuiltPackages: rebuilt } : {}),
    base: input.base,
    head: input.head,
    at: new Date().toISOString(),
  };
  recordEvent(input.repoRoot, event);
  return { killReport, landed: true, exitCode: 0, event };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const slice = flag("slice") ?? "unscoped";
  // Do not default --head to "". Empty head is not a default — it is a value that parses into a
  // forged-proof false positive (#84). Fail closed at the CLI boundary with the same message the
  // library throws so dry-run and live share one refusal path.
  const head = flag("head");
  try {
    assertIntegrateHeadUsable(head ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const result = integrate({
    repoRoot: process.cwd(),
    base: flag("base") ?? "HEAD",
    head: head!,
    slice,
    contract: contractForSlice(process.cwd(), slice, head),
    dryRun: args.includes("--dry-run"),
  });
  console.log(
    result.landed
      ? `landed ${result.event?.slice} (${result.killReport.changedFiles} files)`
      : `REFUSED — merge-kill fired:\n${result.killReport.findings.map((f) => `  - ${f.id}: ${f.title}`).join("\n")}`,
  );
  process.exit(result.exitCode);
}
