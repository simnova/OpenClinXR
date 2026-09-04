import { describe, expect, it } from "vitest";
import {
  createRadialPulseMachine,
  hasRadialPulseDemo,
  releaseRadialPulseContact,
  recordRadialPulsePatientAttachment,
  shouldInstallUikitmlSpatialTextPanel,
  shouldHydrateOptionalIwsdkPackages,
  startRadialPulseApproach,
  startRadialPulseContact,
  updateRadialPulseContact,
} from "./radial-pulse-state.js";

describe("IWSDK radial pulse interaction", () => {
  it("enables only the explicit deterministic demonstration query", () => {
    expect(hasRadialPulseDemo("?radialPulseDemo=true")).toBe(true);
    expect(hasRadialPulseDemo("?radialPulseDemo=false")).toBe(false);
    expect(hasRadialPulseDemo("?demo=true")).toBe(false);
  });

  it("skips the optional UIKitML import only for the radial pulse capture", () => {
    expect(shouldInstallUikitmlSpatialTextPanel(true)).toBe(false);
    expect(shouldInstallUikitmlSpatialTextPanel(false)).toBe(true);
    expect(shouldHydrateOptionalIwsdkPackages(true)).toBe(false);
    expect(shouldHydrateOptionalIwsdkPackages(false)).toBe(true);
  });

  it("records approach, two-finger contact, sustained pulses, and release", () => {
    let machine = createRadialPulseMachine(true);
    machine = startRadialPulseApproach(machine, 0);
    machine = recordRadialPulsePatientAttachment(machine, {
      assetUrl: "/assets/mpfb-street-adult-male.glb",
      loaded: true,
      wristBoneName: "wrist.R",
    });
    machine = startRadialPulseContact(machine, 1_000, "two_finger");
    machine = updateRadialPulseContact(machine, 2_700);
    machine = releaseRadialPulseContact(machine, 3_000);

    expect(machine.evidence).toMatchObject({
      phase: "released",
      contactMode: "two_finger",
      contactActive: false,
      sustainedContactMs: 1_700,
      pulseCount: 2,
      readyForIwerInteractionEvidence: true,
      viewMode: "radial_pulse_close_up",
      consentCueVisible: true,
      stopOnDiscomfortCueVisible: true,
      readyForPhysicalQuestClaim: false,
      productionReadinessClaimed: false,
      clinicalValidityClaimed: false,
    });
    expect(machine.evidence.trace.map((event) => event.event)).toEqual([
      "approach_started",
      "contact_started",
      "hold_started",
      "pulse_felt",
      "pulse_felt",
      "contact_released",
    ]);
  });

  it("does not become ready when the real patient or wrist attachment is missing", () => {
    let machine = createRadialPulseMachine(true);
    machine = startRadialPulseContact(machine, 0, "two_finger");
    machine = updateRadialPulseContact(machine, 900);
    machine = releaseRadialPulseContact(machine, 1_000);
    expect(machine.evidence.readyForIwerInteractionEvidence).toBe(false);

    machine = recordRadialPulsePatientAttachment(machine, {
      assetUrl: "/assets/mpfb-street-adult-male.glb",
      loaded: false,
    });
    expect(machine.evidence).toMatchObject({
      patientAssetName: "mpfb-street-adult-male.glb",
      patientAssetLoadStatus: "failed",
      wristBoneName: null,
      wristRuntimeNodeName: null,
      targetAttachedToWrist: false,
      patientPresentationPose: "consented_right_wrist_presentation",
      posedArmBones: ["upperarm01.R", "lowerarm01.R", "wrist.R"],
      readyForIwerInteractionEvidence: false,
    });
  });

  it("becomes ready when the real wrist attachment resolves after choreography", () => {
    let machine = createRadialPulseMachine(true);
    machine = startRadialPulseContact(machine, 0, "two_finger");
    machine = updateRadialPulseContact(machine, 900);
    machine = releaseRadialPulseContact(machine, 1_000);
    machine = recordRadialPulsePatientAttachment(machine, {
      assetUrl: "/assets/mpfb-street-adult-male.glb",
      loaded: true,
      wristBoneName: "wrist.R",
    });
    expect(machine.evidence.readyForIwerInteractionEvidence).toBe(true);
  });

  it("supports controller-proxy contact without claiming IWER completion in manual mode", () => {
    let machine = createRadialPulseMachine(false);
    machine = startRadialPulseContact(machine, 100, "controller_proxy");
    machine = updateRadialPulseContact(machine, 1_000);
    machine = releaseRadialPulseContact(machine, 1_100);

    expect(machine.evidence.contactMode).toBe("controller_proxy");
    expect(machine.evidence.pulseCount).toBe(1);
    expect(machine.evidence.readyForIwerInteractionEvidence).toBe(false);
    expect(machine.evidence.viewMode).toBe("default_station");
    expect(machine.evidence.notEvidenceFor).toContain("physical_quest_readiness");
  });

  it("ignores duplicate contact and release transitions", () => {
    const initial = createRadialPulseMachine(false);
    const contacting = startRadialPulseContact(initial, 100, "controller_proxy");
    expect(startRadialPulseContact(contacting, 200, "two_finger")).toBe(contacting);
    const released = releaseRadialPulseContact(contacting, 300);
    expect(releaseRadialPulseContact(released, 400)).toBe(released);
  });
});
