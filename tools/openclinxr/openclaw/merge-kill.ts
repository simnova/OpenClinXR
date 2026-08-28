#!/usr/bin/env tsx
/**
 * Layer 5 merge kill — independent mechanical reviewer of DIFF + CLAIMED PROOFS.
 *
 * WHY THIS EXISTS: every prior failure shared one shape — a worker reported success and the
 * report was believed. A reviewer that reads the worker's narrative inherits that bug.
 *
 * This module judges only:
 *   (1) the git diff between base...head
 *   (2) the contract verification report (proofsOk + per-rule proofs)
 *
 * It never reads worker handoffs, commit prose as success claims, or chat status.
 * Deterministic only — no LLM. Where a criterion cannot be made mechanical, it is omitted
 * or emitted as warn/skipped, never silently degraded to pass.
 *
 * Incident classes behind each criterion:
 *   forbidden-class          — worker touched a path class the policy forbids
 *   added-suppression        — worker silenced the gate rather than fixing the code
 *   deleted-test             — worker removed the proof instead of making it green
 *   raised-ceiling           — worker widened a freeze ratchet (the classic escape hatch)
 *   empty-diff-with-passing-proofs — forged / no-op proof with nothing to verify
 *   contract-not-verified    — merge with no (or failing) contract verification
 *   hook-bypass-in-history   — --no-verify / OPENCLAW_SKIP_HOOKS in the branch history
 *   proof-file-gutted        — run: proof target lost assertion density (warn; hard to
 *                              distinguish gutting from legitimate refactors)
 *   gitignored-proof-target  — exists:/min-bytes: proof reads a gitignored target the branch
 *                              does not land (#217; clean clones cannot fail it for the right
 *                              reason, and force-add or the brief opt-out is the remediation)
 *   frozen-file-grown        — committed content put a SIZE_FREEZE file past its ceiling with
 *                              the freeze map untouched (#574/#587; the map defence cannot see
 *                              growth that never touched file-size-budgets.ts)
 */

import { execFileSync } from "node:child_process";
import { classifyDiff } from "./diff-class-policy.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

// ── Public types ─────────────────────────────────────────────────────────────

export type KillSeverity = "kill" | "warn" | "skipped";

export type KillFinding = {
  id: string;
  severity: KillSeverity;
  title: string;
  /** Concrete evidence: file, line, and the offending text. Never a summary. */
  evidence: { file: string; line?: number; excerpt: string }[];
  /** Why this is a kill — reference the incident class it comes from. */
  reason: string;
};

/** Injected by the orchestrator once layer 4 lands. Kept as a port so this module stays testable
 *  and so the two layers could be developed concurrently. */
export type ForbiddenPathClassifier = (paths: string[]) => {
  path: string;
  class: string;
  reason: string;
}[];

export type MergeKillInput = {
  repoRoot: string;
  base: string;
  head: string;
  /** Contract verification produced by layer 3, if any. */
  contract?: {
    proofsOk: boolean;
    proofs: { rule: string; passed: boolean; detail: string }[];
  } | null;
  classifyForbidden?: ForbiddenPathClassifier;
  /**
   * #217 opt-out: `exists:` / `min-bytes:` proof targets that are DELIBERATELY gitignored and
   * machine-local (capture trees, provider caches — a 639 MB capture directory must never be
   * force-added to satisfy a gate). Supplied by `integrate` from the trusted brief's
   * `gitignoredProofTargetsAllowed`. A target listed here is never refused by the
   * `gitignored-proof-target` criterion, which makes "this artifact is deliberately untracked"
   * a stated decision rather than an accident.
   */
  allowedGitignoredProofTargets?: string[];
};

export type MergeKillReport = {
  schemaVersion: "openclinxr.merge-kill.v1";
  base: string;
  head: string;
  changedFiles: number;
  findings: KillFinding[];
  killed: boolean;
  skippedChecks: string[];
  at: string;
};

// ── Git helpers ──────────────────────────────────────────────────────────────

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Like git(), but returns null on failure and never prints to the caller's stderr. */
function gitOk(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

export type NameStatusEntry = {
  status: string;
  path: string;
  /** Present for renames (Rxxx) and copies (Cxxx). */
  fromPath?: string;
};

/** Parse `git diff --name-status <base>...<head>`. */
export function parseNameStatus(raw: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      const fromPath = parts[1] ?? "";
      const toPath = parts[2] ?? "";
      if (toPath) entries.push({ status, path: toPath, fromPath });
    } else {
      const path = parts[1] ?? "";
      if (path) entries.push({ status, path });
    }
  }
  return entries;
}

