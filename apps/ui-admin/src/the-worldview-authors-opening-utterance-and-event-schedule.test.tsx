import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: openingUtterance is on ActorCardSchema and missing from
 * ScenarioActorFormValue. eventSchedule ALREADY has a Form.List editor
 * (CaseAuthoringWorkbench.tsx Scenario steps card). Do not build a second
 * schedule editor. Wire openingUtterance and bind schedule rows to Dialogue
 * compile nodes.
 *
 * MEASURED 2026-08-29. grep openingUtterance in apps/ui-admin/src = 0.
 * eventSchedule Form.List at CaseAuthoringWorkbench.tsx:400-431 with Add
 * scenario step / Remove step.
 *
 * WITHDRAWN: "form has no eventSchedule editor" — false. That was the W9
 * card objective at create. Follow this measurement.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(SRC, "case-authoring-model.ts"), "utf8");
const BENCH = readFileSync(join(SRC, "CaseAuthoringWorkbench.tsx"), "utf8");

describe("the worldview authors openingUtterance (schedule editor already exists)", () => {
  it.fails("(1) ScenarioActorFormValue includes openingUtterance", () => {
    const slice = MODEL.slice(
      MODEL.indexOf("export type ScenarioActorFormValue"),
      MODEL.indexOf("export function scenarioToFormValues"),
    );
    expect(slice).toMatch(/openingUtterance/);
  });

  it.fails("(2) ActorFields bind an openingUtterance control", () => {
    expect(BENCH).toMatch(/openingUtterance/);
  });

  it("(3) COUNTERWEIGHT: eventSchedule Form.List editor remains", () => {
    expect(BENCH).toContain('Form.List name="eventSchedule"');
    expect(BENCH).toContain("Add scenario step");
  });
});

// NOT TESTED: live Mock Dialogue; clinical wording; #167.
