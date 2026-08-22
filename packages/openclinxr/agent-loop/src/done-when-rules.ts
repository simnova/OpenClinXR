import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { countPlantedItFails } from "./done-when-live.js";
import {
  type DoneWhenEvalOptions,
  loadBaseline,
  resolveExistsTargets,
  sha256File,
} from "./done-when-tree.js";
import type { DoneWhenCheck, HandoffStatus, SkepticVerdict, SliceHandoff } from "./slice-team.js";

export {
  type DoneWhenEvalOptions,
  SLICE_BASELINE_SCHEMA,
  type SliceBaselineHashes,
  writeBaselineHashes,
} from "./done-when-tree.js";

/**
 * `done_when` rule evaluation — the machine-checked half of a slice contract.
 *
 * Split out of slice-team.ts when adding `run:` and `changed:` pushed that file past its frozen
 * size ceiling, and split again into done-when-tree.ts when `measured-before:` (#177) pushed THIS
 * file past its ceiling. The ratchet's instruction is split, never raise. Rule kinds are the
 * surface most likely to keep growing as new proof types are needed; the tree + trusted-baseline
 * machinery they all read lives in done-when-tree.ts.
 *
 * Layer-3 merge-safety: tree proofs (`exists:`, `min-bytes:`, `run:`, `changed:`,
 * `measured-before:`) re-check the WORKTREE; baseline hashes live in a TRUSTED baselineDir the
 * worker cannot write. Narrative rules (`handoff:`, `skeptic:`, `handoffs:all-done`) are
 * self-reports — never a merge gate.
 */

/** Allowlisted binaries for `run:` — argv only, no shell. */
export const RUN_ALLOWED_BINARIES = ["pnpm", "node", "tsx", "git"] as const;

/**
 * Parse a `run:` command into argv. NO SHELL.
 *
 * Forbidding shell metacharacters means any proof that needs a pipe has to become a SCRIPT
 * COMMITTED TO GIT (reviewed code) instead of living in gitignored agent-authored JSON. That is
 * the real reason — more than the RCE surface — so an unattended loop cannot invent shell.
 */
export function parseRunArgv(command: string): { argv: string[] } | { error: string } {
  const forbidden: Array<{ char: string; label: string }> = [
    { char: ";", label: ";" },
    { char: "|", label: "|" },
    { char: "&", label: "&" },
    { char: "$", label: "$" },
    { char: "`", label: "backtick" },
    { char: ">", label: ">" },
    { char: "<", label: "<" },
    { char: "\n", label: "newline" },
    { char: "\r", label: "carriage return" },
  ];
  for (const { char, label } of forbidden) {
    if (command.includes(char)) {
      return { error: `run: forbids shell metacharacter '${label}' in command` };
    }
  }

  const argv: string[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && /\s/.test(command[i]!)) i += 1;
    if (i >= command.length) break;
    const quote = command[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      let value = "";
      while (i < command.length && command[i] !== quote) {
        value += command[i];
        i += 1;
      }
      if (i >= command.length) {
        return { error: `run: unclosed ${quote === '"' ? "double" : "single"} quote` };
      }
      i += 1; // closing quote
      argv.push(value);
      continue;
    }
    let value = "";
    while (i < command.length && !/\s/.test(command[i]!)) {
      value += command[i];
      i += 1;
    }
    argv.push(value);
  }

  if (argv.length === 0) {
    return { error: "run: empty command after parse" };
  }
  const binary = argv[0]!;
  if (!(RUN_ALLOWED_BINARIES as readonly string[]).includes(binary)) {
    return {
      error: `run: binary '${binary}' is not allowlisted (allowed: ${RUN_ALLOWED_BINARIES.join(", ")})`,
    };
  }
  return { argv };
}

/**
 * Which rules can be checked against a TREE vs which are self-reported coordination signals.
 *
 * `narrative` rules are self-reports written by the worker about itself. They are for team
 * sequencing ONLY and must never gate a merge — copying a self-assessment across a trust
 * boundary does not turn it into evidence.
 */
export function partitionDoneWhen(rules: string[]): {
  treeProofs: string[];
  narrative: string[];
  unknown: string[];
} {
  const treeProofs: string[] = [];
  const narrative: string[] = [];
  const unknown: string[] = [];
  for (const rule of rules) {
    if (
      rule.startsWith("exists:") ||
      rule.startsWith("min-bytes:") ||
      rule.startsWith("run:") ||
      rule.startsWith("changed:") ||
      rule.startsWith("measured-before:") ||
      rule.startsWith("live:")
    ) {
      treeProofs.push(rule);
    } else if (rule.startsWith("handoff:") || rule.startsWith("skeptic:") || rule === "handoffs:all-done") {
      narrative.push(rule);
    } else {
      unknown.push(rule);
    }
  }
  return { treeProofs, narrative, unknown };
}