export type AddedLine = {
  file: string;
  line: number;
  text: string;
};

/**
 * Parse ADDED lines only from `git diff --unified=0 <base>...<head>`.
 * Pre-existing content that is merely adjacent to a change is never included.
 */
export function parseAddedLines(raw: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file = "";
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // diff --git a/path b/path
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = match?.[2] ?? "";
      newLine = 0;
      continue;
    }
    if (line.startsWith("+++ ")) {
      // +++ b/path  (handles renames / new files; /dev/null is a delete)
      const path = line.slice(4).trim();
      if (path === "/dev/null") {
        file = "";
      } else if (path.startsWith("b/")) {
        file = path.slice(2);
      }
      continue;
    }
    if (line.startsWith("@@")) {
      // @@ -oldStart[,oldCount] +newStart[,newCount] @@
      const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
      newLine = hunk ? Number(hunk[1]) : 0;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push({ file, line: newLine, text: line.slice(1) });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      // deleted line — do not advance new-side line counter
      continue;
    }
    // context line (unified=0 rarely has them, but be correct)
    if (line.startsWith(" ") || line === "") {
      newLine += 1;
    }
  }
  return added;
}

// ── Freeze-map parsers ───────────────────────────────────────────────────────

const SIZE_FREEZE_PATH =
  "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts";
const REF_FREEZE_PATH =
  "packages/openclinxr/architecture-rules/src/checks/markdown-references.ts";

/**
 * Parse SIZE_FREEZE-style entries: `"path": { maxLines: N, ... }`
 * Keyed by the preceding quoted path.
 */
export function parseSizeFreezeCeilings(source: string): Map<string, number> {
  const map = new Map<string, number>();
  // Match "path": { ... maxLines: N ... } across short spans
  const re = /"([^"]+)"\s*:\s*\{[^}]*?maxLines\s*:\s*(\d+)/gs;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const key = match[1];
    const n = Number(match[2]);
    if (key !== undefined && Number.isFinite(n)) map.set(key, n);
  }
  return map;
}

/**
 * Parse BROKEN_REFERENCE_FREEZE-style entries: `"path": N,`
 * Only inside the freeze map object — we accept any top-level quoted path → integer.
 */
export function parseRefFreezeCeilings(source: string): Map<string, number> {
  const map = new Map<string, number>();
  const re = /"([^"]+)"\s*:\s*(\d+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const key = match[1];
    const n = Number(match[2]);
    if (key !== undefined && Number.isFinite(n)) map.set(key, n);
  }
  return map;
}

function loadFileAt(repoRoot: string, ref: string, path: string): string | null {
  return gitOk(repoRoot, ["show", `${ref}:${path}`]);
}

// ── Suppression patterns (built so test string constants need not match verbatim) ──

/** Tokens that silence gates. Built piecewise so this source is not itself a trigger. */
const SUPPRESSION_NEEDLES: string[] = [
  ["@", "ts-ignore"].join(""),
  ["@", "ts-expect-error"].join(""),
  ["eslint", "-disable"].join(""),
  ["biome", "-ignore"].join(""),
  ["OPENCLAW", "_SKIP_HOOKS"].join(""),
];

function lineIntroducesSuppression(text: string): string | null {
  for (const needle of SUPPRESSION_NEEDLES) {
    if (text.includes(needle)) return needle;
  }
  return null;
}

function isTestFileName(path: string): boolean {
  // *.test.* or *.spec.* anywhere in the basename/path segments
  return /\.(test|spec)\./.test(path);
}

// ── Individual kill criteria ─────────────────────────────────────────────────

function checkForbiddenClass(
  paths: string[],
  classifyForbidden: ForbiddenPathClassifier | undefined,
  skippedChecks: string[],
): KillFinding[] {
  if (!classifyForbidden) {
    skippedChecks.push(
      "forbidden-class: no classifyForbidden injected (layer 4 port absent) — not a pass",
    );
    return [];
  }
  const hits = classifyForbidden(paths);
  if (hits.length === 0) return [];
  return [
    {
      id: "forbidden-class",
      severity: "kill",
      title: "Diff touches a forbidden path class",
      evidence: hits.map((h) => ({
        file: h.path,
        excerpt: `class=${h.class}; ${h.reason}`,
      })),
      reason:
        "Incident class: worker edited a path class the merge policy forbids (layer-4 classifier).",
    },
  ];
}

