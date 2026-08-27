#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { acquireIntegrationLock, releaseIntegrationLock } from "./integration-lock.js";
import { dirname, join } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";
import { loadTrustedBrief, readSessions, trustedSliceDir } from "./dispatch-worker.js";
import {
  DEFAULT_BOARD_REPO,
  defaultGhRunner,
  resolveIssueNumberForSlice,
  setFactoryField,
  stripAnsi,
  type GhCommandRunner,
} from "./board-cli.js";
import { stagedTreeHash, writeGateReport } from "./integrate-gate.js";
import { runMergeKill, type KillFinding, type MergeKillReport } from "./merge-kill.js";
import { parseRunArgv } from "../../../packages/openclinxr/agent-loop/src/done-when-rules.js";

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
  /** Test seam for the worker-comment check and the Landed board write. */
  ghRunner?: GhCommandRunner;
};

export type IntegrationEvent = {
  slice: string;
  /** Build-emitting packages rebuilt after the merge (#152 / #196). */
  rebuiltPackages?: string[];
  /**
   * #717: each `run:` proof re-executed against the MERGED tree, after the rebuild. Durable because
   * a slice can pass on the worker's tree and fail on main (#712, a gitignored measurement
   * artifact), and without this the ledger records only what the candidate tree showed.
   */
  postMergeProofs?: Array<{ rule: string; ok: boolean; detail: string }>;
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
 *
 * Discovery delegates the ORDER to `orderPackagesForRebuild` (#292): rebuilding the right packages
 * in the WRONG order is the same stale-checkout class of bug. Measured on the #291 land, the
 * consumer `@openclinxr/scenario-fixtures` was rebuilt before its dependency
 * `@openclinxr/shared-schemas`, against a `dist/` that predated the new `ActorPhenotypeSchema`
 * field, and `tsgo` failed with `TS2353: 'phenotype' does not exist in type` — which reads like a
 * bad fixture when the fixture was correct and the type it was checked against was stale.
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
  return orderPackagesForRebuild([...names], repoRoot);
}

/**
 * #292: order a changed set of build-emitting packages for rebuild in DEPENDENCY order.
 *
 * #152/#196 established that the land path must rebuild; nothing established WHAT ORDER. The merge
 * succeeded and the rebuild then failed on the #291 land because `scenario-fixtures` (the consumer)
 * was built before `shared-schemas` (its dependency). Alphabetical order is not an approximation of
 * topological order: measured across the workspace there are 27 build-emitting packages and 48
 * intra-workspace dependency edges, of which 5+ are ordered wrongly by ascending sort and 8+ by
 * descending sort.
 *
 * This is a pure function over package names — no git ref required — so it is testable in isolation
 * (`tools/openclinxr/evidence/integrate-rebuild-order.test.ts`). It topologically sorts the names
 * using declared `workspace:*` dependencies restricted to the changed set. A dependency cycle
 * REFUSES loudly rather than falling back to alphabetical order, because alphabetical is exactly the
 * ordering that left main un-buildable. Unknown names (no manifest found) are kept in input order:
 * their edges cannot be seen, so they are unconstrained.
 */
export function orderPackagesForRebuild(names: string[], repoRoot: string): string[] {
  const set = new Set(names);
  const manifests = workspacePackageManifests(repoRoot);

  const inSetDeps = (name: string): string[] => {
    const manifest = manifests.get(name);
    if (manifest === undefined) return [];
    return manifest.workspaceDeps.filter((dep) => set.has(dep));
  };

  const result: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    if (done.has(name)) return;
    if (onStack.has(name)) {
      const cycleStart = stack.indexOf(name);
      const cycle = [...stack.slice(cycleStart), name];
      throw new Error(
        `integrate: cannot order rebuild for ${JSON.stringify(names)} — dependency cycle among `
        + `changed packages: ${cycle.join(" -> ")}. Refusing to build rather than falling back to `
        + `alphabetical order, which is exactly the ordering that left main un-buildable (#292).`,
      );
    }
    onStack.add(name);
    stack.push(name);
    for (const dep of inSetDeps(name)) visit(dep);
    stack.pop();
    onStack.delete(name);
    done.add(name);
    result.push(name);
  };

  for (const name of names) visit(name);
  return result;
}

/**
 * Map every workspace package name to its declared `workspace:*` dependencies, scanning
 * `packages/**` up to three levels deep (`packages/<group>/<pkg>` and the nested
 * `packages/openclinxr/arena/<pkg>`). Packages that do not name themselves are skipped.
 */
