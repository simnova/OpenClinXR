import { describe, expect, it } from "vitest";

import { buildOpenClawReadinessReport, type OpenClawReadinessFailure } from "./check-openclaw-readiness.js";

describe("buildOpenClawReadinessReport", () => {
  it("passes a clean branch synchronized with upstream", () => {
    const report = buildOpenClawReadinessReport("## main...origin/main\n");

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("fails when the worktree has uncommitted paths", () => {
    const report = buildOpenClawReadinessReport("## main...origin/main\n M README.md\n?? tmp.json\n");

    expect(report.ok).toBe(false);
    expect(report.failures.map((failure: OpenClawReadinessFailure) => failure.check)).toContain("worktree-clean");
  });

  it("fails when the branch is behind upstream", () => {
    const report = buildOpenClawReadinessReport("## main...origin/main [behind 2]\n");

    expect(report.ok).toBe(false);
    expect(report.failures.map((failure: OpenClawReadinessFailure) => failure.check)).toContain("upstream-current");
  });

  it("fails when the branch has unpublished commits", () => {
    const report = buildOpenClawReadinessReport("## main...origin/main [ahead 1]\n");

    expect(report.ok).toBe(false);
    expect(report.failures.map((failure: OpenClawReadinessFailure) => failure.check)).toContain("upstream-published");
  });
});