/**
 * Suppressions only matter in executable / linted source. Report JSON, Markdown, and other
 * evidence files often *quote* the same tokens (this module's own CLI writes them into
 * `.openclinxr/openclaw/merge-kill-*.json`); killing on those is a self-trigger, not a crime.
 */
function isSourcePathForSuppression(path: string): boolean {
  if (path.includes("/merge-kill-") && path.endsWith(".json")) return false;
  return /\.(?:[cm]?[jt]sx?|py|sh|bash|zsh|mjs|cjs)$/.test(path);
}

function checkAddedSuppression(addedLines: AddedLine[]): KillFinding[] {
  const evidence: KillFinding["evidence"] = [];
  for (const line of addedLines) {
    if (!isSourcePathForSuppression(line.file)) continue;
    const needle = lineIntroducesSuppression(line.text);
    if (needle) {
      evidence.push({
        file: line.file,
        line: line.line,
        excerpt: line.text,
      });
    }
  }
  if (evidence.length === 0) return [];
  return [
    {
      id: "added-suppression",
      severity: "kill",
      title: "Added line introduces a gate suppression",
      evidence,
      reason:
        "Incident class: worker silenced the gate (@ts-ignore / eslint-disable / OPENCLAW_SKIP_HOOKS) instead of fixing the code. Only ADDED lines in source paths count — pre-existing suppressions and quoted tokens in report JSON are not this worker's crime.",
    },
  ];
}

function checkDeletedTest(entries: NameStatusEntry[]): KillFinding[] {
  const evidence: KillFinding["evidence"] = [];
  for (const entry of entries) {
    // Pure delete of a test file
    if (entry.status === "D" && isTestFileName(entry.path)) {
      evidence.push({
        file: entry.path,
        excerpt: `git status ${entry.status}: deleted test file`,
      });
      continue;
    }
    // Rename that takes a test file out of a test-file name (e.g. foo.test.ts → foo.ts)
    if (
      entry.status.startsWith("R") &&
      entry.fromPath &&
      isTestFileName(entry.fromPath) &&
      !isTestFileName(entry.path)
    ) {
      evidence.push({
        file: entry.path,
        excerpt: `renamed test out of test name: ${entry.fromPath} → ${entry.path}`,
      });
    }
  }
  if (evidence.length === 0) return [];
  return [
    {
      id: "deleted-test",
      severity: "kill",
      title: "Test file deleted or renamed out of test naming",
      evidence,
      reason:
        "Incident class: worker removed the proof (deleted *.test.* / *.spec.*, or renamed it out of a test name) instead of making it green.",
    },
  ];
}

function compareCeilings(
  before: Map<string, number>,
  after: Map<string, number>,
  freezeFile: string,
  kind: string,
): KillFinding["evidence"] {
  const evidence: KillFinding["evidence"] = [];
  for (const [key, afterVal] of after) {
    const beforeVal = before.get(key);
    if (beforeVal === undefined) {
      evidence.push({
        file: freezeFile,
        excerpt: `NEW ${kind} entry "${key}" = ${afterVal} (widens the gate; freeze maps are shrink-only)`,
      });
      continue;
    }
    if (afterVal > beforeVal) {
      evidence.push({
        file: freezeFile,
        excerpt: `RAISED ${kind} "${key}": ${beforeVal} → ${afterVal}`,
      });
    }
    // FALLS (afterVal < beforeVal) is fine — ratchet tightens
  }
  return evidence;
}

function checkRaisedCeiling(repoRoot: string, base: string, head: string): KillFinding[] {
  const evidence: KillFinding["evidence"] = [];

  const sizeBase = loadFileAt(repoRoot, base, SIZE_FREEZE_PATH);
  const sizeHead = loadFileAt(repoRoot, head, SIZE_FREEZE_PATH);
  if (sizeBase !== null && sizeHead !== null) {
    evidence.push(
      ...compareCeilings(
        parseSizeFreezeCeilings(sizeBase),
        parseSizeFreezeCeilings(sizeHead),
        SIZE_FREEZE_PATH,
        "maxLines",
      ),
    );
  }

  const refBase = loadFileAt(repoRoot, base, REF_FREEZE_PATH);
  const refHead = loadFileAt(repoRoot, head, REF_FREEZE_PATH);
  if (refBase !== null && refHead !== null) {
    evidence.push(
      ...compareCeilings(
        parseRefFreezeCeilings(refBase),
        parseRefFreezeCeilings(refHead),
        REF_FREEZE_PATH,
        "broken-ref-ceiling",
      ),
    );
  }

  if (evidence.length === 0) return [];
  return [
    {
      id: "raised-ceiling",
      severity: "kill",
      title: "Freeze-map ceiling raised or new entry added",
      evidence,
      reason:
        "Incident class: worker widened a shrink-only ratchet (raised maxLines / broken-ref ceiling, or added a new freeze entry). This is the repo's main defence and the classic escape hatch.",
    },
  ];
}