/**
 * Evaluate one `done_when` rule.
 *
 * @param treeRoot - Tree under test: targets resolve here, `run:` executes here. Renamed from
 *   `repoRoot` because verification against a worktree is intentional; the trusted baseline
 *   lives separately via `options.baselineDir` so a worker cannot forge hashes in its own tree.
 * @param options.baselineDir - Trusted dir for baseline-hashes.json. When omitted, falls back
 *   to `<treeRoot>/.openclinxr/slices/<sliceId>` (legacy hand-run behaviour).
 */

/**
 * The rule vocabulary this module implements — the SINGLE source of truth.
 *
 * Exported because callers validate proofs before dispatch. A second hand-maintained copy drifted
 * within minutes of being written: it listed six prefixes and omitted `handoffs:all-done`, which is
 * matched EXACTLY rather than by prefix, so a legitimate proof was rejected. Anything that needs to
 * know which rules exist imports this; nobody re-lists it.
 */
export const DONE_WHEN_RULE_VOCABULARY = {
  prefixes: [
    "exists:",
    "min-bytes:",
    "run:",
    "changed:",
    "measured-before:",
    "live:",
    "handoff:",
    "skeptic:",
  ],
  exact: ["handoffs:all-done"],
} as const;

/** True when `rule` is something evaluateDoneWhenRule will actually evaluate. */
export function isKnownDoneWhenRule(rule: string): boolean {
  return (
    DONE_WHEN_RULE_VOCABULARY.exact.some((exact) => rule === exact) ||
    DONE_WHEN_RULE_VOCABULARY.prefixes.some((prefix) => rule.startsWith(prefix))
  );
}

