import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DIAGNOSIS (immutable). The sc-05 browser capture discards the one value that explains its own
 * empty runs.
 *
 * MEASURED 2026-09-15 at main 0d9d1b10, by reproducing the capture's page byte-for-byte (same
 * bundle interception, same URL, same viewport) and evaluating the globals it does not collect.
 * FIVE identical runs against ONE dev server:
 *
 *     run 1   admitted                        driveSource case_owned_bedside_approach
 *     run 2   refused  layout_not_reproduced  driveSource null
 *     run 3   refused  unsatisfiable_intent   driveSource null
 *     run 4   refused  layout_not_reproduced  driveSource null
 *     run 5   refused  layout_not_reproduced  driveSource null
 *
 *     observedGeometryRevision  geom-v1-cdaa4a22-7  on ALL FIVE
 *
 * The room is byte-identical across every run and the route solved through it is not. When the
 * admission refuses, `main.ts:3461` skips `updateStationBedsideApproach` entirely, nothing
 * publishes bedside-approach telemetry, and `gradeBrowserApproach` then records ELEVEN separate
 * refusals — every one of them a consequence of that single skip, and none of them naming it.
 *
 * THE RUNTIME ALREADY PUBLISHES THE CAUSE. `publishFrozenScenePlanAdmission`
 * (packages/openclinxr/asset-registry/src/encounter-bundle-admission-mod.ts:109-121) writes
 * `status`, `reproduced`, `reason`, `detail` and `observedGeometryRevision` to
 * `window.__openClinXrFrozenScenePlanAdmission`. The capture's `page.evaluate` collects four
 * globals — evidence, recorderGlobalPresent, bootPhases, bundleSource — and that is not one of
 * them. Measured: zero occurrences of the identifier in the capture source. Three days of empty
 * captures each discarded the explanation.
 *
 * WHY THIS IS A SOURCE-TEXT CONTRACT AND NOT A BROWSER RUN. A clause that boots chromium would be
 * red or green according to the route solver's 1-in-5 admission rate rather than according to
 * whether the instrument collects the telemetry. That would make the gate a coin flip and would
 * measure the defect this card explicitly does NOT own. The collection is a property of the
 * capture's source; the refusal distribution is a product question for the scene owner.
 *
 * claimScope: that the sc-05 capture collects the frozen-scene-plan admission from the page and
 *   records it in the inspection report it writes.
 * notEvidenceFor: whether the admission should admit or refuse; the correctness of any route
 *   solve; clinical validity, scoring validity, exam equivalence, Quest or worn-headset readiness;
 *   rendered appearance. No motion repair is proposed or implied by this file.
 */

const HERE = import.meta.dirname;
const CAPTURE = path.join(HERE, "ui-xr-bedside-approach-capture.ts");

/** The page global the runtime publishes and the capture must read. */
const ADMISSION_GLOBAL = "__openClinXrFrozenScenePlanAdmission";

/** The report field the capture must write, alongside its existing `bundleScenarioMatch`. */
const REPORT_FIELD = "scenePlanAdmission";

function captureSource(): string {
  return readFileSync(CAPTURE, "utf8");
}

describe("the sc-05 capture records why the walk was gated", () => {
  it("(1) the page evaluation collects the frozen-scene-plan admission global", () => {
    const source = captureSource();
    expect(
      source.includes(ADMISSION_GLOBAL),
      `the capture never reads ${ADMISSION_GLOBAL}. The runtime publishes the admission status, `
        + "reason and detail to that global; without collecting it an empty run reports eleven "
        + "consequences of a skip and never the skip's cause.",
    ).toBe(true);
  });

  it("(2) the collected admission is written into the inspection report, not just read", () => {
    const source = captureSource();
    // Asserting on the WRITE, not merely on the read: a value evaluated and dropped explains
    // nothing to whoever opens the artifact later, which is the whole failure being repaired.
    expect(
      source.includes(`${REPORT_FIELD}:`),
      `the inspection report carries no ${REPORT_FIELD} field. It records bundleScenarioMatch the `
        + "same way; the admission belongs beside it so a null capture is self-explaining.",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the existing four collected globals are not removed to satisfy this", () => {
    const source = captureSource();
    // The cheapest wrong fix is to rewrite the evaluate block and drop something already collected.
    // Each of these is load-bearing: evidence feeds gradeBrowserApproach, recorderGlobalPresent
    // backs the "no injected drive" refusal, bootPhases and bundleSource are both written to the
    // report today.
    for (const kept of [
      "__openClinXrBedsideApproachEvidence",
      "__openClinXrPedsDrive",
      "__openClinXrBootEvidence",
      "__openClinXrRuntimeBundleScenarioMatch",
    ]) {
      expect(source.includes(kept), `${kept} must still be collected`).toBe(true);
    }
  });

  it("(4) COUNTERWEIGHT: no grading threshold or refusal text is weakened to make a null run pass", () => {
    const source = captureSource();
    // A null capture must STILL fail its grade. The repair makes the failure explicable, never
    // acceptable. These are the refusal strings gradeBrowserApproach emits on an empty run.
    for (const refusal of [
      "the page published no bedside-approach telemetry, so nothing was observed",
      "the loaded rig carried no named toe bones, so no stance foot was observed",
    ]) {
      expect(
        source.includes(refusal),
        `the refusal "${refusal}" must survive; explaining a null run does not license accepting one`,
      ).toBe(true);
    }
  });
});