function workspacePackageManifests(repoRoot: string): Map<string, { workspaceDeps: string[] }> {
  const manifests = new Map<string, { workspaceDeps: string[] }>();
  const packagesRoot = join(repoRoot, "packages");
  if (!existsSync(packagesRoot)) return manifests;

  const collect = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (depth > 0) {
        const manifestPath = join(child, "package.json");
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
              name?: string;
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            if (manifest.name) {
              manifests.set(manifest.name, {
                workspaceDeps: Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
                  .filter(([, version]) => version === "workspace:*")
                  .map(([depName]) => depName),
              });
            }
          } catch {
            // An unreadable manifest is not this function's problem to report.
          }
        }
        collect(child, depth - 1);
      }
    }
  };

  collect(packagesRoot, 3);
  return manifests;
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

/**
 * Worker-voice markers (worker-directives.ts): `UNABLE:` and a proof that cannot pass as written
 * are the #448 failure reports the gate exists to surface, and `Factory: Dispatched` is the
 * worker's own dispatch status line (integrate.test.ts). `Factory: Landed` is deliberately NOT a
 * marker — it is the board FIELD write that fires when a card changes stage, and a stage change
 * says nothing about whether anyone reported (issue #484).
 */
const WORKER_REPORT_MARKERS = /(UNABLE:|cannot pass|Factory: Dispatched)/i;

/**
 * The dispatch contract's report skeleton: IN-SCOPE:, OUT-OF-SCOPE:, CLAIM: and NOT TESTED: in
 * one comment. Recognising the full skeleton is what lets a clean slice's report satisfy the
 * gate — the #483 case — while the orchestrator's own close comments stay refused: they can
 * carry a CLAIM:/NOT TESTED: pair (the #441-#446 state), so two sections alone are deliberately
 * insufficient.
 */
const WORKER_REPORT_SECTIONS = [/IN-SCOPE:/i, /OUT-OF-SCOPE:/i, /CLAIM:/i, /NOT TESTED:/i];
const isWorkerReport = (body: string): boolean => WORKER_REPORT_SECTIONS.every((r) => r.test(body));

/**
 * ISSUE #448 — a landing whose worker never spoke is refused.
 *
 * All seven slices #441-#447 landed with the worker mute: every comment on #441-#446 was the
 * orchestrator's and #447 had none. integrate() never looked at the issue, so silence was
 * invisible. The stricter reading of "the worker spoke" is implemented as: a comment authored by
 * a login OTHER than the orchestrator's (the moment a worker account exists, that clause binds),
 * OR a comment body carrying the worker directive's markers (UNABLE: / "cannot pass" /
 * "Factory: Dispatched") OR the IN-SCOPE/OUT-OF-SCOPE/CLAIM/NOT TESTED report skeleton (issue
 * #484 — a clean slice's report contains no failure keyword). Under the current single-account
 * setup (everything runs as one login) the author clause is inoperative, so the operative clauses
 * are the marker match and the report skeleton — which still refuse the orchestrator-only state
 * of #441-#446 and are strictly stronger than "any comment at all". Slices with no board card
 * have nothing to check and pass with a recorded warning.
 */
