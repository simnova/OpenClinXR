import { describeFileSizeBudgetTests } from "../test-suites/file-size-budgets.js";

// The pre-commit hook runner propagates the real staged set via
// OPENCLINXR_HOOK_STAGED_FILES (tools/openclinxr/openclaw/agentic-hook-runner.ts,
// issue #361): a commit is answerable for what it changes, so the per-file budget
// check scopes to staged files while the freeze-list honesty sweep stays global.
// Absent the env var (CI, manual runs) the sweep stays global.
const stagedFiles = process.env["OPENCLINXR_HOOK_STAGED_FILES"]
  ?.split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

describeFileSizeBudgetTests(stagedFiles && stagedFiles.length > 0 ? { stagedFiles } : undefined);