/**
 * frozen-file-grown — a SIZE_FREEZE file whose COMMITTED content at head exceeds its ceiling.
 *
 * #574/#587: `checkRaisedCeiling` defends the MAP (maxLines values), never the FILES it
 * governs. An orchestrator salvage-commit grew asset-registry/src/index.ts 2842 → 2850 against
 * a ceiling of 2843 with the freeze map untouched, and nothing refused it at integrate — the
 * next worker discovered it as a blocked commit. This criterion measures the files the map
 * governs, so the refusal lands on the actor who caused the growth, by name.
 *
 * Deliberate properties, pinned by the planted contract on #587:
 *   - The ceiling is read from the HEAD map (the tree being merged). Growing the file AND
 *     widening its entry in the same branch stays refused — by `raised-ceiling`, which
 *     compares base vs head maps. A raise must be its own dated, operator-authorised commit
 *     touching only file-size-budgets.ts; this criterion never fires on a map raise by itself.
 *   - The length is read from COMMITTED content via `git show <head>:<path>`, never the
 *     working tree (#361: a shared checkout's dirt must not fabricate reds or greens).
 *   - Thresholds are untouched: this measures compliance with ceilings, it does not move one.
 */
function checkFrozenFileGrown(repoRoot: string, head: string): KillFinding[] {
  const evidence: KillFinding["evidence"] = [];

  const sizeHead = loadFileAt(repoRoot, head, SIZE_FREEZE_PATH);
  if (sizeHead === null) return []; // no map at head — nothing to measure (mirrors raised-ceiling)
  const ceilings = parseSizeFreezeCeilings(sizeHead);

  for (const [path, maxLines] of ceilings) {
    const content = loadFileAt(repoRoot, head, path);
    if (content === null) continue; // deleted at head — deletion is not growth
    const measured = content.split("\n").length - 1;
    if (measured > maxLines) {
      evidence.push({
        file: path,
        excerpt: `${path} is ${measured} lines against its SIZE_FREEZE ceiling of ${maxLines}`,
      });
    }
  }

  if (evidence.length === 0) return [];
  return [
    {
      id: "frozen-file-grown",
      severity: "kill",
      title: "A SIZE_FREEZE file exceeds its ceiling at head",
      evidence,
      reason:
        "Incident class #574/#587: committed content grew a frozen file past its ceiling while "
        + "the freeze map was untouched, so raised-ceiling could not see it. The map defence "
        + "stays; this criterion is additive. Growing the file is never legal — a raise must be "
        + "its own dated, operator-authorised commit touching only file-size-budgets.ts.",
    },
  ];
}

function checkEmptyDiffWithPassingProofs(
  changedFiles: number,
  contract: MergeKillInput["contract"],
): KillFinding[] {
  if (!contract || contract.proofsOk !== true) return [];
  if (changedFiles !== 0) return [];
  return [
    {
      id: "empty-diff-with-passing-proofs",
      severity: "kill",
      title: "Empty diff claims passing proofs",
      evidence: [
        {
          file: "(contract)",
          excerpt: `proofsOk=true with changedFiles=0; proofs=${JSON.stringify(contract.proofs)}`,
        },
      ],
      reason:
        "Incident class: forged or no-op proof — contract reports green while the branch changes nothing.",
    },
  ];
}

function checkContractNotVerified(contract: MergeKillInput["contract"]): KillFinding[] {
  if (contract == null) {
    return [
      {
        id: "contract-not-verified",
        severity: "kill",
        title: "No contract verification attached",
        evidence: [
          {
            file: "(contract)",
            excerpt: "contract is null/absent — merge has no layer-3 verification",
          },
        ],
        reason:
          "Incident class: unverified merge. A merge with no contract verification is not neutral; it is unverified.",
      },
    ];
  }
  if (contract.proofsOk !== true) {
    const failed = contract.proofs.filter((p) => !p.passed);
    return [
      {
        id: "contract-not-verified",
        severity: "kill",
        title: "Contract proofsOk is false",
        evidence:
          failed.length > 0
            ? failed.map((p) => ({
                file: "(contract)",
                excerpt: `rule=${p.rule} passed=false detail=${p.detail}`,
              }))
            : [
                {
                  file: "(contract)",
                  excerpt: "proofsOk=false (no per-rule detail provided)",
                },
              ],
        reason:
          "Incident class: unverified merge. proofsOk=false means layer-3 verification failed.",
      },
    ];
  }
  return [];
}

