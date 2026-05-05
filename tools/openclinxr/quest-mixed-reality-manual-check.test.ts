import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildQuestMixedRealityManualCheck,
  type QuestMixedRealityManualReport,
} from "./check-quest-mixed-reality-manual.js";

function completedMixedRealityReport(): QuestMixedRealityManualReport {
  return {
    schemaVersion: "openclinxr.quest-mixed-reality-manual.v1",
    generatedAt: "2026-05-05T00:00:00.000Z",
    runContext: {
      performedBy: "xr-systems-architect",
      durationMinutes: 10,
    },
    experience: {
      modeId: "mixed_reality_passthrough",
      requestedSessionMode: "immersive-ar",
      entryGate: "mr=approved",
      mixedRealityPassthroughImplemented: true,
    },
    webXr: {
      navigatorXrPresent: true,
      immersiveArSupported: true,
      immersiveArSupportCheckedAtMs: 220,
      supportError: null,
    },
    entry: {
      operatorApproved: true,
      physicalUserGestureUsed: true,
      sessionStarted: true,
      lastOutcome: "session_started",
      lastError: null,
    },
    passthrough: {
      observed: true,
      transparentBackgroundObserved: true,
      blackSkyboxOrFloorAbsent: true,
      realRoomRecorded: false,
    },
    readability: {
      clinicalTextReadable: true,
      panelsReadable: ["clinical", "dialogue", "input"],
      occlusionIssues: [],
    },
    privacySafety: {
      reviewCompleted: true,
      roomScanOrRecordingAvoided: true,
      bystandersOrPhiVisible: false,
      boundaryComfort: "comfortable",
    },
    performance: {
      source: "window.__openClinXrFrameStats",
      framesObserved: 600,
      immersiveFramesObserved: 600,
      avgFps: 72,
      p95FrameMs: 25,
    },
    comfort: {
      motionComfort: "good",
      heatConcern: false,
      batteryDropPercent: 2,
    },
    notEvidenceFor: [
      "replacement_for_full_vr",
      "production_quest_readiness",
      "passthrough_privacy_readiness",
      "clinical_room_safety_readiness",
    ],
  };
}

describe("Quest Mixed Reality manual checker", () => {
  it("keeps the committed template as a valid blocked-state artifact, not readiness evidence", () => {
    const template = JSON.parse(
      readFileSync("docs/openclinxr/quest-mixed-reality-manual-template.json", "utf8"),
    ) as QuestMixedRealityManualReport;
    const check = buildQuestMixedRealityManualCheck(
      "docs/openclinxr/quest-mixed-reality-manual-template.json",
      template,
    );

    expect(check.readyToClaimMixedRealityReadiness).toBe(false);
    expect(check.readyToClaimFullVrReadiness).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "generated_at_invalid_or_missing",
      "performed_by_missing",
      "duration_under_10_minutes",
      "navigator_xr_missing",
      "immersive_ar_not_supported",
      "mixed_reality_session_not_started",
      "clinical_text_not_readable",
      "frame_sample_under_600_or_missing",
      "motion_comfort_not_confirmed",
    ]));
    expect(check.notEvidenceFor).toEqual(expect.arrayContaining([
      "replacement_for_full_vr",
      "production_quest_readiness",
      "passthrough_privacy_readiness",
      "clinical_room_safety_readiness",
    ]));
  });

  it("keeps the MR blocked-template check inside the IWSDK verification lane", () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain(
      "pnpm xr:quest:mr:check -- --input docs/openclinxr/quest-mixed-reality-manual-template.json --output .agent-factory/quest-mixed-reality-manual-template-check.json",
    );
  });

  it("accepts a completed mixed reality passthrough report without replacing Full VR evidence", () => {
    const check = buildQuestMixedRealityManualCheck("quest-mr.json", completedMixedRealityReport());

    expect(check.readyToClaimMixedRealityReadiness).toBe(true);
    expect(check.readyToClaimFullVrReadiness).toBe(false);
    expect(check.blockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "schema_version_valid",
      "mode_mixed_reality_passthrough_recorded",
      "requested_session_mode_immersive_ar",
      "operator_approved",
      "physical_user_gesture_used",
      "immersive_ar_supported",
      "mixed_reality_session_started",
      "passthrough_observed",
      "privacy_safety_review_completed",
      "room_scan_or_recording_avoided",
      "performance_source_openclinxr_frame_stats",
      "immersive_frame_sample_600_or_more",
      "motion_comfort_confirmed",
    ]));
    expect(check.notEvidenceFor).toEqual(expect.arrayContaining([
      "replacement_for_full_vr",
      "production_quest_readiness",
    ]));
  });

  it("keeps unsupported or ungated MR reports blocked with explicit next steps", () => {
    const report = completedMixedRealityReport();
    report.webXr.immersiveArSupported = false;
    report.entry.operatorApproved = false;
    report.entry.physicalUserGestureUsed = false;
    report.entry.sessionStarted = false;
    report.entry.lastOutcome = "unsupported";
    report.passthrough.observed = false;
    report.privacySafety.reviewCompleted = false;

    const check = buildQuestMixedRealityManualCheck("quest-mr-blocked.json", report);

    expect(check.readyToClaimMixedRealityReadiness).toBe(false);
    expect(check.blockers).toEqual(expect.arrayContaining([
      "operator_gate_not_approved",
      "physical_user_gesture_missing",
      "immersive_ar_not_supported",
      "mixed_reality_session_not_started",
      "passthrough_not_observed",
      "privacy_safety_review_missing",
    ]));
    expect(check.nextSteps).toEqual(expect.arrayContaining([
      "Open the MR sidecar with ?mr=approved and record the operator approval gate.",
      "Confirm immersive-ar support from the Quest Browser runtime before attempting MR.",
    ]));
  });

  it("does not let missing MR evidence look like a production or Full VR claim", () => {
    expect(buildQuestMixedRealityManualCheck(undefined, undefined)).toEqual(expect.objectContaining({
      inputFile: null,
      readyToClaimMixedRealityReadiness: false,
      readyToClaimFullVrReadiness: false,
      blockers: ["missing_quest_mixed_reality_manual_report"],
      notEvidenceFor: [
        "replacement_for_full_vr",
        "production_quest_readiness",
        "passthrough_privacy_readiness",
        "clinical_room_safety_readiness",
      ],
    }));
  });
});
