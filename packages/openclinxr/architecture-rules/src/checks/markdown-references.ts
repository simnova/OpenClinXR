import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Markdown reference resolution — a shrink-only ratchet.
 *
 * WHY THIS EXISTS: on 2026-08-05 a documentation purge removed ~50 files and left every pointer to
 * them in place — including tombstone stubs referenced from two PROTECTED policy documents, and a
 * file cited by MADR 0029 as the authoritative ledger for that decision. `docs:drift-check` and
 * `agent:alignment` were BOTH GREEN throughout, because they verify that Markdown is registered and
 * present, never that a reference RESOLVES. A dead pointer is worse than a stale document: the
 * stale one still tells you something, the dead one sends the next reader (or agent) nowhere.
 *
 * This is deliberately a ratchet rather than a clean gate. There are pre-existing unresolved
 * references (renamed rule files, cross-repo pointers). Demanding zero would mean either a huge
 * unrelated cleanup or an exemption nobody honours. Instead each file's count may only SHRINK — so
 * existing rot is visible and fixable, while NEW rot fails immediately. That is exactly the case
 * the purge produced: it did not invent broken files, it raised the count in files that already
 * had some.
 */

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 12; index += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const workspaceRoot = findWorkspaceRoot();

/** Markdown link: [text](path.md) */
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s#]+\.md)[^)]*\)/g;
/** Backticked path — requires a slash, so bare filenames in prose are not treated as links. */
const BACKTICKED_PATH = /`([^`\s]*\/[^`\s]*\.md)`/g;

/**
 * Also skip GITIGNORED local state. `.openclinxr/` holds slice archives, ledgers and reports that
 * exist on one machine and not another, so scanning them makes this gate depend on local state: it
 * fired for a contributor who happened to have an archived snapshot on disk, and could not fire for
 * anyone else. A rule whose result varies by machine is not a rule.
 */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".openclinxr",
  ".openclinxr-local",
  // AGENT WORKTREES — `.claude/worktrees/`, `.grok/worktrees/`. The paragraph above already gives
  // the reason and this is the same case: they are gitignored (.gitignore:50), they exist on one
  // machine and not another, and their contents are a SNAPSHOT of the repo taken whenever an agent
  // branched. Scanning them makes the gate report every reference that was unresolved at branch
  // time, forever, for as long as that worktree sits on disk.
  //
  // Measured 2026-08-30: nine failures, EIGHT of them prefixed `.claude/worktrees/agent-…`, which
  // buried the one real finding in main (`.claude/skills/bothy-board/SKILL.md`). A gate that
  // reports another tree's history at 8:1 against its own is worse than no gate — the signal is
  // there and nobody can see it.
  "worktrees",
]);

/**
 * Files whose JOB is to name documents that no longer exist: removal ledgers and archive manifests.
 * Listing a removed file there is the correct behaviour, not rot — see REVISION-INDEX.md, whose
 * table is literally headed "Dated record (removed; git history) | Successor living SSOT".
 */
const REMOVAL_LEDGERS = [
  "docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md",
  "docs/agent-ops/REVISION-INDEX.md",
  "docs/_archive/",
];

/**
 * Per-file ceilings for unresolved references. SHRINK-ONLY: lower them as rot is fixed, never raise
 * them. A file absent from this map must have ZERO unresolved references.
 */