export function assertWorkerReported(
  repoRoot: string,
  slice: string,
  runner: GhCommandRunner = defaultGhRunner,
): KillFinding | null {
  const issueNumber = resolveIssueNumberForSlice(repoRoot, slice);
  if (issueNumber === null) {
    console.warn(
      `integrate: slice '${slice}' has no board card (no board record, not issue-<n>) — worker-comment check skipped`,
    );
    return null;
  }

  const repo = DEFAULT_BOARD_REPO;

  /**
   * ONE round trip for both the comments and the viewer login.
   *
   * This previously made TWO calls — `gh issue view --json comments` then `gh api user -q .login` —
   * on every worker-comment check, against a GraphQL budget shared by every agent on the account.
   *
   * The login is deliberately NOT cached, unlike project/field identifiers. A stale identifier fails
   * LOUDLY when GitHub rejects a write; a stale login fails SILENTLY by misattributing who spoke,
   * which would let this gate credit an orchestrator comment as the worker's and pass a mute worker.
   * Fetching it in the same query costs nothing and keeps it exact.
   */
  const combined = stripAnsi(runner([
    "gh", "api", "graphql",
    "-f", `query=query($owner:String!,$repo:String!,$num:Int!){viewer{login} repository(owner:$owner,name:$repo){issue(number:$num){comments(first:100){nodes{author{login} body}}}}}`,
    "-f", `owner=${repo.split("/")[0]}`,
    "-f", `repo=${repo.split("/")[1]}`,
    "-F", `num=${issueNumber}`,
  ]));
  let comments: Array<{ author?: { login?: string } | null; body?: string }>;
  let viewerLogin = "";
  try {
    const parsed = JSON.parse(combined) as {
      data?: {
        viewer?: { login?: string };
        repository?: { issue?: { comments?: { nodes?: Array<{ author?: { login?: string } | null; body?: string }> } } };
      };
    };
    comments = parsed.data?.repository?.issue?.comments?.nodes ?? [];
    viewerLogin = parsed.data?.viewer?.login ?? "";
  } catch {
    throw new Error(
      `integrate: could not parse comments for issue #${issueNumber} from gh: ${combined.slice(0, 200)}`,
    );
  }
  /**
   * The login came back with the comments above. Fall back to the separate call only if the
   * combined query did not carry it — a missing login must not silently become "" and match every
   * author, which would make `workerSpoke` true for orchestrator-only comments and pass a mute
   * worker. The fallback keeps the gate exact rather than convenient.
   */
  const orchestratorLogin = viewerLogin || runner(["gh", "api", "user", "-q", ".login"]).trim();

  const workerSpoke = comments.some(
    (comment) =>
      (comment.author?.login !== undefined && comment.author.login !== orchestratorLogin)
      || WORKER_REPORT_MARKERS.test(comment.body ?? "")
      || isWorkerReport(comment.body ?? ""),
  );
  if (workerSpoke) return null;

  return {
    id: "worker-never-spoke",
    severity: "kill",
    title: `worker never spoke on issue #${issueNumber}`,
    evidence: [
      {
        file: `https://github.com/${repo}/issues/${issueNumber}`,
        excerpt:
          `${comments.length} comment(s); none carry a worker report marker `
          + `(UNABLE: / "cannot pass" / "Factory: Dispatched") or the `
          + `IN-SCOPE/OUT-OF-SCOPE/CLAIM/NOT TESTED report skeleton, and none are authored `
          + `outside ${orchestratorLogin}`,
      },
    ],
    reason:
      `integrate refuses a landing whose worker never commented on its own card (issue #448). `
      + `The worker status directive requires a card comment; all ${comments.length} comment(s) are `
      + `orchestrator bookkeeping. A mute worker hides UNABLE: and unpassable-proof reports from the lead.`,
  };
}

/** Record the card's Factory stage on the board after a successful land (issue #448). */
function markFactoryLanded(repoRoot: string, slice: string, runner: GhCommandRunner): void {
  try {
    const landed = setFactoryField(repoRoot, slice, "Landed", { runner });
    if (!landed.ok && landed.skipped) {
      console.warn(
        `integrate: slice '${slice}' has no board card (no board record, not issue-<n>) — Factory stays unset`,
      );
    }
  } catch (error) {
    // The merge is already committed to main — refusing after the fact cannot un-commit it, and the
    // integration event file is the durable land record. A stale board row is a loud warning, not
    // a failed land (decision recorded in the #448 commit).
    console.error(
      `WARNING (issue #448): landed, but marking Factory=Landed failed: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

  // ISSUE #448: a worker that never spoke must not land — silence hides UNABLE: and
  // unpassable-proof reports. Runs after merge-kill so the refusal report carries the real tree
  // findings too, and before the dry-run early return so dry-run evaluates it as well.
  const workerFinding = assertWorkerReported(input.repoRoot, input.slice, input.ghRunner);
  if (workerFinding) {
    const report: MergeKillReport = {
      ...killReport,
      findings: [...killReport.findings, workerFinding],
      killed: true,
    };
    return { killReport: report, landed: false, exitCode: 2 };
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

  /**
   * ATOMIC INTEGRATION LOCK (#657 concurrency). Everything below mutates the SHARED main checkout:
   * `git merge --no-ff --no-commit`, the gate report, the merge commit, the rebuild, the event.
   * Two orchestrators worked this board on 2026-08-25 and main moved twice inside one iteration.
   *
   * `Factory=Dispatched` does not prevent this — `setFactoryField` writes unconditionally with no
   * expected-stage compare-and-set, so it is telemetry, not ownership. The automation lease does not
   * either: it permits disjoint slices by design and acquires via a read-modify-write.
   */
  const lockOwner = `integrate:${input.slice ?? input.head}:${process.pid}`;
  const lock = acquireIntegrationLock(input.repoRoot, lockOwner);
  if (!lock.acquired) {
    throw new Error(
      `integrate: REFUSED — another integrator holds the lock (${lock.heldBy}). `
      + "Landing onto a main that is moving underneath you can merge a candidate whose contract was "
      + "verified against a different base. Wait for it, or clear "
      + ".openclinxr/openclaw/integration.lock if that holder is known dead.",
    );
  }
  if (lock.stoleFrom !== undefined) {
    process.stderr.write(`integrate: took over a stale integration lock from ${lock.stoleFrom}\n`);
  }
  try {
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

    // #717: the candidate tree can hold files main will never receive (#712: a gitignored
    // measurement artifact). Re-run the run: proofs against the MERGED, REBUILT checkout — after
    // the rebuild above, or this would measure a stale dist. Reports; never reverts (#448).
    let postMergeProofs: Array<{ rule: string; ok: boolean; detail: string }> = [];
    try {
      postMergeProofs = rerunTreeProofsAfterMerge(
        input.repoRoot,
        killReport.contract?.proofs ?? [],
        input.slice,
      );
    } catch (error) {
      console.warn(
        `integrate: #717 post-merge proof re-run could not complete — ${String(error).slice(0, 200)}`,
      );
    }
    const postMergeFailures = postMergeProofs.filter((v) => !v.ok);
    if (postMergeFailures.length > 0) {
      console.warn(
        [
          "",
          `WARNING (#717): ${input.slice} LANDED but ${postMergeFailures.length} of its run: proof(s)`,
          "FAIL against the merged tree. They passed against the worker's tree, so the slice depends",
          "on something main did not receive — an untracked artifact is the measured cause (#712).",
          ...postMergeFailures.map((v) => `  - ${v.rule}: ${v.detail.slice(0, 200)}`),
          "The land is already committed; fix forward or revert deliberately.",
          "",
        ].join("\n"),
      );
    }

    const event: IntegrationEvent = {
      slice: input.slice,
      ...(rebuilt.length > 0 ? { rebuiltPackages: rebuilt } : {}),
      base: input.base,
      head: input.head,
      at: new Date().toISOString(),
      ...(postMergeProofs.length > 0 ? { postMergeProofs } : {}),
    };
    recordEvent(input.repoRoot, event);
    // ISSUE #448: integrator (machine) marks the card Landed. Failure is a loud warning, not a
    // refusal — the land is already committed; the integration event above is the durable record.
    markFactoryLanded(input.repoRoot, input.slice, input.ghRunner ?? defaultGhRunner);
    return { killReport, landed: true, exitCode: 0, event };
  } finally {
    releaseIntegrationLock(input.repoRoot, lockOwner);
  }
}