function checkHookBypassInHistory(repoRoot: string, base: string, head: string): KillFinding[] {
  // Messages only between base and head (exclusive base, inclusive head).
  const log = gitOk(repoRoot, ["log", "--format=%H%n%B%n---COMMIT---", `${base}..${head}`]);
  if (log === null) return [];

  const bypassTokens = [
    ["--", "no-verify"].join(""),
    ["OPENCLAW", "_SKIP_HOOKS"].join(""),
  ];

  const evidence: KillFinding["evidence"] = [];
  const commits = log.split("---COMMIT---");
  for (const block of commits) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf("\n");
    const hash = nl === -1 ? trimmed : trimmed.slice(0, nl);
    const body = nl === -1 ? "" : trimmed.slice(nl + 1);
    for (const token of bypassTokens) {
      if (body.includes(token)) {
        // Quote a short excerpt around the token
        const idx = body.indexOf(token);
        const start = Math.max(0, idx - 40);
        const end = Math.min(body.length, idx + token.length + 40);
        const excerpt = body.slice(start, end).replace(/\s+/g, " ").trim();
        evidence.push({
          file: `(commit ${hash.slice(0, 12)})`,
          excerpt: `message/body contains ${token}: …${excerpt}…`,
        });
      }
    }
  }

  if (evidence.length === 0) return [];
  return [
    {
      id: "hook-bypass-in-history",
      severity: "kill",
      title: "Hook bypass token in commit history",
      evidence,
      reason:
        "Incident class: worker (or human) bypassed pre-commit hooks via --no-verify or OPENCLAW_SKIP_HOOKS. The history itself is evidence the gate was skipped.",
    },
  ];
}