export const BROKEN_REFERENCE_FREEZE: Record<string, number> = {
  ".agents/skills/large-task-orchestration/SKILL.md": 4,
  ".agents/skills/openclinxr-slice/fixtures/scaffold-boilerplate/slice-record.md": 1,
  ".agents/skills/turborepo/command/turborepo.md": 12,
  ".agents/skills/worker-scoped-session/SKILL.md": 1,
  ".claude/rules/EXEC_REHYDRATE.md": 1,
  ".claude/rules/GUARD_DRIFT.md": 3,
  ".claude/rules/LEX_AGENTIC.md": 5,
  // RELOCATED, NOT RAISED — 2026-08-29 moved TIER_GROK.md's body verbatim into a lazy skill
  // (that file now says so in as many words: "Nothing was changed or deleted — the content is
  // verbatim in the skill"). Its four dangling references travelled with the text. The three
  // TIER_GROK.md stubs therefore measure 0 now, and the skill measures 4.
  //
  // Net repo total is UNCHANGED at 4, which is why this is a relocation rather than a ceiling
  // raise — the shrink-only rule forbids letting rot GROW, and none grew. The ratchet caught the
  // move correctly: it demanded the emptied stubs drop to 0 rather than sit on stale headroom.
  //
  // The four targets (docs/findings/*.md, agentic-eval/docs/CONFIDENCE.md) do not exist in this
  // repo. Repointing them needs someone who knows where that content went; until then the ceiling
  // holds the line at 4 and cannot silently widen.
  ".claude/rules/TIER_GROK.md": 0,
  ".claude/skills/grok-tier-routing/SKILL.md": 4,
  ".claude/rules/agent-consult.md": 1,
  ".claude/rules/grok-harness-usage.md": 1,
  ".claude/rules/source-of-truth.md": 1,
  ".cursor/rules/EXEC_REHYDRATE.md": 1,
  ".cursor/rules/GUARD_DRIFT.md": 3,
  ".cursor/rules/LEX_AGENTIC.md": 5,
  ".cursor/rules/TIER_GROK.md": 0,
  ".cursor/rules/agent-consult.md": 1,
  ".cursor/rules/grok-harness-usage.md": 1,
  ".cursor/rules/source-of-truth.md": 1,
  ".grok/rules/GUARD_DRIFT.md": 3,
  ".grok/rules/LEX_AGENTIC.md": 5,
  "PROJECT_STATUS.md": 1,
  "agents/coordinator/hrbp/memory.md": 6,
  "agents/core/architect/charter.md": 1,
  "agents/rules/EXEC_REHYDRATE.md": 1,
  "agents/rules/GUARD_DRIFT.md": 3,
  "agents/rules/LEX_AGENTIC.md": 5,
  "agents/rules/TIER_GROK.md": 0,
  "agents/rules/agent-consult.md": 1,
  "agents/rules/grok-harness-usage.md": 1,
  "agents/rules/source-of-truth.md": 1,
  "docs/agent-factory/README.md": 1,
  "docs/agent-ops/DOC-WAREHOUSE.md": 1,
  "docs/madr/0025-implementation-plan-as-versioned-artifact.md": 1,
  "docs/madr/0028-iwsdk-sidecar-spike.md": 1,
  "docs/madr/0032-source-first-packages-vs-project-references.md": 1,
  "docs/openclinxr/cagematch-spec-local-stt-and-quest-transport-2026-08-05.md": 1,
  "docs/openclinxr/code-implementation-plan.md": 1,
  "docs/openclinxr/local-ai-voice-model-strategy.md": 1,
  "docs/openclinxr/quest3-usb-webxr-smoke-checklist.md": 1,
  "docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md": 40,
  "docs/openclinxr/security-audit-exceptions.md": 2,
  "docs/openclinxr/spikes/vibevoice-local-voice-spike.md": 1,
  "operator-steering-needed-questions.md": 2,
};

function markdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) markdownFiles(join(dir, entry.name), acc);
    } else if (entry.isSymbolicLink() && entry.name.endsWith(".md")) {
      /**
       * A SYMLINKED .md IS NOT A SECOND DOCUMENT, and scanning it as one produces a reference
       * failure that no edit to the document can fix.
       *
       * Measured 2026-08-30: `.claude/skills/bothy-board/SKILL.md` is a symlink to
       * `.agents/skills/bothy-board/SKILL.md`. Its line 50 says
       * `[OPENCLINXR-PROJECT-BINDING.md](OPENCLINXR-PROJECT-BINDING.md)`, and that sibling exists
       * beside the TARGET. Resolution happens from the LINK's directory, where no such sibling
       * exists, so a correct relative reference in a correct document was reported as unresolved.
       * The only "fixes" available are to break the link or to hard-code a path that is wrong at
       * the target — i.e. damage the document to satisfy the checker.
       *
       * The canonical file is walked at its real location (`.agents/…` is scanned), so skipping the
       * link loses no coverage. `scripts/sync-harness-agent-files.sh` creates these deliberately so
       * Claude, Grok and Cursor share one source of truth; the multi-harness layout is the reason
       * they exist, and it should not cost a false failure.
       */
      continue;
    } else if (entry.name.endsWith(".md")) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function isCheckableReference(reference: string): boolean {
  if (reference.startsWith("http") || reference.startsWith("#")) return false;
  // Template placeholders and globs are patterns, not pointers.
  return !reference.includes("YYYY") && !reference.includes("<") && !reference.includes("*");
}

/** Count references in one file that do not resolve, relative to the file or the workspace root. */
export function unresolvedReferences(absolutePath: string): string[] {
  let text: string;
  try {
    text = readFileSync(absolutePath, "utf8");
  } catch {
    return [];
  }
  const unresolved: string[] = [];
  for (const pattern of [MARKDOWN_LINK, BACKTICKED_PATH]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const reference = match[1] ?? "";
      if (isCheckableReference(reference)) {
        const fromRoot = resolve(workspaceRoot, reference);
        const fromFile = resolve(dirname(absolutePath), reference);
        if (!existsSync(fromRoot) && !existsSync(fromFile)) unresolved.push(reference);
      }
      match = pattern.exec(text);
    }
  }
  return unresolved;
}

export function checkMarkdownReferencesResolve(): string[] {
  const violations: string[] = [];
  for (const absolutePath of markdownFiles(workspaceRoot)) {
    const relative = absolutePath.slice(workspaceRoot.length + 1);
    if (REMOVAL_LEDGERS.some((ledger) => relative.startsWith(ledger))) continue;

    const unresolved = unresolvedReferences(absolutePath);
    const ceiling = BROKEN_REFERENCE_FREEZE[relative] ?? 0;
    if (unresolved.length > ceiling) {
      violations.push(
        `${relative}: ${unresolved.length} unresolved Markdown reference(s) > frozen ceiling ${ceiling} `
        + `(${[...new Set(unresolved)].slice(0, 4).join(", ")}). `
        + `WHY THIS MATTERS: removing a document while leaving pointers to it sends the next reader — `
        + `human or agent — nowhere. The 2026-08-05 purge did exactly this to tombstones referenced `
        + `from PROTECTED policy docs and to evidence cited by MADR 0029, and BOTH docs:drift-check `
        + `and agent:alignment stayed GREEN, because they check registration and existence, never `
        + `whether a reference resolves. `
        + `FIX: repoint the reference, or remove it and say where the content went. Ceilings are `
        + `SHRINK-ONLY — do not raise this number.`,
      );
    }
  }
  return violations;
}

/** Freeze entries must stay honest: an entry below actual is impossible, above actual is stale. */
export function checkBrokenReferenceFreezeIsHonest(): string[] {
  const violations: string[] = [];
  for (const [relative, ceiling] of Object.entries(BROKEN_REFERENCE_FREEZE)) {
    const absolutePath = join(workspaceRoot, relative);
    if (!existsSync(absolutePath)) {
      violations.push(`${relative}: frozen entry for a file that no longer exists — remove the entry.`);
      continue;
    }
    const actual = unresolvedReferences(absolutePath).length;
    if (actual < ceiling) {
      violations.push(
        `${relative}: freeze ceiling ${ceiling} is above actual ${actual} — rot was fixed but the `
        + `ceiling was not lowered. Set it to ${actual} so the ratchet keeps its grip.`,
      );
    }
  }
  return violations;
}
