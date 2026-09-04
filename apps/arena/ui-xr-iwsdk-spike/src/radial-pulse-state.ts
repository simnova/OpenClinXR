export type RadialPulsePhase = "ready" | "approaching" | "contacting" | "holding" | "released";

export type RadialPulseContactMode = "none" | "two_finger" | "controller_proxy";

export type RadialPulseTraceEvent = {
  sequence: number;
  event: "approach_started" | "contact_started" | "hold_started" | "pulse_felt" | "contact_released";
  atMs: number;
  contactMode: RadialPulseContactMode;
};

export type RadialPulseEvidence = {
  schemaVersion: "openclinxr.iwsdk-radial-pulse-interaction.v1";
  source: "window.__openClinXrRadialPulseEvidence";
  target: "patient_right_radial_wrist";
  phase: RadialPulsePhase;
  contactMode: RadialPulseContactMode;
  contactActive: boolean;
  sustainedContactMs: number;
  pulseCount: number;
  pulseBpm: 72;
  demoMode: "manual_xr_input" | "deterministic_iwer_query";
  demoQueryFlag: "radialPulseDemo=true";
  viewMode: "default_station" | "radial_pulse_close_up";
  consentCueVisible: boolean;
  stopOnDiscomfortCueVisible: boolean;
  patientAssetName: "mpfb-street-adult-male.glb";
  patientAssetUrl: string | null;
  patientAssetLoadStatus: "not_requested" | "loading" | "loaded" | "failed";
  wristBoneName: "wrist.R" | null;
  wristRuntimeNodeName: "wristR" | null;
  targetAttachedToWrist: boolean;
  patientPresentationPose: "default" | "consented_right_wrist_presentation";
  posedArmBones: readonly string[];
  trace: RadialPulseTraceEvent[];
  readyForIwerInteractionEvidence: boolean;
  readyForPhysicalQuestClaim: false;
  productionReadinessClaimed: false;
  clinicalValidityClaimed: false;
  notEvidenceFor: readonly [
    "physical_quest_hand_tracking_quality",
    "physical_quest_haptics",
    "physical_quest_readiness",
    "clinical_pulse_assessment_validity",
    "production_runtime_readiness",
  ];
};

export type RadialPulseMachine = {
  evidence: RadialPulseEvidence;
  contactStartedAtMs: number | null;
  lastPulseAtMs: number | null;
};

const holdThresholdMs = 650;
const pulseIntervalMs = 60_000 / 72;

export function hasRadialPulseDemo(search: string): boolean {
  return new URLSearchParams(search).get("radialPulseDemo") === "true";
}

export function shouldInstallUikitmlSpatialTextPanel(radialPulseDemo: boolean): boolean {
  return !radialPulseDemo;
}

export function shouldHydrateOptionalIwsdkPackages(radialPulseDemo: boolean): boolean {
  return !radialPulseDemo;
}

export function createRadialPulseMachine(deterministicDemo: boolean): RadialPulseMachine {
  return {
    contactStartedAtMs: null,
    lastPulseAtMs: null,
    evidence: {
      schemaVersion: "openclinxr.iwsdk-radial-pulse-interaction.v1",
      source: "window.__openClinXrRadialPulseEvidence",
      target: "patient_right_radial_wrist",
      phase: "ready",
      contactMode: "none",
      contactActive: false,
      sustainedContactMs: 0,
      pulseCount: 0,
      pulseBpm: 72,
      demoMode: deterministicDemo ? "deterministic_iwer_query" : "manual_xr_input",
      demoQueryFlag: "radialPulseDemo=true",
      viewMode: deterministicDemo ? "radial_pulse_close_up" : "default_station",
      consentCueVisible: deterministicDemo,
      stopOnDiscomfortCueVisible: deterministicDemo,
      patientAssetName: "mpfb-street-adult-male.glb",
      patientAssetUrl: null,
      patientAssetLoadStatus: deterministicDemo ? "loading" : "not_requested",
      wristBoneName: null,
      wristRuntimeNodeName: null,
      targetAttachedToWrist: false,
      patientPresentationPose: deterministicDemo ? "consented_right_wrist_presentation" : "default",
      posedArmBones: deterministicDemo ? ["upperarm01.R", "lowerarm01.R", "wrist.R"] : [],
      trace: [],
      readyForIwerInteractionEvidence: false,
      readyForPhysicalQuestClaim: false,
      productionReadinessClaimed: false,
      clinicalValidityClaimed: false,
      notEvidenceFor: [
        "physical_quest_hand_tracking_quality",
        "physical_quest_haptics",
        "physical_quest_readiness",
        "clinical_pulse_assessment_validity",
        "production_runtime_readiness",
      ],
    },
  };
}

