import { describe, expect, it } from "vitest";
import {
  SC07_OBSERVED_ADMISSION,
  SC07_OBSERVED_RECORDER_GLOBAL_PRESENT,
  SC07_OBSERVED_RECORDER_LEAD_MS,
  SC07_OBSERVED_TELEMETRY,
  SC07_OBSERVED_TELEMETRY_WITH_ACTIVATION_RESTORED,
  SC07_OBSERVED_VIDEO_DECODED_FRAMES,
  SC07_OBSERVED_VIDEO_DECODED_SECONDS,
} from "./proofs/sc-07/observed-run-2026-09-13.js";
import {
  captureGapsOf,
  certifyOnDeclaredStateOnly,
  certifyRecordedWorkflow,
} from "./proofs/sc-07/normal-workflow-recording.js";
import { SC07_REQUIRED_CHECK_IDS } from "./proofs/sc-07/verify-core.js";

/**
 * SC-07's named behavior gate: the recording instrument must REFUSE a run that never activated.
 *
 * WHAT THIS TEST IS, and it matters because the filename invites a stronger reading. It is not
 * proof that a normal-workflow walk was recorded. At the measured commit the walk does not happen:
 * the shipped runtime never activates the bedside approach, so there is no arrival to film. What is
 * under test here is the instrument that decides whether a retained run may be certified as an
 * activation-to-arrival recording — and the behavior it must have is a refusal with named reasons.
 *
 * WHY THAT IS THE RIGHT GATE FOR THIS CARD. `tasks-v2.md:407` allows the named test to exercise
 * "the production boundary or independent instrument/review behavior owned by this card". The
 * production boundary is blocked by a defect this card does not own and may not repair; the
 * instrument is SC-07's. A test that certified the blocked run, or that asserted an arrival from
 * another card's artifact, would launder a card that is not finished.
 *
 * THE COUNTERWEIGHT IS A REMOVE-THE-FIX ON IDENTICAL BYTES. `certifyOnDeclaredStateOnly` is the
 * shape the card names as a failure — grading on declared `phase` and a played-clip flag instead of
 * measured joint motion. Handed the same observed telemetry, it certifies and the real instrument
 * refuses. The observed value flips from `certified: true` to `certified: false` with no change to
 * the input, which is the decisive control.
 *
 * A10 IS NOT CLOSED BY THIS FILE. The uninterrupted activation-to-arrival recording, the SC-00
 * measurements over a displayed skeleton, the negative recordings and the independent watched
 * review all remain outstanding, and the direct verifier CLI still fails on them by design.
 *
 * claimScope: the behavior of SC-07's recording instrument on the run this card actually observed.
 * notEvidenceFor: clinical validity, worn-headset readiness, public deployment, gait realism,
 * scoring validity, or that any encounter reached its bedside target.
 */