export async function evaluateDoneWhenRule(
  treeRoot: string,
  rule: string,
  sliceId: string,
  handoffs: Record<string, SliceHandoff | null>,
  options?: DoneWhenEvalOptions,
): Promise<DoneWhenCheck> {
  if (rule.startsWith("exists:")) {
    const target = rule.slice("exists:".length).trim();
    const matches = await resolveExistsTargets(treeRoot, target);
    return {
      rule,
      passed: matches.length > 0,
      detail: matches.length > 0 ? `found ${matches.join(", ")}` : `missing ${target}`,
    };
  }

  if (rule.startsWith("min-bytes:")) {
    const [, target, minBytesRaw] = rule.split(":");
    if (!target || !minBytesRaw) {
      return { rule, passed: false, detail: "invalid min-bytes rule" };
    }
    const minBytes = Number(minBytesRaw);
    const matches = await resolveExistsTargets(treeRoot, target);
    if (matches.length === 0) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    const sizeInfos: Array<{ rel: string; size: number }> = matches.map((m) => ({
      rel: path.relative(treeRoot, m).replaceAll("\\", "/"),
      size: statSync(m).size,
    }));
    const allSufficient = sizeInfos.every((info) => info.size >= minBytes);
    const detail = sizeInfos.map((info) => `${info.rel} size=${info.size}`).join("; ") + ` min=${minBytes}`;
    return {
      rule,
      passed: allSufficient,
      detail,
    };
  }

  if (rule.startsWith("run:")) {
    // The proof kind that was missing when it mattered.
    //
    // A worker was told a concurrency proof was NON-NEGOTIABLE and shipped without one: its commit
    // was green, its report claimed success, and nothing mechanical noticed. `exists:` cannot
    // express "re-run the experiment"; only executing a command can. The ORCHESTRATOR runs it, so
    // the worker's narrative is not evidence.
    //
    // Layer-3: argv-only allowlisted binary via execFileSync — NOT execSync, NOT shell:true.
    // Agent-authored gitignored JSON must not become a shell RCE in the trusted plane.
    const command = rule.slice("run:".length).trim();
    if (!command) {
      return { rule, passed: false, detail: "invalid run rule (empty command)" };
    }
    const parsed = parseRunArgv(command);
    if ("error" in parsed) {
      return { rule, passed: false, detail: parsed.error };
    }
    try {
      execFileSync(parsed.argv[0]!, parsed.argv.slice(1), {
        cwd: treeRoot,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 900_000,
      });
      return { rule, passed: true, detail: `exited zero: ${command}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Fail CLOSED: a command that cannot be executed has not been satisfied.
      return { rule, passed: false, detail: `failed: ${command} — ${message.slice(0, 300)}` };
    }
  }

  if (rule.startsWith("changed:")) {
    // Presence is not production. `exists:` passes for a file that was already there before the
    // slice began, so a worker "satisfies" it by doing nothing. This requires the content to differ
    // from a baseline hash recorded when the slice opened.
    //
    // Hashing rather than mtime is deliberate: we learned from turbo that mtime is not a change
    // signal (`touch` never invalidated its cache), and an mtime check here would be satisfied by
    // opening a file and saving it unchanged.
    //
    // Layer-3 FAIL-CLOSED: absent/corrupt/stale baseline fails. baselineDir is the trusted plane
    // (H2: never read baseline from the worktree under test when the orchestrator split the roots).
    const target = rule.slice("changed:".length).trim();
    const baselineDir =
      options?.baselineDir ?? path.join(treeRoot, ".openclinxr", "slices", sliceId);
    const baselinePath = path.join(baselineDir, "baseline-hashes.json");
    const loaded = loadBaseline(baselinePath, rule);
    if (!loaded.ok) {
      return { rule, passed: false, detail: loaded.detail };
    }
    const matches = await resolveExistsTargets(treeRoot, target);
    if (matches.length === 0) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    const changed: string[] = [];
    const unchanged: string[] = [];
    for (const match of matches) {
      const rel = path.relative(treeRoot, match).replaceAll("\\", "/");
      const hash = sha256File(match);
      const prior = loaded.baseline.files[rel];
      // ABSENT from baseline.files (while the record exists) means the file did not exist when the
      // snapshot was taken — unambiguous evidence the worker created it. Do NOT treat absence as
      // "unchanged"; that would ban creating new files and make the rule worthless for greenfield.
      if (prior !== undefined && prior === hash) unchanged.push(rel);
      else changed.push(rel);
    }
    return {
      rule,
      passed: unchanged.length === 0 && changed.length > 0,
      detail:
        unchanged.length === 0
          ? `changed during this slice: ${changed.join(", ")}`
          : `unchanged since slice baseline (present before the work began): ${unchanged.join(", ")}`,
    };
  }

  if (rule.startsWith("measured-before:")) {
    // #177: `exists:` proves an artifact EXISTS and `changed:` proves a product file DIFFERS from
    // its spawn baseline — neither proves the artifact was written BEFORE the edit, which is the
    // whole value of a pre-fix measurement. #106's pre-fix artifact arrived after the resolver
    // already embodied the fix and every gate stayed green. Ordering is taken from the filesystem
    // (mtime), not from a self-declared timestamp inside the artifact — a self-declared timestamp
    // is the worker's own account of itself.
    //
    // Scope: ordering ONLY. An empty artifact written first satisfies it; compose `min-bytes:` for
    // substance. Not forgery-proof (`touch -t` backwards defeats it) — the failure mode it is
    // built for is an honest worker reconstructing a before-column after the fact (#106, #171).
    const parts = rule.split(":");
    const artifactGlob = parts[1]?.trim();
    const productGlob = parts[2]?.trim();
    if (parts.length !== 3 || !artifactGlob || !productGlob) {
      return {
        rule,
        passed: false,
        detail: "invalid measured-before rule (expected measured-before:<artifact>:<product>)",
      };
    }

    const artifactMatches = await resolveExistsTargets(treeRoot, artifactGlob);
    const artifactPath = artifactMatches[0];
    if (!artifactPath) {
      return { rule, passed: false, detail: `missing artifact ${artifactGlob}` };
    }

    const baselineDir =
      options?.baselineDir ?? path.join(treeRoot, ".openclinxr", "slices", sliceId);
    const baselinePath = path.join(baselineDir, "baseline-hashes.json");
    // `measured-before:` never appears in baseline.targets (see writeBaselineHashes), so the
    // exact-target staleness check is skipped for this kind; every other fail-closed validation
    // still applies, and an absent baseline still refuses.
    const loaded = loadBaseline(baselinePath, rule, { requireTarget: false });
    if (!loaded.ok) {
      return { rule, passed: false, detail: loaded.detail };
    }

    const productMatches = await resolveExistsTargets(treeRoot, productGlob);
    const changedProducts: Array<{ rel: string; mtimeMs: number }> = [];
    for (const match of productMatches) {
      const rel = path.relative(treeRoot, match).replaceAll("\\", "/");
      const hash = sha256File(match);
      const prior = loaded.baseline.files[rel];
      // Unchanged since spawn is not "the worker's edit"; absence from baseline.files (while the
      // record exists) is evidence the worker created it — same reading as `changed:`.
      if (prior !== undefined && prior === hash) continue;
      changedProducts.push({ rel, mtimeMs: statSync(match).mtimeMs });
    }
    if (changedProducts.length === 0) {
      return {
        rule,
        passed: false,
        detail: "no product file changed since the slice baseline — nothing for the artifact to precede",
      };
    }

    const artifactMtime = statSync(artifactPath).mtimeMs;
    const late = changedProducts.filter((p) => !(p.mtimeMs > artifactMtime));
    if (late.length > 0) {
      return {
        rule,
        passed: false,
        detail:
          `product files not strictly newer than the artifact: ${late.map((p) => `${p.rel} mtime=${p.mtimeMs}`).join(", ")}`,
      };
    }
    return {
      rule,
      passed: true,
      detail:
        `artifact ${path.relative(treeRoot, artifactPath).replaceAll("\\", "/")} precedes ${changedProducts.map((p) => p.rel).join(", ")}`,
    };
  }

  if (rule.startsWith("live:")) {
    // #570: a planted RED is `it.fails(...)`, and vitest counts an expected fail as a PASS — so
    // `run:<the plant>` exits 0 while the defect is still present. Measured on #569's third
    // attempt: "Tests 1 passed | 3 expected fail", exit code 0, contract-verify reported all
    // proofs green. Nine slices flipped their REDs anyway, so the proof held by diligence, not by
    // construction. `live:` closes that hole for the slice that OWNS the plant: zero remaining
    // planted markers in the named file.
    //
    // Deliberately NOT folded into `run:` (clause (4) of the #570 plant pins run:'s behaviour):
    // eleven legitimately-red plants sit on main waiting for their slice, and a run: that refused
    // expected-fails would make every one unlandable. Only a slice's own done_when knows its REDs.
    const target = rule.slice("live:".length).trim();
    if (!target) {
      return { rule, passed: false, detail: "invalid live rule (missing test file path)" };
    }
    const matches = await resolveExistsTargets(treeRoot, target);
    if (matches.length === 0) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    if (matches.length > 1) {
      return {
        rule,
        passed: false,
        detail: `ambiguous live target (${matches.length} files match): ${target}`,
      };
    }
    const rel = path.relative(treeRoot, matches[0] ?? "").replaceAll("\\", "/");
    const remaining = countPlantedItFails(readFileSync(matches[0] ?? "", "utf8"));
    return {
      rule,
      passed: remaining === 0,
      detail:
        remaining === 0
          ? `${rel} is live: no it.fails clauses remain`
          : `${rel} still has ${remaining} unflipped it.fails clause(s) — flip each to it() once its behaviour is fixed`,
    };
  }

  if (rule.startsWith("handoff:")) {
    const parts = rule.slice("handoff:".length).split(":");
    const roleId = parts[0]?.trim();
    const expectedStatus = (parts[1]?.trim() ?? "done") as HandoffStatus;
    if (!roleId) {
      return { rule, passed: false, detail: "missing role id" };
    }
    const handoff = handoffs[roleId];
    if (!handoff) {
      return { rule, passed: false, detail: `no handoff for ${roleId}` };
    }
    const passed = handoff.status === expectedStatus;
    return {
      rule,
      passed,
      detail: `${roleId} status=${handoff.status} expected=${expectedStatus}`,
    };
  }

  if (rule.startsWith("skeptic:")) {
    const expected = rule.slice("skeptic:".length).trim() as SkepticVerdict;
    const handoff = handoffs["productivity-skeptic"];
    const verdict = handoff?.skeptic_verdict ?? "pending";
    return {
      rule,
      passed: verdict === expected,
      detail: `skeptic_verdict=${verdict} expected=${expected}`,
    };
  }

  if (rule === "handoffs:all-done") {
    const pending = Object.entries(handoffs).filter(([, h]) => h?.status !== "done");
    return {
      rule,
      passed: pending.length === 0 && Object.keys(handoffs).length > 0,
      detail:
        pending.length === 0
          ? `all ${Object.keys(handoffs).length} handoffs done`
          : `pending: ${pending.map(([role]) => role).join(", ")}`,
    };
  }

  return {
    rule,
    passed: false,
    detail: `unsupported rule (slice ${sliceId})`,
  };
}
