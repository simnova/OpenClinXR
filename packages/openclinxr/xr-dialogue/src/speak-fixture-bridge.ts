/**
 * Development-only speak fixture bridge (#710): wires a deterministic learner transcript and
 * the #709 runner's actor response into the runtime's existing dialogue path.
 *
 * The Playwright harness (tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts
 * --speak-fixture) prepares the fixture state through this bridge, then fires the actor's
 * dialogue with the runner-produced response text — so the response the actor speaks is the
 * #709 runner's in-memory turn result, never a UI literal. The bridge publishes
 * `__openClinXrDeterministicLearnerTurnEvidence` and renders the transcript + response into a
 * locator-readable dev overlay for the harness's join verdict.
 *
 * Active ONLY when the URL carries `openclinxrSpeakFixture=1` (dev capture harness). A learner
 * runtime never reaches it.
 *
 * claimScope: deterministic dev-fixture turn evidence + dialogue trigger wiring.
 * notEvidenceFor: microphone, STT/TTS, audible playback, full-duplex, production learner
 * runtime, Quest, clinical validity, scoring.
 */

export type DeterministicLearnerTurnEvidence = {
  source: "window.__openClinXrDeterministicLearnerTurnEvidence";
  scenarioId: string;
  traceTag: string;
  learnerTranscript: string;
  responseText: string;
  actorId: string;
  runnerRoutedActorId: string;
  routingReason: string;
  runnerConversationTurn: number;
  firedAtMs: number;
  claimScope: "deterministic_learner_transcript_to_speaking_actor_fixture";
  notEvidenceFor: readonly [
    "microphone",
    "stt",
    "tts",
    "audible_playback",
    "full_duplex",
    "production_learner_runtime",
    "quest_readiness",
    "clinical_validity",
    "scoring",
  ];
};

export type SpeakFixtureBridgePrepareInput = {
  scenarioId: string;
  traceTag: string;
  transcript: string;
  responseText: string;
  actorId: string;
  runnerRoutedActorId: string;
  routingReason: string;
  runnerConversationTurn: number;
};

type SpeakFixtureBridgeState = {
  prepared: boolean;
  firedAtMs: number | null;
  evidence: DeterministicLearnerTurnEvidence | null;
};

declare global {
  interface Window {
    __openClinXrDeterministicLearnerTurnEvidence?: DeterministicLearnerTurnEvidence;
    __openClinXrSpeakFixtureBridge?: {
      prepare(input: SpeakFixtureBridgePrepareInput): void;
      fire(): void;
      state(): SpeakFixtureBridgeState;
    };
  }
}

const SPEAK_FIXTURE_QUERY_PARAM = "openclinxrSpeakFixture";

/**
 * Register the bridge. No-op unless the capture URL carries openclinxrSpeakFixture=1, so a
 * production/learner page never creates the overlay or the window surface.
 */
export function initSpeakFixtureBridge(deps: {
  triggerDialogue: (actorId: string, text: string) => void;
}): void {
  const enabled = new URLSearchParams(window.location.search).get(SPEAK_FIXTURE_QUERY_PARAM) === "1";
  if (!enabled) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "openclinxr-speak-fixture-overlay";
  overlay.setAttribute("data-openclinxr-speak-state", "idle");
  overlay.style.cssText = [
    "position:fixed",
    "top:8px",
    "right:8px",
    "z-index:9999",
    "max-width:520px",
    "padding:8px 10px",
    "background:rgba(10,14,24,0.92)",
    "color:#e8f1ff",
    "font:12px/1.5 monospace",
    "border:1px solid #2f6fed",
    "border-radius:6px",
    "white-space:pre-wrap",
  ].join(";");
  overlay.hidden = true;
  document.body.append(overlay);

  let prepared: SpeakFixtureBridgePrepareInput | null = null;
  let firedAtMs: number | null = null;
  let evidence: DeterministicLearnerTurnEvidence | null = null;

  function render(): void {
    overlay.textContent = "";
    const lines = [
      "SPEAK FIXTURE (dev only)",
      `Trace: ${prepared?.traceTag ?? ""}`,
      `Learner: ${prepared?.transcript ?? ""}`,
      `Actor (${prepared?.actorId ?? ""}): ${prepared?.responseText ?? ""}`,
    ];
    for (const line of lines) {
      const div = document.createElement("div");
      div.textContent = line;
      overlay.append(div);
    }
    const transcript = document.createElement("div");
    transcript.setAttribute("data-openclinxr-speak-transcript", prepared?.transcript ?? "");
    const response = document.createElement("div");
    response.setAttribute("data-openclinxr-speak-response", prepared?.responseText ?? "");
    const actor = document.createElement("div");
    actor.setAttribute("data-openclinxr-speak-actor", prepared?.actorId ?? "");
    overlay.append(transcript, response, actor);
  }

  window.__openClinXrSpeakFixtureBridge = {
    prepare(input: SpeakFixtureBridgePrepareInput): void {
      prepared = { ...input };
      firedAtMs = null;
      evidence = null;
      overlay.hidden = false;
      overlay.setAttribute("data-openclinxr-speak-state", "prepared");
      render();
    },
    fire(): void {
      if (!prepared) {
        return;
      }
      firedAtMs = Date.now();
      overlay.setAttribute("data-openclinxr-speak-state", "fired");
      evidence = {
        source: "window.__openClinXrDeterministicLearnerTurnEvidence",
        scenarioId: prepared.scenarioId,
        traceTag: prepared.traceTag,
        learnerTranscript: prepared.transcript,
        responseText: prepared.responseText,
        actorId: prepared.actorId,
        runnerRoutedActorId: prepared.runnerRoutedActorId,
        routingReason: prepared.routingReason,
        runnerConversationTurn: prepared.runnerConversationTurn,
        firedAtMs,
        claimScope: "deterministic_learner_transcript_to_speaking_actor_fixture",
        notEvidenceFor: [
          "microphone",
          "stt",
          "tts",
          "audible_playback",
          "full_duplex",
          "production_learner_runtime",
          "quest_readiness",
          "clinical_validity",
          "scoring",
        ],
      };
      window.__openClinXrDeterministicLearnerTurnEvidence = evidence;
      deps.triggerDialogue(prepared.actorId, prepared.responseText);
    },
    state(): SpeakFixtureBridgeState {
      return {
        prepared: prepared !== null,
        firedAtMs,
        evidence: evidence ? { ...evidence } : null,
      };
    },
  };
}
