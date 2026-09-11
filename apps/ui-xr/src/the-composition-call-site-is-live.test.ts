import { readFileSync } from "node:fs";
import { composeSupportedActorWorldPosition, seatedActorWorldPosition } from "@openclinxr/asset-registry/actor-posture";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { describe, expect, it } from "vitest";

// WHY THIS FILE EXISTS, beside the planted RED
// (the-authored-offset-reaches-the-posed-humanoid.test.ts).
//
// That RED proves composeSupportedActorWorldPosition BEHAVES correctly. It cannot prove the
// runtime CALLS it, and a correct function nothing calls is the failure this repo has shipped
// before: PROTO_VERIFY_DELEGATION §6d, "correct-but-inert components — require observable
// wiring, not the smallest testable unit". The planted contract is frozen after Planted, so
// the wiring assertion goes here rather than into it.
//
// No test in apps/ui-xr imports main.ts — it is a ~3,700-line browser entry with module-level
// three.js state. The existing precedent for asserting a main-tree seam is a source read
// (the-compiled-room-glb-replaces-parametric-shell.test.ts:169), and that is what clause (1)
// does. Its weakness is stated plainly: it proves the call site exists, never that it runs.
// Clause (2) carries the behavioural half against the real authored data.
const MAIN_TS = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const SEAM_TS = readFileSync(
  new URL("../../../packages/openclinxr/xr-runtime-state/src/supported-actor-placement.ts", import.meta.url),
  "utf8",
);

describe("the composition call site is live", () => {
  it("(1) the placement path calls composeSupportedActorWorldPosition in the branch that used to substitute the fixture anchor", () => {
    // The composition lives in @openclinxr/xr-runtime-state: an app is a composition root,
    // and anchor resolution plus composition are one job.
    expect(SEAM_TS).toContain("composeSupportedActorWorldPosition({");
    expect(MAIN_TS).toContain("supportedActorPlacementPosition({");
    // The substitution this card removed: `position: seated ? (familyChairWorldPosition ?? ...)`
    // with no composition. If that exact shape returns, the offset stops reaching the humanoid
    // and every card upstream of this one goes invisible again.
    expect(MAIN_TS).not.toMatch(
      /position:\s*seated\s*\n\s*\?\s*\(familyChairWorldPosition\s*\?\?\s*seatedActorWorldPosition\(\{\}\)\)\s*\n\s*:\s*supine\s*\?\s*supineActorWorldPosition\(\{\}\)\s*:\s*position,/,
    );
  });

  it("(2) the clinic patient's AUTHORED offset moves the seated anchor on X, so the composition is observable in the shipped scenario data", () => {
    const clinic = scenarioBank.find((s) => s.scenarioId === "clinic_knee_pain_return_to_play_v1");
    expect(clinic, "clinic_knee_pain_return_to_play_v1 is the authored fixture this card was measured against").toBeDefined();
    const patient = clinic?.actors?.find((a) => a.actorId === "patient_jordan_cole_v1");
    const offset = patient?.placement?.plantOffsetMeters;
    expect(offset, "the authored plant offset at scenario-fixtures/src/clinic-knee-pain.ts:53").toEqual({ x: 0.4, y: 0, z: 0 });

    const anchor = seatedActorWorldPosition({});
    const composed = composeSupportedActorWorldPosition({
      posture: "seated",
      fixtureAnchor: anchor,
      authoredOffsetMeters: offset,
      resolvedPosition: anchor,
    });
    expect("refused" in composed).toBe(false);
    // X is the discriminator: the authored x is 0.4 and the anchor's is not, so a call site that
    // dropped the offset would land exactly on the anchor.
    expect((composed as { x: number }).x).toBeCloseTo(anchor.x + 0.4, 10);
    expect((composed as { x: number }).x).not.toBeCloseTo(anchor.x, 3);
  });
});
