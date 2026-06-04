import { describe, expect, it } from "vitest";

import { buildOpenClawRunNextPlan, buildOpenClawWatchdogDecision } from "./openclaw-slice-runner.js";

const stateSnapshot = [
  "# OpenClinXR Autonomous Work Plan",
  "",
  "## Active Product Advancement Queue",
  "",
  "1. Worker 9/7/11 UI-XR runtime evidence consumer + Admin ReviewReplay stay metadata-only.",
  "2. Faculty review path determinism.",
  "",
  "## Validation Rules",
].join("\n");

describe("openclaw slice runner", () => {
  it("selects a queued slice while keeping no-op cycles out of canonical state", () => {
    const plan = buildOpenClawRunNextPlan({
      now: new Date("2026-06-04T12:00:00.000Z"),
      stateFiles: {
        "AUTONOMOUS_WORK_PLAN.md": stateSnapshot,
        "PROJECT_COORDINATION_INDEX.md": "# Index",
        "docs/openclinxr/worker-backlog-and-validation-matrix.md": "# Matrix",
      },
      gitStatusShort: "## main...origin/main",
    });

    expect(plan.selectedSlice).toBe("Worker 9/7/11 UI-XR runtime evidence consumer + Admin ReviewReplay stay metadata-only.");
    expect(plan.canonicalStateUpdate).toMatchObject({
      allowed: false,
      reason: "No product change, verification result, or blocker has been supplied.",
    });
    expect(plan.localReportPath).toBe(".openclinxr/openclaw/run-next-report.json");
    expect(plan.nextCommand).toContain("--slice 'Worker 9/7/11 UI-XR runtime evidence consumer");
  });

  it("lets the watchdog trigger run-next only when the tree is clean, no lease is held, and the last run is stale", () => {
    const decision = buildOpenClawWatchdogDecision({
      now: new Date("2026-06-04T12:00:00.000Z"),
      lastRunAt: new Date("2026-06-04T10:00:00.000Z"),
      minIdleMinutes: 60,
      gitStatusShort: "## main...origin/main",
      leaseStatus: "none",
      selectedSlice: "peds launch validation",
    });

    expect(decision).toMatchObject({
      action: "run-next",
      reason: "Clean tree, no active lease, stale runner report, and a queued slice is available.",
    });
  });

  it("keeps the watchdog quiet when the previous report is fresh", () => {
    const decision = buildOpenClawWatchdogDecision({
      now: new Date("2026-06-04T12:00:00.000Z"),
      lastRunAt: new Date("2026-06-04T11:45:00.000Z"),
      minIdleMinutes: 60,
      gitStatusShort: "## main...origin/main",
      leaseStatus: "none",
      selectedSlice: "peds launch validation",
    });

    expect(decision).toMatchObject({
      action: "idle",
      reason: "Previous runner report is still fresh.",
    });
  });
});
