/**
 * Directives inlined into every dispatched worker prompt.
 *
 * Inlined prompt TEXT is the only mechanism that binds in untrusted scratch worktrees — native
 * grok personas are inert in headless `-p`, and role `prompt_file` needs folder trust. So these
 * are baked rather than referenced. Extracted from grok-repo-agent-spawn.ts to keep that file
 * under its size budget; the spawn builder imports and composes them.
 */

/**
 * Tone directive BAKED DIRECTLY into every worker's `-p` prompt — the proven-reliable mechanism.
 * PROVEN 2026-08-04 (agentic-eval persona re-exploration): native `[subagents.personas]` do NOT
 * bind their instructions in headless `-p` (every linkage failed), and `--agent` bodies / role
 * `prompt_file` only load in a TRUSTED folder — our workers run in untrusted scratch worktrees.
 * Inlined prompt text is the one mechanism that always takes effect regardless of trust. So we bake.
 * `.grok/personas/terse-bluf.toml` is a human-editable SSOT MIRROR of this text, NOT a binding
 * mechanism (native personas are inert in `-p`). Keep the two in sync when editing tone.
 */
export const WORKER_TONE_DIRECTIVE =
  'TONE (obey): BOTTOM LINE first sentence. Bullets only; cite file:line + domain jargon. ' +
  '≤100 words; no recap, no soft menus, no essay. End exactly "Recommended next: <slice> (Q#)". ' +
  'Escalate with a line starting "UNABLE:" when below capability.';

/**
 * Output-budget guard, baked into every worker prompt.
 *
 * Measured 2026-08-05: 4 of 9 headless dispatches did not finish; 3 were KILLED with no final
 * output, including a small mechanical task — so task size alone is not protection. Grok's own
 * introspection named OUTPUT OVERFLOW as a likely cause, and this repo already ships quiet
 * `:agent` turbo variants (`--ui=stream --output-logs=errors-only`) that workers were not using:
 * a fully-cached run drops from ~200 lines of replayed logs to ~2.
 *
 * Suggestive, not proven (the 3 dispatches after adopting these rules all completed; n=1 on the
 * mitigation). Cheap enough to always apply. Full write-up: agentic-eval
 * `docs/findings/delegation-reliability.md`.
 */
export const WORKER_OUTPUT_BUDGET_DIRECTIVE =
  "OUTPUT BUDGET (obey — workers get killed by output overflow): use the quiet turbo variants " +
  "`pnpm packages:test:agent` / `packages:typecheck:agent` / `packages:lint:agent` (or add " +
  "`--ui=stream --output-logs=errors-only`); never run bare `turbo run` across all packages. " +
  "Single-package `pnpm --filter <pkg> test` is fine. NEVER grep a common identifier repo-wide — " +
  "scope every grep to a directory and pipe through `| head -20`.";

/**
 * Shared-tree safety.
 *
 * NOT auto-baked into the spawn prompt: that prompt is already at its 4500-char budget (enforced by
 * a test), and adding this pushed multiple roles over. Rather than shave it to meaninglessness or
 * raise the budget, it is exported for ORCHESTRATOR-WRITTEN dispatch prompts, which have room.
 * Reconsider auto-baking if prompt space is reclaimed — there is existing overlap between the
 * preferredCli guidance and WORKER_OUTPUT_BUDGET_DIRECTIVE that could be merged.
 *
 * Measured 2026-08-05: `--cwd <worktree>` does NOT isolate file edits — a worker given a worktree
 * path wrote into the MAIN checkout. So workers share one tree with the orchestrator and possibly
 * each other. Three concrete incidents drove each rule below:
 *  - `git add <package-dir>` swept 24 build artifacts into a commit (gitignore had fixed-depth globs).
 *  - `git stash` during a verification cycle appears to have swallowed another agent's untracked
 *    file, which then had to be reconstructed.
 *  - 19 abandoned worktrees accumulated across sessions (~22 GB) because nothing cleaned them up.
 *
 * Full write-up: agentic-eval `docs/findings/delegation-reliability.md`.
 */
export const WORKER_SHARED_TREE_DIRECTIVE =
  "SHARED TREE: --cwd does NOT isolate you — you edit the MAIN checkout beside other agents. Stage " +
  "explicit paths only (never a dir or -A: that committed 24 dist files). Never git stash.";
