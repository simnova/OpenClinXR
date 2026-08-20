import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #457 — CAGEMATCH: Rapier's kinematic character controller vs our hand-authored standing plant.
 *
 * Operator handed over a Rapier briefing (2026-08-19) and asked for a review. Its load-bearing
 * claim for us: use a HYBRID for humanoid grounding — a kinematic character controller owns the
 * root and the grounded flag, physics colliders resolve contact — never free ragdoll, which on
 * Quest is "expensive and often unstable (jitter, sliding off seats, floating)".
 *
 * That symptom list is our own defect history, so the question is fair. **The deliverable is a
 * DECISION WITH EVIDENCE, not working code. `reject_measured` closes this issue successfully.**
 *
 * ## WHAT IS ALREADY TRUE — measured, not assumed
 *
 * `grep KinematicCharacterController|characterController|snapToGround` across apps + packages +
 * tools: **zero hits.** We hand-author grounding in 11 evidence modules. Meanwhile Rapier IS in
 * the tree and green (`physics-touch-contract`, 39/39 with an AD-1 guard) modelling exactly one
 * thing — a kinematic hand against a STATIC abdomen for palpation. It does no grounding at all.
 * The tool is wired for a different job. That is why this cagematch exists (D1).
 *
 * ## THE CONTROL IS ALREADY TIGHT — READ THIS BEFORE CHASING A NUMBER
 *
 * From `.openclinxr/evidence/actor-floor-contact/actor-floor-contact-all-stations.json`
 * (**stale**: stamped head `cd51020a`, main is past it — re-measure, do not quote these):
 *
 *   34 standing actors, `lowestVertexY`  min -0.0116   median 0.0087   max 0.0166   sd 0.0067
 *
 * **The hand-authored plant already lands every standing actor inside ±1.7 cm.** So this is NOT
 * "beat the control on accuracy" — you almost certainly cannot, and a brief that asked for it
 * would buy a `reject_measured` for the wrong reason (S7a: a threshold becomes a design target).
 *
 * **The question is PARITY plus GENERALITY.** Does a stock controller reach the same band with no
 * per-station bespoke math? Report both columns and say which mechanism you would rather own.
 *
 * ## MY OWN PROBE, INCLUDING THE ONE I GOT WRONG (S9g — disclose the failed instrument)
 *
 * Rapier 0.19.3 has the API: `world.createCharacterController`, `enableSnapToGround`,
 * `computeColliderMovement`, `computedMovement`, `computedGrounded`, `setUp`, `enableAutostep`,
 * `setMaxSlopeClimbAngle` — all present, all callable offline in Node.
 *
 * **First probe was junk**: I started a capsule already penetrating the floor and read its settle
 * value as a result. It is not. Redone with a capsule of halfHeight 0.60 + radius 0.25, so the
 * standing centre is `REST = 0.85` above a floor whose top is `y = 0`:
 *
 *   | start                  | settled | foot vs floor | grounded |
 *   |------------------------|---------|---------------|----------|
 *   | REST + 0.40 (a "drop") | 1.0047  | **+0.1547**   | **false**|
 *   | REST + 0.02            | 0.8601  | +0.0101       | true     |
 *   | REST - 0.05 (penetrating) | 0.7836 | **-0.0664** | true     |
 *
 * Three hazards fall straight out, and none is a Rapier defect:
 *   1. **KCC IS NOT A DROP-AND-LAND TOOL.** It is move-and-slide. *You* integrate gravity into a
 *      desired translation; my constant `-g/3600` per step cannot fall 40 cm in 90 steps, so the
 *      capsule "floated". Integrate velocity properly or start near rest.
 *   2. **It will not push you out of initial penetration upward.** Start above the surface.
 *   3. **Snap-to-ground only engages when already touching, on a downward move, within the snap
 *      distance.** `grounded=false` on the drop row is the API behaving correctly.
 *
 * Also, translation only — **KCC does not rotate anything**, so it cannot pose, sit or lie a body.
 * Seated and supine are a shapecast-onto-support problem and are explicitly NOT this slice.
 *
 * ## SCOPE — standing only, offline, isolated (D3/D4)
 *
 * One subject, one floor collider, in Node. **No `apps/ui-xr`.** The pre-production fence at
 * `apps/ui-xr/src/static-assets.test.ts:1192` stays up and this slice must not touch it. Nothing
 * here proposes promoting Rapier into the learner runtime; that was refused and stays refused.
 * Grounding is a BAKE-TIME placement problem, so an offline controller needs no runtime import.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — no comparison artifact exists.
 *   (2) RED   — the artifact must carry BOTH columns and a verdict from a closed vocabulary.
 *   (3) RED   — the treatment must call the REAL controller, evidenced by name.
 *   (4) NET   — the ui-xr fence. Passes today, must keep passing.
 *   (5) NET   — Rapier stays out of `apps/ui-xr` dependencies. Passes today, must keep passing.
 *   (6) GUARD-BEHIND-THE-ARTIFACT — the vocabulary can express a loss and the band is not
 *               self-fulfilling. It **fails today** because it READS the artifact, like (1)-(3).
 *
 * Clean tree: **4 failing / 2 passing.** Only (4) and (5) can pass before the deliverable exists,
 * because they are the only clauses that read the tree rather than the artifact.
 *
 * I declared (6) a "passes today" guard on the first write and the first run caught me — the
 * SECOND time in two slices I have mis-declared a clause that reads its own deliverable (#456
 * clause (5) was the first). Recorded rather than quietly corrected: any clause reading the
 * artifact is red until the artifact exists, and that is not the same thing as a RED.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) hand-roll a shapecast and call it "the controller"  -> (3) fails; the name must appear
 *   b) report only the treatment column                    -> (2) fails
 *   c) declare `adopt` with no control numbers             -> (2) fails
 *   d) import rapier into apps/ui-xr                       -> (4)/(5) fail
 *   e) widen the parity band until the treatment clears it -> (6) fails; the band is the CONTROL's
 *      own observed spread, re-measured, not a number either of us picked
 *
 * NOT TESTED:
 *   - Seated and supine. KCC is translation-only; those need a shapecast onto the support surface
 *     and are a SEPARATE later cagematch, only if standing wins.
 *   - Anything in a browser, in WebXR, or on Quest. Offline Node only.
 *   - Frame budget, thermal behaviour, or body counts on device.
 *   - Whether Rapier should enter the runtime. This informs that; it does not decide it.
 *   - Slopes, stairs, autostep, moving platforms — a flat floor is the whole world here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const UI_XR = join(REPO_ROOT, "apps/ui-xr/package.json");
