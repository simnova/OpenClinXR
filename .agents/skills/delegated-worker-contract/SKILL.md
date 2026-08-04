---
name: delegated-worker-contract
description: >
  Use for ANY delegated implementation/coding task in this repo — whether you are a
  headless grok/deepseek --yolo worker, a spawned subagent, or an orchestrator handing
  work off. Triggers on "implement", "add", "fix", "build", "refactor", "author", or any
  scoped code task run under --cwd/worktree isolation. Defines the non-negotiable execution
  contract. Proven (agentic-eval: skills enforce adherence better than --rules text).
---

# Delegated Worker Contract

Structural contract for delegated execution. Follow it exactly; it is enforced by skill
auto-load (proven to bind in headless `-p`), not by hope.

## Isolation
- Stay inside your `--cwd` / assigned worktree. Never write outside it, to the parent repo,
  or to another worktree's tree. Verify with `git rev-parse --show-toplevel` if unsure.
- Use **per-job unique temp files** (`$TMPDIR/<job>_<pid>.*`) — never shared `/tmp` basenames;
  parallel jobs must not collide.

## Verification before commit
- Commit **only when the verification chain is green**: affected tests + typecheck +
  `pnpm architecture` + `pnpm docs:drift-check`. Never commit a red/broken state.
- Do **not** modify existing tests, routes, or files outside your task scope to force a pass.
  If your change couples to a downstream test's expectation, update that test honestly and
  run the affected package graph (not just the file you touched).

## Commit authority (standing — worktree lane)
- **Commit + push on green IN LANE (worktree)** without per-commit human ask. Intended files only.
- **Never force-push**; never rewrite published history; never blind-copy/push worktree → main.
- **Promotion to main is parent-gated** (`pnpm openclaw:worktree:promote`). Residual: **secrets**.
- Policy SSOT: `docs/agent-ops/COMMIT-AUTHORITY.md`.

## Boundaries
- Do **not** write to external/shared product systems — GitHub Projects/issues/PRs, org boards,
  remote APIs — unless the task explicitly grants that surface. Lane git commit/push (above) is allowed.
- Integrate intended files only; never revert unrelated changes.
- Do **not** weaken, delete, rename, or reinterpret the 6 protected guardrail files or the
  Q1/Q4/Q5 slice gate. Additive/optional schema changes only.
- Keep all `notEvidenceFor` honesty flags; production/clinical/scoring/readiness/exam-equivalence
  gates stay `false`. No AGPL/paid deps.

## Report
End with ≤6 lines: files touched, verification result (green/red + what ran), and any blocker.
No prose recap.
