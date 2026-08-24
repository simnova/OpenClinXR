import { describe, expect, it } from "vitest";

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildOpenClawRunNextPlan,
  buildOpenClawWatchdogDecision,
  resolveEpicContinuity,
  selectNextSlice,
} from "./openclaw-slice-runner.js";

/** Slice id mapped in SLICE_TEMPLATE_MAP but without a brief on disk in this repo. */
const SNAPSHOT_SLICE = "admin-packet-replay-surfaces-impl";

const projectStatusSnapshot = [
  "# OpenClinXR Project Status",
  "",
  `**Next dequeue:** \`${SNAPSHOT_SLICE}\` or peds-parent-nurse-garment-asset`,
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

  it("extracts camelCase-segment slice ids from Next dequeue", () => {
    const selection = selectNextSlice({
      "PROJECT_STATUS.md":
        "# S\n\n**Next dequeue:** wire-api-durableStore-consumer-v1 (Q4) — wire sink\n",
    });
    expect(selection.sliceId).toBe("wire-api-durableStore-consumer-v1");
    expect(selection.source).toBe("next-dequeue");
  });

  // AMENDED 2026-08-24 (see the-dequeue-refuses-a-slice-id-scraped-from-prose.test.ts).
  //
  // The old assertion here was:
  //     expect(selection.source).toBe("legacy-plan");
  //     expect(selection.sliceId).toBeTruthy();
  // against `legacyPlanSnapshot`, whose queue is a single bare bullet:
  //     "1. Worker 9/7/11 UI-XR runtime evidence consumer + Admin ReviewReplay stay metadata-only."
  //
  // MEASURED: that produced sliceId `"metadata-only"` — a word scraped off the end of the sentence
  // "...stay metadata-only." `toBeTruthy()` was satisfied by it, so the clause was green on a
  // scraped English word. The unlabelled bullet tier is removed; the LABELLED directive below is
  // kept, because "Explicit next queued:" states an intent rather than being mined for one.
  it("honours a LABELLED explicit directive in the legacy plan", () => {
    const selection = selectNextSlice({
      "PROJECT_STATUS.md": "# status\n",
      "AUTONOMOUS_WORK_PLAN.md": "# plan\n\nExplicit next queued: `peds-evidence-loop` (Q5)\n",
    });
    expect(selection.source).toBe("legacy-plan");
    expect(selection.sliceId).toBe("peds-evidence-loop");
  });

  it("does NOT mine a bare bullet in the legacy plan for a slice id", () => {
    const selection = selectNextSlice({
      "PROJECT_STATUS.md": "# status\n",
      "AUTONOMOUS_WORK_PLAN.md": legacyPlanSnapshot,
    });
    expect(selection.sliceId, "previously returned the scraped word 'metadata-only'").toBeNull();
    expect(selection.source).toBeNull();
  });

  it("builds slice-team init when brief is missing", () => {
    // Use a template-mapped id that is not present under .openclinxr/slices in this workspace.
    const missingBriefStatus = [
      "# OpenClinXR Project Status",
      "",
      "**Next dequeue:** `peds-evidence-loop-missing-brief-fixture-xyz` ",
      "",
    ].join("\n");
    const plan = buildOpenClawRunNextPlan({
      now: new Date("2026-06-07T12:00:00.000Z"),
      stateFiles: {
        "PROJECT_STATUS.md": missingBriefStatus,
      },
      gitStatusShort: "## main...origin/main",
    });

    expect(plan.selectedSlice).toBe("peds-evidence-loop-missing-brief-fixture-xyz");
    expect(plan.sliceBriefExists).toBe(false);
    // No template map entry → team init may be null; nextCommand falls back to lease
    expect(plan.nextCommand).toBeTruthy();
    expect(plan.canonicalStateUpdate).toMatchObject({
      allowed: false,
      reason: "No product change, verification result, or blocker has been supplied.",
    });
    // epicContinuity is null when no ACTIVE pointer or present when epic ACTIVE in cwd
    expect(plan.epicContinuity === null || typeof plan.epicContinuity?.activeEpicId === "string").toBe(
      true,
    );
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

  it("resolveEpicContinuity reads ACTIVE epic pointer", () => {
    const root = mkdtempSync(path.join(tmpdir(), "epic-cont-"));
    expect(resolveEpicContinuity(root)).toBeNull();
    mkdirSync(path.join(root, ".openclinxr/epics"), { recursive: true });
    writeFileSync(path.join(root, ".openclinxr/epics/ACTIVE"), "demo-epic\n", "utf8");
    const cont = resolveEpicContinuity(root);
    expect(cont).toMatchObject({
      activeEpicId: "demo-epic",
      planCommand: expect.stringContaining("openclaw:epic -- plan"),
      applyHeaderCommand: expect.stringContaining("apply-header"),
      advanceCommand: expect.stringContaining("advance"),
    });
  });
});