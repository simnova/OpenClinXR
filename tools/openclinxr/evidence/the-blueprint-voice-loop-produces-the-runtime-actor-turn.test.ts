import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the voice-loop harness synthesizes a canned string and never asks
 * the runtime to generate an actor response.
 *
 * MEASURED 2026-08-28. GitHub #709. `blueprint-voice-simulation-spike.ts:513` still
 * assigns `text: mockActorSpeech(...)`. The file contains zero calls to
 * `generateRoutedActorResponse`.
 *
 * claimScope: deterministic mock transcript → policy-routed actor response → synthesis.
 * notEvidenceFor: real-model quality; Quest; clinical validity; audible playback (#710).
 *
 * ## FIXED (#709)
 *
 * Clauses (1) and (2) flipped from `it.fails` to `it` on 2026-08-28. The spike now drives the
 * runtime's `generateRoutedActorResponse` (scenario-runtime.ts:230) and feeds the generated
 * `response.text` into the mock voice `synthesize()` call; `mockActorSpeech` and its canned
 * template were deleted. The trace projection therefore grows from 4 to 7 events
 * (`learner.utterance`, `conversation.history_coverage.updated`, `actor.response.generated`).
 * The explicit mock-only model gateway (routeId "blueprint-voice-simulation-spike-v1") is
 * unchanged; `createActorDialogueModelGateway()` is still not called (clause (3)).
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

const REPO = process.cwd();
const SPIKE = join(REPO, "tools/openclinxr/evidence/blueprint-voice-simulation-spike.ts");
const CANNED_TEMPLATE = "I hear you. I will respond within the scenario role.";

describe("the blueprint voice loop produces the runtime actor turn", () => {
  it("(1) the spike calls generateRoutedActorResponse", () => {
    const src = readFileSync(SPIKE, "utf8");
    expect(src.includes("generateRoutedActorResponse"), "GitHub #709: still mockActorSpeech at :513").toBe(
      true,
    );
  });

  it("(2) synthesize() is not fed mockActorSpeech", () => {
    const src = readFileSync(SPIKE, "utf8");
    expect(src).not.toContain("text: mockActorSpeech(selectedActor, primaryTraceTag)");
    expect(src).not.toContain(CANNED_TEMPLATE);
  });

  it("(3) COUNTERWEIGHT: the spike still constructs an explicit mock-only model gateway", () => {
    const src = readFileSync(SPIKE, "utf8");
    expect(src).toContain('routeId: "blueprint-voice-simulation-spike-v1"');
    expect(src).not.toContain("createActorDialogueModelGateway()");
  });
});

// NOT TESTED: acoustic learner input; UI-XR playback; #710 human-observable experience.