const ASSERTION_LINE = /\bexpect\s*\(|\bassert(?:\s*\.|\s*\()|throw new\b/;

function countAssertionLines(source: string): number {
  let n = 0;
  for (const line of source.split("\n")) {
    if (ASSERTION_LINE.test(line)) n += 1;
  }
  return n;
}

/** Extract plausible file paths from a `run:` proof rule string. */
function extractPathsFromRunRule(rule: string): string[] {
  if (!rule.startsWith("run:")) return [];
  const command = rule.slice("run:".length);
  // Tokens that look like repo-relative source/test files
  const paths: string[] = [];
  const re = /(?:^|[\s"'`])([A-Za-z0-9_./-]+\.(?:test|spec)\.[A-Za-z0-9]+|[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mts|cts))(?=[\s"'`]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const p = match[1];
    if (p && !p.startsWith("-")) paths.push(p);
  }
  return paths;
}

/**
 * proof-file-gutted — WARN only.
 *
 * Detecting "gutted assertions" without false positives on legitimate refactors is hard:
 * moving expects into helpers, renaming assert helpers, or consolidating tests all look like
 * net loss of bare `expect(` lines. We still surface a net decrease as a warning so a human
 * (or a later, tighter criterion) can inspect — but we do not block the merge on it.
 */
function checkProofFileGutted(
  repoRoot: string,
  base: string,
  head: string,
  entries: NameStatusEntry[],
  contract: MergeKillInput["contract"],
): KillFinding[] {
  if (!contract?.proofs?.length) return [];

  const changed = new Set(
    entries
      .filter((e) => e.status === "M" || e.status.startsWith("R") || e.status === "A")
      .map((e) => e.path),
  );

  const evidence: KillFinding["evidence"] = [];
  for (const proof of contract.proofs) {
    const paths = extractPathsFromRunRule(proof.rule);
    for (const filePath of paths) {
      if (!changed.has(filePath)) continue;
      const before = loadFileAt(repoRoot, base, filePath);
      const after = loadFileAt(repoRoot, head, filePath);
      if (before === null || after === null) continue;
      const beforeCount = countAssertionLines(before);
      const afterCount = countAssertionLines(after);
      if (afterCount < beforeCount) {
        evidence.push({
          file: filePath,
          excerpt: `assertion-bearing lines ${beforeCount} → ${afterCount} (rule=${proof.rule})`,
        });
      }
    }
  }

  if (evidence.length === 0) return [];
  return [
    {
      id: "proof-file-gutted",
      severity: "warn",
      title: "run: proof target lost assertion-bearing lines",
      evidence,
      reason:
        "Incident class (warn): a file referenced by a run: proof lost expect(/assert/throw-new density. Legitimate refactors can look the same — hence warn, not kill. Honest warn beats a kill nobody trusts.",
    },
  ];
}

// ── Gitignored proof-target check (#217) ────────────────────────────────────

/**
 * Parse an `exists:` / `min-bytes:` proof rule into its target path, or null when the rule
 * is not one of those kinds or has no usable target.
 *
 * - `exists:<target>`       → everything after the prefix.
 * - `min-bytes:<target>:<N>` → everything between the first and last colon, so a target that
 *   itself contains a colon (legal on POSIX/macOS paths) survives the split.
 */
export function extractProofTarget(rule: string): string | null {
  if (rule.startsWith("exists:")) {
    const target = rule.slice("exists:".length).trim();
    return target || null;
  }
  if (rule.startsWith("min-bytes:")) {
    const rest = rule.slice("min-bytes:".length);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon <= 0) return null;
    const target = rest.slice(0, lastColon).trim();
    return target || null;
  }
  return null;
}

/** Glob → anchored RegExp, matching the evaluator's own globMatch semantics. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Deepest static directory prefix of a (possibly glob) target, for git probe commands.
 *
 * `git check-ignore` and `git ls-tree` need a concrete path; the glob itself is matched in
 * JS afterwards. `.openclinxr/evidence/issue-256/packs/*.png` → `.openclinxr/evidence/issue-256/packs/`.
 */
function staticProbePath(target: string): string {
  const star = target.indexOf("*");
  if (star === -1) return target;
  const head = target.slice(0, star);
  const lastSlash = head.lastIndexOf("/");
  return lastSlash === -1 ? "" : head.slice(0, lastSlash + 1);
}

export type GitignoredProofTargetEval = {
  target: string;
  gitignored: boolean;
  tracked: boolean;
  wouldRefuse: boolean;
};

/**
 * Is a proof target the #217 class — a file the proof reads that a CLEAN CLONE will not have?
 *
 * gitignored:  matches a .gitignore rule (`git check-ignore` exits 0). A force-added file is
 *              NOT reported as ignored, so tracked files never count as gitignored here.
 * tracked:     present in the POST-MERGE tree — i.e. tracked in `base` (main carries it through
 *              the merge) OR in `head` (this branch force-adds it, so the merge diff carries it).
 * wouldRefuse: gitignored && !tracked — the proof is green only where a machine-local file
 *              happens to exist, which is exactly the #215 shape: the tracked library GLB was
 *              present the whole time; only the catalog that described it was missing.
 */
export function evaluateGitignoredProofTarget(
  repoRoot: string,
  target: string,
  base: string,
  head: string,
): GitignoredProofTargetEval {
  // Absolute paths are not repo-relative proof targets; nothing to refuse.
  if (isAbsolute(target)) {
    return { target, gitignored: false, tracked: true, wouldRefuse: false };
  }

  const probe = staticProbePath(target);
  // A root-level glob (`*.json`) has no static directory to probe — treat as not-ignored;
  // gitignore rules that ignore files at the repo root cannot be evaluated per-target here.
  if (probe === "") {
    return { target, gitignored: false, tracked: true, wouldRefuse: false };
  }

  const ignored = gitOk(repoRoot, ["check-ignore", "-q", "--", probe]) !== null;

  // Absent ls-tree output means "not tracked in that ref". A null (command failure) is treated
  // as tracked to avoid double-faulting — the diff already threw on an unresolvable ref before
  // this check ever runs.
  const isTrackedIn = (ref: string): boolean => {
    if (probe === target && !target.includes("*")) {
      const raw = gitOk(repoRoot, ["ls-tree", "-r", "--name-only", ref, "--", probe]);
      return raw === null || raw.trim() !== "";
    }
    if (target.includes("*")) {
      const dir = probe || ".";
      const raw = gitOk(repoRoot, ["ls-tree", "-r", "--name-only", ref, "--", dir]);
      if (raw === null) return true;
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .some((line) => globToRegExp(target).test(line));
    }
    return true;
  };

  const tracked = isTrackedIn(base) || isTrackedIn(head);
  return { target, gitignored: ignored, tracked, wouldRefuse: ignored && !tracked };
}

/**
 * #217 / #64 class: a contract proof whose target is gitignored and absent from the merge diff
 * cannot fail for the right reason on a clean clone — it fails for a missing file instead, and
 * the failure message points at the product rather than the environment.
 *
 * Only `exists:` / `min-bytes:` rules are inspected — their whole meaning is that a file is
 * present. `run:` and `changed:` rules must never be refused here.
 */
export function checkGitignoredProofTarget(
  repoRoot: string,
  base: string,
  head: string,
  contract: MergeKillInput["contract"],
  allowed: string[],
): KillFinding[] {
  if (!contract?.proofs?.length) return [];
  const allowedSet = new Set(allowed ?? []);
  const evidence: KillFinding["evidence"] = [];

  for (const proof of contract.proofs) {
    if (!proof.rule.startsWith("exists:") && !proof.rule.startsWith("min-bytes:")) continue;
    const target = extractProofTarget(proof.rule);
    if (!target) continue;
    if (allowedSet.has(target)) continue;
    const evaluation = evaluateGitignoredProofTarget(repoRoot, target, base, head);
    if (!evaluation.wouldRefuse) continue;
    evidence.push({
      file: target,
      excerpt:
        `gitignored and tracked in neither base nor ${head} — a clean clone will not have it, `
        + `yet proof "${proof.rule}" reads it. Force-add the target or name it in the brief's `
        + `gitignoredProofTargetsAllowed before landing.`,
    });
  }

  if (evidence.length === 0) return [];
  return [
    {
      id: "gitignored-proof-target",
      severity: "kill",
      title: "Proof reads a gitignored target the branch does not land",
      evidence,
      reason:
        "Incident class #217/#64: a proof under a gitignored path has no reproducibility. The "
        + "proof is green only where a machine-local file happens to exist, and fails on a clean "
        + "clone for the wrong reason. Remediation is one line (force-add), or the deliberate-"
        + "untracked opt-out in the brief.",
    },
  ];
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export function runMergeKill(input: MergeKillInput): MergeKillReport {
  const { repoRoot, base, head, contract, classifyForbidden } = input;
  const skippedChecks: string[] = [];
  const findings: KillFinding[] = [];

  const nameStatusRaw = git(repoRoot, ["diff", "--name-status", `${base}...${head}`]);
  const entries = parseNameStatus(nameStatusRaw);
  const changedFiles = entries.length;

  const unifiedRaw = git(repoRoot, ["diff", "--unified=0", `${base}...${head}`]);
  const addedLines = parseAddedLines(unifiedRaw);

  const paths = entries.map((e) => e.path);

  findings.push(...checkForbiddenClass(paths, classifyForbidden, skippedChecks));
  findings.push(...checkAddedSuppression(addedLines));
  findings.push(...checkDeletedTest(entries));
  findings.push(...checkRaisedCeiling(repoRoot, base, head));
  findings.push(...checkFrozenFileGrown(repoRoot, head));
  findings.push(...checkEmptyDiffWithPassingProofs(changedFiles, contract));
  findings.push(...checkContractNotVerified(contract));
  findings.push(...checkHookBypassInHistory(repoRoot, base, head));
  findings.push(...checkProofFileGutted(repoRoot, base, head, entries, contract));
  findings.push(
    ...checkGitignoredProofTarget(
      repoRoot,
      base,
      head,
      contract,
      input.allowedGitignoredProofTargets ?? [],
    ),
  );

  const killed = findings.some((f) => f.severity === "kill");

  return {
    schemaVersion: "openclinxr.merge-kill.v1",
    base,
    head,
    changedFiles,
    findings,
    killed,
    skippedChecks,
    at: new Date().toISOString(),
  };
}

export function formatMergeKillReport(r: MergeKillReport): string {
  const lines: string[] = [];
  lines.push("Merge kill report");
  lines.push(`  schema        ${r.schemaVersion}`);
  lines.push(`  base...head   ${r.base}...${r.head}`);
  lines.push(`  changedFiles  ${r.changedFiles}`);
  lines.push(`  killed        ${r.killed}`);
  lines.push(`  at            ${r.at}`);

  if (r.skippedChecks.length > 0) {
    lines.push("  skippedChecks:");
    for (const s of r.skippedChecks) {
      lines.push(`    - ${s}`);
    }
  } else {
    lines.push("  skippedChecks: (none)");
  }

  const kills = r.findings.filter((f) => f.severity === "kill");
  const warns = r.findings.filter((f) => f.severity === "warn");
  const other = r.findings.filter((f) => f.severity !== "kill" && f.severity !== "warn");

  if (kills.length === 0) {
    lines.push("  KILL findings: (none)");
  } else {
    lines.push(`  KILL findings (${kills.length}):`);
    for (const f of kills) {
      // A report that hides a kill is worse than no report — always name id + title.
      lines.push(`    [KILL] ${f.id}: ${f.title}`);
      lines.push(`      reason: ${f.reason}`);
      for (const e of f.evidence) {
        const loc = e.line !== undefined ? `${e.file}:${e.line}` : e.file;
        lines.push(`      evidence: ${loc}`);
        lines.push(`        ${e.excerpt}`);
      }
    }
  }

  if (warns.length > 0) {
    lines.push(`  WARN findings (${warns.length}):`);
    for (const f of warns) {
      lines.push(`    [WARN] ${f.id}: ${f.title}`);
      lines.push(`      reason: ${f.reason}`);
      for (const e of f.evidence) {
        const loc = e.line !== undefined ? `${e.file}:${e.line}` : e.file;
        lines.push(`      evidence: ${loc}`);
        lines.push(`        ${e.excerpt}`);
      }
    }
  }

  if (other.length > 0) {
    lines.push(`  OTHER findings (${other.length}):`);
    for (const f of other) {
      lines.push(`    [${f.severity.toUpperCase()}] ${f.id}: ${f.title}`);
    }
  }

  // Explicit checklist of criteria that ran so a clean report is not an empty shrug.
  lines.push("  criteria evaluated:");
  const evaluatedIds = [
    "forbidden-class",
    "added-suppression",
    "deleted-test",
    "raised-ceiling",
    "frozen-file-grown",
    "empty-diff-with-passing-proofs",
    "contract-not-verified",
    "hook-bypass-in-history",
    "proof-file-gutted",
    "gitignored-proof-target",
  ];
  for (const id of evaluatedIds) {
    const finding = r.findings.find((f) => f.id === id);
    const skipped = r.skippedChecks.some((s) => s.startsWith(`${id}:`));
    if (skipped) {
      lines.push(`    - ${id}: SKIPPED`);
    } else if (finding) {
      lines.push(`    - ${id}: ${finding.severity.toUpperCase()}`);
    } else {
      lines.push(`    - ${id}: clean`);
    }
  }

  if (r.killed) {
    lines.push("  VERDICT: KILL — merge blocked");
  } else {
    lines.push("  VERDICT: pass (no kill findings)");
  }

  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  base: string;
  head: string;
  contractPath?: string;
  json: boolean;
} {
  let base = "";
  let head = "";
  let contractPath: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base") {
      base = argv[++i] ?? "";
    } else if (a === "--head") {
      head = argv[++i] ?? "";
    } else if (a === "--contract") {
      contractPath = argv[++i];
    } else if (a === "--json") {
      json = true;
    }
  }
  if (!base || !head) {
    throw new Error(
      "usage: merge-kill.ts --base <ref> --head <ref> [--contract <path>] [--json]",
    );
  }
  return { base, head, contractPath, json };
}

function sanitiseRef(ref: string): string {
  return ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "head";
}

function loadContractFromPath(
  path: string,
): NonNullable<MergeKillInput["contract"]> | null {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as {
    proofsOk?: boolean;
    proofs?: { rule: string; passed: boolean; detail: string }[];
  };
  if (typeof parsed.proofsOk !== "boolean") {
    throw new Error(`contract file missing proofsOk: ${path}`);
  }
  return {
    proofsOk: parsed.proofsOk,
    proofs: Array.isArray(parsed.proofs) ? parsed.proofs : [],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const contract = args.contractPath
      ? loadContractFromPath(args.contractPath)
      : null;
    const report = runMergeKill({
      repoRoot,
      base: args.base,
      head: args.head,
      contract,
      /**
       * Compose layer 4 into layer 5. The port exists so the two layers could be built
       * concurrently, but leaving it unwired would keep `forbidden-class` permanently SKIPPED —
       * an unwired check is the same decoration problem the tripwire was built to end. The
       * classifier stays injected rather than imported at module scope so the kill logic remains
       * unit-testable without the policy table.
       */
      classifyForbidden: (paths) => classifyDiff(paths).forbidden,
    });
    const formatted = formatMergeKillReport(report);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatted);
    }

    const outDir = join(repoRoot, ".openclinxr", "openclaw");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `merge-kill-${sanitiseRef(args.head)}.json`);
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(`wrote ${outPath}`);

    process.exit(report.killed ? 2 : 0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