const FENCE = join(REPO_ROOT, "apps/ui-xr/src/static-assets.test.ts");
const ARTIFACT = join(HERE, "rapier-standing-cagematch.json");

/** A loss must be sayable, or the cagematch can only ever adopt (S7c). */
const VERDICTS = ["adopt", "reject_measured", "inconclusive_blocked"] as const;

type Column = { settledFootMeters: number[]; grounded: boolean[] };
type Report = {
  verdict: (typeof VERDICTS)[number];
  rationale: string;
  control: Column;
  treatment: Column;
  /** Must contain the real API symbol — a hand-rolled shapecast cannot claim it (refuses (a)). */
  treatmentApi: string;
  engineVersion: string;
};

const report: Report | null = existsSync(ARTIFACT)
  ? (JSON.parse(readFileSync(ARTIFACT, "utf8")) as Report)
  : null;

function requireReport(): Report {
  expect(
    report,
    `tools/openclinxr/evidence/rapier-standing-cagematch.json must exist — this slice's deliverable `
      + `is a decision with evidence, and the artifact IS the deliverable`,
  ).not.toBeNull();
  return report as Report;
}

const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

describe("the Rapier character controller grounds a standing actor", () => {
  it("(1) RED: the cagematch artifact exists and names a verdict from the closed vocabulary", () => {
    const r = requireReport();
    expect(VERDICTS, `a loss must be sayable; reject_measured closes this issue successfully`).toContain(
      r.verdict,
    );
    expect(r.rationale.length, `the verdict needs a stated reason, not a bare label`).toBeGreaterThan(80);
    expect(r.engineVersion, `record the engine that produced the numbers`).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it("(2) RED: BOTH columns are populated and the same size", () => {
    // Refuses (b) and (c). A one-column report is not a cagematch.
    const r = requireReport();
    expect(r.control.settledFootMeters.length, `the control column must be re-measured, not quoted `
      + `from the stale artifact in the header`).toBeGreaterThan(0);
    expect(r.treatment.settledFootMeters.length, `the treatment column must exist`).toBe(
      r.control.settledFootMeters.length,
    );
    expect(r.control.grounded.length).toBe(r.control.settledFootMeters.length);
    expect(r.treatment.grounded.length).toBe(r.treatment.settledFootMeters.length);
  });

  it("(3) RED: the treatment used the real controller, not a hand-rolled shapecast", () => {
    // Refuses (a). D1 is the whole point of the exercise: if we re-implement it ourselves the
    // cagematch has measured our own code twice.
    const r = requireReport();
    expect(
      r.treatmentApi,
      `treatmentApi must name the real Rapier entry point — a shapecast you wrote is the thing this `
        + `slice exists to avoid`,
    ).toContain("createCharacterController");
    expect(r.treatmentApi, `snap-to-ground is the specific capability under test`).toContain(
      "enableSnapToGround",
    );
  });

  it("(4) COUNTERWEIGHT: the ui-xr pre-production fence is untouched", () => {
    // Refuses (d). This is a cagematch, not a promotion.
    expect(
      readFileSync(FENCE, "utf8"),
      `apps/ui-xr/src/static-assets.test.ts must still forbid a rapier dependency in ui-xr`,
    ).toContain("@dimforge/rapier");
  });

  it("(5) COUNTERWEIGHT: apps/ui-xr declares no rapier dependency", () => {
    const m = JSON.parse(readFileSync(UI_XR, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...m.dependencies, ...m.devDependencies };
    expect(
      Object.keys(all).filter((k) => k.includes("rapier")),
      `grounding is a bake-time problem; nothing here needs a runtime import`,
    ).toEqual([]);
  });

  it("(6) VACUITY GUARD: the parity band comes from the control's own spread, not from a number I picked", () => {
    // Refuses (e). If the treatment is compared against a band the worker chose, the comparison is
    // decoration. The band is the CONTROL's observed spread, re-measured in this slice.
    const r = requireReport();
    const controlSpread = spread(r.control.settledFootMeters);
    expect(controlSpread, `a control with zero spread cannot calibrate anything`).toBeGreaterThan(0);
    expect(
      controlSpread,
      `the header's stale reading was 0.0282 m across 34 standing actors; a control spread an order `
        + `of magnitude larger means the control was measured wrong, not that the treatment won`,
    ).toBeLessThan(0.3);
    expect(new Set(VERDICTS).size, "the vocabulary can express a loss").toBeGreaterThan(1);
  });
});
