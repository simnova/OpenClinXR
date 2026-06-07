import { describe, expect, it } from "vitest";
import { buildVisemeTimelineFromDialogue, PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE } from "@openclinxr/model-vetting";
import { buildAnimationEvidence, glbUrlForPath, isFixedCameraView, isTemporalCaptureView, selectBodyMotionProbeClipName } from "./candidate-capture.js";

describe("candidate capture GLB selection", () => {
  it("maps sidecar-produced local candidate paths to the matching browser-served GLB", () => {
    expect(glbUrlForPath(".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_patient_child.glb")).toContain("peds_patient_child.glb");
    expect(glbUrlForPath(".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_anxious_parent.glb")).toContain("peds_anxious_parent.glb");
    expect(glbUrlForPath(".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_nurse_kevin.glb")).toContain("peds_nurse_kevin.glb");
  });

  it("serves copied cagematch assets from the model-vetting studio public folder", () => {
    expect(glbUrlForPath("apps/arena/model-vetting-studio/public/cagematch/anny-skin-track-a-mit-pbr/peds_patient_child_track_a_mit_pbr.glb"))
      .toBe("/cagematch/anny-skin-track-a-mit-pbr/peds_patient_child_track_a_mit_pbr.glb");
  });

  it("accepts fixed camera views for dual side-by-side capture mode", () => {
    expect(isFixedCameraView("front")).toBe(true);
    expect(isFixedCameraView("three_quarter")).toBe(true);
    expect(isFixedCameraView("turntable")).toBe(false);
  });

  it("flags imported MPFB2 eye-look probe animation without promoting readiness", () => {
    expect(buildAnimationEvidence([
      { name: "openclinxr_clinical_idle_breathing", tracks: [{}, {}] },
      { name: "openclinxr_mpfb2_eye_look_probe.001", tracks: [{}] },
    ])).toEqual({
      animationCount: 2,
      animationNames: ["openclinxr_clinical_idle_breathing", "openclinxr_mpfb2_eye_look_probe.001"],
      totalChannelCount: 3,
      mpfb2EyeLookProbePresent: true,
      bodyMotionProbeClipName: "openclinxr_clinical_idle_breathing",
      bodyMotionProbePresent: true,
      runtimeImportEvidenceOnly: true,
    });
  });

  it("prefers role-specific body animation clips for body motion probe evidence", () => {
    expect(selectBodyMotionProbeClipName([
      "openclinxr_clinical_idle_breathing",
      "openclinxr_role_patient_asthma_breathing_effort",
    ])).toBe("openclinxr_role_patient_asthma_breathing_effort");
  });

  it("accepts MPFB body motion probe clips for MakeHuman comparator evidence", () => {
    expect(selectBodyMotionProbeClipName([
      "openclinxr_mpfb_body_motion_probe_pediatric_breathing",
      "idle",
    ])).toBe("openclinxr_mpfb_body_motion_probe_pediatric_breathing");
  });

  it("treats viseme_timeline as a temporal capture bound to the peds asthma patient utterance", () => {
    expect(isTemporalCaptureView("viseme_timeline")).toBe(true);
    const timeline = buildVisemeTimelineFromDialogue(PEDS_ASTHMA_PATIENT_VISeme_DIALOGUE_UTTERANCE);
    expect(timeline.traceTag).toBe("work_of_breathing_assessment");
    expect(timeline.visemeSequence.length).toBeGreaterThan(0);
  });
});
