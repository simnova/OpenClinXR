import { describe, expect, it } from "vitest";

import {
  buildOpenClawRunNextPlan,
  buildOpenClawWatchdogDecision,
  selectNextSlice,
} from "./openclaw-slice-runner.js";

const projectStatusSnapshot = [
  "# OpenClinXR Project Status",
  "",
  "**Next dequeue:** `admin-packet-replay-surfaces-impl` or peds-parent-nurse-garment-asset",
  "",
  "## Backlog (top)",
  "",
  "| Area | Next slice | Template | Role lead |",
  "|------|------------|----------|-----------|",
  "| UI-XR evidence | `peds-evidence-loop` | peds-evidence-loop | xr-systems-architect |",
].join("\n");

const legacyPlanSnapshot = [
  "# OpenClinXR Autonomous Work Plan",
  "",
  "## Active Product Advancement Queue",
  "",
  "1. Worker 9/7/11 UI-XR runtime evidence consumer + Admin ReviewReplay stay metadata-only.",
  "",
  "## Validation Rules",
].join("\n");

describe("openclaw slice runner", () => {
  it("selects slice from PROJECT_STATUS Next dequeue", () => {
    const selection = selectNextSlice({
      "PROJECT_STATUS.md": projectStatusSnapshot,
    });
    expect(selection).toMatchObject({
      sliceId: "admin-packet-replay-surfaces-impl",
      templateId: "admin-packet-replay",
      source: "next-dequeue",
    });
  });

  it("falls back to legacy AUTONOMOUS_WORK_PLAN queue", () => {
    const selection = selectNextSlice({
      "PROJECT_STATUS.md": "# status\n",
      "AUTONOMOUS_WORK_PLAN.md": legacyPlanSnapshot,
    });
    expect(selection.source).toBe("legacy-plan");
    expect(selection.sliceId).toBeTruthy();
  });

  it("builds slice-team init when brief is missing", () => {
    const plan = buildOpenClawRunNextPlan({
      now: new Date("2026-06-07T12:00:00.000Z"),
      stateFiles: {
        "PROJECT_STATUS.md": projectStatusSnapshot,
      },
      gitStatusShort: "## main...origin/main",
    });

    expect(plan.selectedSlice).toBe("admin-packet-replay-surfaces-impl");
    expect(plan.templateId).toBe("admin-packet-replay");
    expect(plan.sliceBriefExists).toBe(false);
    expect(plan.nextCommand).toContain("openclaw:slice:init");
    expect(plan.sliceTeam.teamSpawnCommand).toContain("--phase scout");
    expect(plan.canonicalStateUpdate).toMatchObject({
      allowed: false,
      reason: "No product change, verification result, or blocker has been supplied.",
    });
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