describe("the normal-workflow walk is recorded", () => {
  it("SC-07-required-behavior", () => {
    // (1) THE RUN THIS CARD OBSERVED. Real telemetry, retained and hashed; see the fixture header.
    const certification = certifyRecordedWorkflow({
      telemetry: SC07_OBSERVED_TELEMETRY,
      recorderGlobalPresent: SC07_OBSERVED_RECORDER_GLOBAL_PRESENT,
    });

    // The instrument REFUSES it, and says why in terms of observed values rather than a verdict.
    expect(certification.certified).toBe(false);
    expect(certification.measured.activationObserved).toBe(false);
    expect(certification.measured.arrivalObserved).toBe(false);
    expect(certification.measured.skeletonSampleCount).toBe(0);
    expect(certification.measured.walkFrames).toBe(0);
    expect(certification.measured.stoppedFrames).toBe(0);
    // Arrival is UNMEASURED, not "0 m". A run with no final pose has no arrival error, and
    // reporting one would be the instrument inventing the number it was asked to measure.
    expect(certification.measured.arrivalErrorMeters).toBeNull();
    expect(certification.measured.settledYawErrorDegrees).toBeNull();

    expect(certification.reasons.some((reason) => /never activated/u.test(reason))).toBe(true);
    expect(certification.reasons.some((reason) => /skeleton samples/u.test(reason))).toBe(true);
    expect(certification.reasons.some((reason) => /no frame was observed walking/u.test(reason))).toBe(true);
    expect(certification.reasons.some((reason) => /no frame was observed stopped/u.test(reason))).toBe(true);

    // (2) THE REFUSAL IS THE RUNTIME'S OWN. No locomotion/recorder global was defined, so this is
    // not a capture that broke its own subject — the card forbids injecting a drive, and none was.
    expect(SC07_OBSERVED_RECORDER_GLOBAL_PRESENT).toBe(false);

    // (3) REMOVE-THE-FIX, on byte-identical input: grading declared state alone certifies the very
    // run the real instrument refuses. This is the controlled counterweight.
    const flagOnly = certifyOnDeclaredStateOnly({ telemetry: SC07_OBSERVED_TELEMETRY });
    expect(flagOnly.certified).toBe(true);
    expect(flagOnly.certified).not.toBe(certification.certified);

    // (4) THE REFUSAL IS SPECIFIC, not a constant `false`. Restoring ONLY the activation fields of
    // the same measured record retires the activation reason and nothing else: the run still has no
    // sampled bodies, so it is still refused. A constant-false instrument could not show this.
    const activationRestored = certifyRecordedWorkflow({
      telemetry: SC07_OBSERVED_TELEMETRY_WITH_ACTIVATION_RESTORED,
      recorderGlobalPresent: false,
    });
    expect(activationRestored.measured.activationObserved).toBe(true);
    expect(activationRestored.reasons.some((reason) => /never activated/u.test(reason))).toBe(false);
    expect(activationRestored.reasons.some((reason) => /skeleton samples/u.test(reason))).toBe(true);
    expect(activationRestored.certified).toBe(false);
    expect(activationRestored.reasons.length).toBeLessThan(certification.reasons.length);

    // (5) TIED TO THE FROZEN CONTRACT. The check this run cannot satisfy is a required check id the
    // report may not drop, so an honest report must carry it as unsatisfied and the CLI must fail.
    expect(SC07_REQUIRED_CHECK_IDS).toContain("uninterrupted-through-arrival-and-stop");
    expect(SC07_REQUIRED_CHECK_IDS).toContain("sc00-rubric-applied-to-displayed-samples");

    // (6) WHAT THE RECORDER DID DO. The film began 45 ms before the page was navigated and decodes
    // as real video, so the recorder half of the card is demonstrated even though the encounter it
    // was pointed at never started. This is recorded as a capability, NOT as A10 evidence.
    expect(SC07_OBSERVED_RECORDER_LEAD_MS).toBeGreaterThan(0);
    expect(SC07_OBSERVED_VIDEO_DECODED_FRAMES).toBeGreaterThan(0);
    expect(SC07_OBSERVED_VIDEO_DECODED_SECONDS).toBeGreaterThan(0);

    // (7) THE MEASURED CAUSE OF THE ABSENT WALK, kept beside the refusal so the handback cannot be
    // read as "the capture failed". The frozen plan admits in node under the freeze's own
    // conditions and refuses in the browser, and the two geometry revisions differ.
    expect(SC07_OBSERVED_ADMISSION.nodeShell.status).toBe("admitted");
    expect(SC07_OBSERVED_ADMISSION.browserLive.status).toBe("refused");
    expect(SC07_OBSERVED_ADMISSION.nodeShellGeometryRevision).toBe(
      SC07_OBSERVED_ADMISSION.frozenGeometryRevision,
    );
    expect(SC07_OBSERVED_ADMISSION.browserGeometryRevision).not.toBe(
      SC07_OBSERVED_ADMISSION.frozenGeometryRevision,
    );
  });

  it("refuses to certify a run with no telemetry at all, rather than passing on an empty record", () => {
    const nothing = certifyRecordedWorkflow({ telemetry: null });
    expect(nothing.certified).toBe(false);
    expect(nothing.reasons.some((reason) => /published no bedside-approach telemetry/u.test(reason))).toBe(true);
    expect(nothing.measured.skeletonSampleCount).toBe(0);
  });

  it("refuses a run whose drive came from an injected recorder global", () => {
    const injected = certifyRecordedWorkflow({
      telemetry: SC07_OBSERVED_TELEMETRY_WITH_ACTIVATION_RESTORED,
      recorderGlobalPresent: true,
    });
    expect(injected.certified).toBe(false);
    expect(injected.reasons.some((reason) => /injected drive/u.test(reason))).toBe(true);
  });

  it("reports capture gaps from the sample clock and refuses to grade a stream too short to difference", () => {
    // A uniform stream: the gap ratio is 1 and nothing is flagged.
    const uniform = captureGapsOf([{ atMs: 0 }, { atMs: 16 }, { atMs: 32 }, { atMs: 48 }]);
    expect(uniform?.gapCount).toBe(0);
    expect(uniform?.withinFrozenRatio).toBe(true);

    // One stalled frame: the ratio exceeds SC-00's frozen 2x and the gap is COUNTED, not smoothed.
    const stalled = captureGapsOf([{ atMs: 0 }, { atMs: 16 }, { atMs: 32 }, { atMs: 400 }]);
    expect(stalled?.gapCount).toBeGreaterThan(0);
    expect(stalled?.withinFrozenRatio).toBe(false);

    // Too few intervals to take a first difference: a refusal, not a pass.
    expect(captureGapsOf([{ atMs: 0 }])).toBeNull();
  });
});