/**
 * #717: re-run a landed slice's `run:` proofs against the MERGED tree.
 *
 * WHY THIS EXISTS. contract-verify-cli re-runs proofs against the CANDIDATE tree — the worker's
 * worktree — and that tree can contain files main will never receive. #712 landed contract-green
 * and three clauses went red on main within a minute, because its measurement lived at a
 * gitignored path and only the test and the CLI crossed the merge.
 *
 * WHY NOT A STATIC SCAN. proof-target-preflight already covers `exists:`/`min-bytes:` TARGETS, and
 * deliberately does not read `run:` rules: #712's targets were tracked test files and the untracked
 * dependency was inside the test body. Widening that scan to `run:` would false-positive on the 31
 * evidence tests that name an absent artifact they regenerate themselves. Re-executing the proof
 * asks the real question and cannot false-positive.
 *
 * SYNCHRONOUS ON PURPOSE. `integrate()` is sync and has a dozen call sites on the LAND PATH;
 * making it async to reach the async `evaluateDoneWhenRule` is a wider change than this buys. It
 * reuses `parseRunArgv` instead — the proven parser, including its RUN_ALLOWED_BINARIES allow-list
 * and its no-shell rule — so the security-relevant half is shared rather than reimplemented.
 * Non-`run:` rules are skipped: their targets are already covered by proof-target-preflight.
 *
 * REPORTS, NEVER REVERTS. Per #448 a post-commit failure is a loud warning — the land is already
 * committed and the integration event is the durable record. Auto-reverting a merge is a human
 * decision this function does not make.
 */
export function rerunTreeProofsAfterMerge(
  repoRoot: string,
  proofs: readonly string[],
  sliceId: string,
): Array<{ rule: string; ok: boolean; detail: string }> {
  void sliceId;
  const verdicts: Array<{ rule: string; ok: boolean; detail: string }> = [];
  for (const rule of proofs) {
    if (!rule.startsWith("run:")) continue;
    const parsed = parseRunArgv(rule.slice("run:".length).trim());
    if ("error" in parsed) {
      verdicts.push({ rule, ok: false, detail: parsed.error });
      continue;
    }
    const [bin, ...args] = parsed.argv;
    if (!bin) {
      verdicts.push({ rule, ok: false, detail: "empty run: command" });
      continue;
    }
    try {
      execFileSync(bin, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
      verdicts.push({ rule, ok: true, detail: "exited zero against the merged tree" });
    } catch (error) {
      const stderr =
        error instanceof Error && "stderr" in error
          ? String((error as { stderr?: Buffer }).stderr ?? "")
          : "";
      verdicts.push({ rule, ok: false, detail: `non-zero against the merged tree: ${stderr.slice(0, 300)}` });
    }
  }
  return verdicts;
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
