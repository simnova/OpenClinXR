/**
 * Worker launch env/flag configuration for grok-repo-agent-spawn.ts (#363) — split from
 * the spawn-prompt builder (freeze reason: "split prompt/flags"). Env managers, headless
 * dispatch flags, and the large-task predicate that decides when the flags apply.
 */
/**
 * Env flag managers must export when launching delegated headless/--yolo workers.
 * Project hooks (.grok/hooks/*) NO-OP mutating SessionStart/Stop/PostToolUse coord work when set.
 * Docs: ~/.grok/docs/user-guide/10-hooks.md, 14-headless-mode.md; skill: worker-scoped-session.
 */
export const OPENCLINXR_WORKER_ENV = {
  flag: "OPENCLINXR_WORKER",
  value: "1",
  altSignals: ["GROK_SUBAGENT"] as const,
  exportLine: "export OPENCLINXR_WORKER=1",
  headlessPrefix: "OPENCLINXR_WORKER=1",
  skill: ".grok/skills/worker-scoped-session/SKILL.md",
} as const;

/**
 * Enables `spawn_subagent` in headless `grok -p` sessions.
 * Proven (agentic-eval persona-binding + spawn-reliability): without GROK_SUBAGENTS=1 the
 * spawn tool is absent from the -p tool list (0 tool_calls); with it, multi-level
 * grok→deepseek cost-tiering can fire.
 */
export const GROK_SUBAGENTS_ENV = {
  flag: "GROK_SUBAGENTS",
  value: "1",
  exportLine: "export GROK_SUBAGENTS=1",
  headlessPrefix: "GROK_SUBAGENTS=1",
} as const;



/** Per-job temp root convention — avoids parallel Blender/skin races on fixed /tmp names. */
export const OPENCLINXR_JOB_TMP_CONVENTION = {
  envVar: "OPENCLINXR_JOB_TMP",
  pattern: "${TMPDIR:-/tmp}/openclinxr-job-${USER:-u}-$$-${OPENCLINXR_JOB_ID:-job}",
  filePattern: "$OPENCLINXR_JOB_TMP/<meshId>_<stage>_$$.<ext>",
  forbidExample: "/tmp/openclinxr_skin_albedo_mixed.png",
  skill: ".grok/skills/per-job-temp/SKILL.md",
} as const;

/** Large-task fan-out skill (force parallel cheap workers instead of solo frontier). */
export const LARGE_TASK_ORCHESTRATION_SKILL = ".grok/skills/large-task-orchestration/SKILL.md" as const;

export function looksLikeLargeParallelTask(task?: string): boolean {
  if (!task) return false;
  const t = task.toLowerCase();
  const signals = [
    "large task",
    "parallel",
    "fan-out",
    "fan out",
    "workstream",
    "multi-package",
    "multi package",
    "batch",
    "all meshes",
    "every mesh",
    "blender",
    "across packages",
    "disjoint",
    "n workers",
    "multiple workers",
    "worktrees",
    "decompose",
  ];
  return signals.some((s) => t.includes(s));
}

/**
 * Bounded-autonomy dispatch flags for manager-launched headless workers.
 * Replaces blanket `--yolo` (an undocumented alias): `--always-approve` avoids interactive hangs.
 * Blast radius is bounded by `--deny` rules — the DETERMINISTIC control (VERIFIED 2026-08-04:
 * `--deny 'Bash(rm *)'` blocked an `rm` non-interactively in every context). `--sandbox workspace`
 * is BEST-EFFORT defense-in-depth only — it fenced out-of-cwd writes when shell-launched but
 * FAILED OPEN once under a nested spawn, so do NOT treat it as a hard boundary. `--cwd` alone is
 * NOT a boundary either (a bare `--always-approve` worker wrote outside it). Real safety = --deny
 * + intended-files-only integration from an isolated worktree. Proofs: agentic-eval
 * tests/permission-bounds.test.ts. Caller supplies --model / --cwd / --output-format / --max-turns.
 */
export const WORKER_HEADLESS_DISPATCH_FLAGS = [
  "--always-approve",
  "--sandbox workspace",
  "--deny 'Bash(rm -rf *)'",
  "--deny 'Bash(sudo *)'",
  "--deny 'Bash(git push *)'",
] as const;

export function formatWorkerHeadlessDispatchFlags(): string {
  return WORKER_HEADLESS_DISPATCH_FLAGS.join(" ");
}

/**
 * Shell prefix for manager-launched headless workers (bake into dispatch scripts).
 * Example: `OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_JOB_TMP=... grok -p "..." --always-approve --sandbox workspace --cwd <wt>`
 * Pair with formatWorkerHeadlessDispatchFlags() for bounded autonomy (prefer over blanket --yolo).
 * GROK_SUBAGENTS=1 is required so headless -p workers expose spawn_subagent for multi-level tiering.
 */
export function formatWorkerHeadlessEnvPrefix(jobId?: string): string {
  const job = jobId ?? "job";
  return [
    OPENCLINXR_WORKER_ENV.headlessPrefix,
    GROK_SUBAGENTS_ENV.headlessPrefix,
    `OPENCLINXR_JOB_ID=${job}`,
    'OPENCLINXR_JOB_TMP="${TMPDIR:-/tmp}/openclinxr-job-${USER:-u}-$$-' + job + '"',
  ].join(" ");
}