export function recordRadialPulsePatientAttachment(machine: RadialPulseMachine, input: {
  assetUrl: string;
  loaded: boolean;
  wristBoneName?: "wrist.R";
}): RadialPulseMachine {
  const interactionCompleted = machine.evidence.demoMode === "deterministic_iwer_query"
    && machine.evidence.phase === "released"
    && machine.evidence.pulseCount > 0;
  return {
    ...machine,
    evidence: {
      ...machine.evidence,
      patientAssetUrl: input.assetUrl,
      patientAssetLoadStatus: input.loaded ? "loaded" : "failed",
      wristBoneName: input.loaded ? input.wristBoneName ?? null : null,
      wristRuntimeNodeName: input.loaded && input.wristBoneName === "wrist.R" ? "wristR" : null,
      targetAttachedToWrist: input.loaded && input.wristBoneName === "wrist.R",
      readyForIwerInteractionEvidence:
        interactionCompleted && input.loaded && input.wristBoneName === "wrist.R",
    },
  };
}

export function startRadialPulseApproach(machine: RadialPulseMachine, atMs: number): RadialPulseMachine {
  if (machine.evidence.phase !== "ready") {
    return machine;
  }
  return withEvent(machine, "approach_started", atMs, "approaching", "none");
}

export function startRadialPulseContact(
  machine: RadialPulseMachine,
  atMs: number,
  contactMode: Exclude<RadialPulseContactMode, "none">,
): RadialPulseMachine {
  if (machine.evidence.contactActive) {
    return machine;
  }
  const contacted = withEvent(machine, "contact_started", atMs, "contacting", contactMode);
  return {
    ...contacted,
    contactStartedAtMs: atMs,
    lastPulseAtMs: atMs,
    evidence: { ...contacted.evidence, contactActive: true },
  };
}

export function updateRadialPulseContact(machine: RadialPulseMachine, atMs: number): RadialPulseMachine {
  if (!machine.evidence.contactActive || machine.contactStartedAtMs === null || machine.lastPulseAtMs === null) {
    return machine;
  }

  const sustainedContactMs = Math.max(0, atMs - machine.contactStartedAtMs);
  let next = {
    ...machine,
    evidence: { ...machine.evidence, sustainedContactMs: roundMs(sustainedContactMs) },
  };
  if (sustainedContactMs >= holdThresholdMs && next.evidence.phase === "contacting") {
    next = withEvent(next, "hold_started", machine.contactStartedAtMs + holdThresholdMs, "holding", next.evidence.contactMode);
  }

  const pulsesDue = Math.floor((atMs - machine.lastPulseAtMs) / pulseIntervalMs);
  for (let index = 0; index < pulsesDue; index += 1) {
    const pulseAtMs = (next.lastPulseAtMs ?? atMs) + pulseIntervalMs;
    next = withEvent(next, "pulse_felt", pulseAtMs, "holding", next.evidence.contactMode);
    next = {
      ...next,
      lastPulseAtMs: pulseAtMs,
      evidence: { ...next.evidence, pulseCount: next.evidence.pulseCount + 1 },
    };
  }
  return next;
}

export function releaseRadialPulseContact(machine: RadialPulseMachine, atMs: number): RadialPulseMachine {
  if (!machine.evidence.contactActive) {
    return machine;
  }
  const released = withEvent(machine, "contact_released", atMs, "released", machine.evidence.contactMode);
  return {
    ...released,
    contactStartedAtMs: null,
    lastPulseAtMs: null,
    evidence: {
      ...released.evidence,
      contactActive: false,
      readyForIwerInteractionEvidence:
        released.evidence.demoMode === "deterministic_iwer_query"
        && released.evidence.pulseCount > 0
        && released.evidence.patientAssetLoadStatus === "loaded"
        && released.evidence.targetAttachedToWrist,
    },
  };
}

function withEvent(
  machine: RadialPulseMachine,
  event: RadialPulseTraceEvent["event"],
  atMs: number,
  phase: RadialPulsePhase,
  contactMode: RadialPulseContactMode,
): RadialPulseMachine {
  const traceEvent: RadialPulseTraceEvent = {
    sequence: machine.evidence.trace.length + 1,
    event,
    atMs: roundMs(atMs),
    contactMode,
  };
  return {
    ...machine,
    evidence: {
      ...machine.evidence,
      phase,
      contactMode,
      trace: [...machine.evidence.trace, traceEvent],
    },
  };
}

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}
