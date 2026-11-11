import { readFileSync } from "node:fs";
import path from "node:path";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import { describe, expect, it } from "vitest";
import { gradeReport } from "../isolated-foot-grounder/capture.js";
import {
  assetMatchesExpected,
  clipMatchesExpected,
  FOOT_GROUNDER_CASE_ID,
  FOOT_GROUNDER_PHYSICIAN_INSTANCE_ID,
  getExpectedFootGrounderIdentity,
} from "./expected-foot-identity.js";
import {
  DECLARED_NONSTANDING_SCENARIO_IDS,
  evaluateStagingCounterweight,
  expectedPostureFromCaseIntent,
  primarySupportSurfaceForScenario,
  SIX_CANONICAL_DECLARATIONS,
} from "./expected-posture.js";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("canonical staging contracts (fake/static units, no browser)", () => {
  it("(a) each six declared postures resolves from case intent independently", () => {
    expect(SIX_CANONICAL_DECLARATIONS).toHaveLength(6);
    for (const decl of SIX_CANONICAL_DECLARATIONS) {
      // Prove the declaration actually exists in the canonical case source.
      const surface = primarySupportSurfaceForScenario(decl.scenarioId);
      expect(
        surface,
        `${decl.scenarioId} has no authored primary supportSurface`,
      ).toBe(decl.primarySupportSurface);
      // Expected posture derives from intent mapping, not from observed rows.
      expect(expectedPostureFromCaseIntent(decl.scenarioId)).toBe(
        decl.expectedPosture,
      );
    }
  });

  it("(b) undeclared nonstanding must RED", () => {
    const rows = [
      { scenarioId: "some_undeclared_ambulatory_v1", posture: "supine" },
      { scenarioId: "another_undeclared_v1", posture: "standing" },
    ];
    const result = evaluateStagingCounterweight(rows, {
      some_undeclared_ambulatory_v1: "standing",
      another_undeclared_v1: "standing",
    });
    expect(result.undeclaredNonstanding).toHaveLength(1);
    expect(result.undeclaredNonstanding[0]).toContain(
      "some_undeclared_ambulatory_v1",
    );
  });

  it("(c) declared posture wrong actual must RED", () => {
    const expected: Record<string, string> = {};
    for (const decl of SIX_CANONICAL_DECLARATIONS) {
      expected[decl.scenarioId] = decl.expectedPosture;
    }
    const rows = SIX_CANONICAL_DECLARATIONS.map((decl) => ({
      scenarioId: decl.scenarioId,
      posture:
        decl.expectedPosture === "seated"
          ? "standing"
          : decl.expectedPosture === "supine"
            ? "standing"
            : "supine",
    }));
    const result = evaluateStagingCounterweight(
      rows,
      expected,
      DECLARED_NONSTANDING_SCENARIO_IDS,
    );
    expect(result.mismatchedDeclared).toHaveLength(6);
    expect(result.undeclaredNonstanding).toHaveLength(0);
  });

  it("(c2) all-declared-correct passes with zero undeclared nonstanding", () => {
    const expected: Record<string, string> = {};
    for (const decl of SIX_CANONICAL_DECLARATIONS) {
      expected[decl.scenarioId] = decl.expectedPosture;
    }
    const rows = SIX_CANONICAL_DECLARATIONS.map((decl) => ({
      scenarioId: decl.scenarioId,
      posture: decl.expectedPosture,
    }));
    const result = evaluateStagingCounterweight(
      rows,
      expected,
      DECLARED_NONSTANDING_SCENARIO_IDS,
    );
    expect(result.mismatchedDeclared).toHaveLength(0);
    expect(result.undeclaredNonstanding).toHaveLength(0);
  });

  it("(d) clip mismatch must still reject via gradeReport", () => {
    const expected = getExpectedFootGrounderIdentity();
    expect(expected.expectedClipRevision).toBe(
      "openclinxr_retarget_walk_source",
    );
    expect(
      clipMatchesExpected("openclinxr_retarget_walk_formal_cc0", expected.expectedClipRevision),
    ).toBe(false);
    expect(clipMatchesExpected(expected.expectedClipRevision, expected.expectedClipRevision)).toBe(
      true,
    );
    const badGrade = gradeReport(
      [],
      {
        sampleCount: 0,
        medianIntervalMs: NaN,
        maxIntervalMs: NaN,
        minIntervalMs: NaN,
        maxOverMedian: NaN,
        hz: NaN,
        medianStrideMeters: NaN,
        requiredHzForAllowance: NaN,
        gradeable: false,
        reason: "empty",
      },
      {
        caseFrozenClipRevision: "openclinxr_retarget_walk_formal_cc0",
        liveClipStamp: "openclinxr_retarget_walk_formal_cc0",
        match: false,
      },
      null,
      null,
      [],
      false,
      false,
    );
    expect(badGrade.ok).toBe(false);
    expect(badGrade.problems.join(" ")).toContain("clip identity");
  });

  it("(d2) asset hash mismatch must not match expected frozen plan", () => {
    const expected = getExpectedFootGrounderIdentity();
    expect(
      assetMatchesExpected(
        "63a4c9dec2065aae38d0e3336fc4a46be2de647354848cebe8269564c01d4b13",
        9457652,
        expected,
      ),
    ).toBe(false);
    expect(
      assetMatchesExpected(
        expected.expectedAssetSha256,
        expected.expectedBytes,
        expected,
      ),
    ).toBe(true);
  });

  it("(e) frozen plan + provenance bind the expected machine pins", () => {
    const expected = getExpectedFootGrounderIdentity();
    const plan = CASE_FROZEN_SCENE_PLANS[FOOT_GROUNDER_CASE_ID] as unknown as {
      revisions?: { clipRevision?: string };
      instances?: Array<{
        instanceId?: string;
        assetSha256?: string;
        byteCount?: number;
      }>;
    };
    expect(plan?.revisions?.clipRevision).toBe("openclinxr_retarget_walk_source");
    const physician = (plan?.instances ?? []).find(
      (i) => i?.instanceId === FOOT_GROUNDER_PHYSICIAN_INSTANCE_ID,
    );
    // st-vitfacet r6 re-pinned 2026-11-05: skin normalTexture re-bake (F1 dermal recipe, strength 0.8 default; superseding commit 20df28d53;
    // texture bytes only, geometry identical): 9618436 -> 9293412 -> 9238432 B; was 9141538a….
    // st-vitfacet r7 re-pinned 2026-11-05: per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default; superseding commit 20df28d53; texture bytes only, geometry identical):
    // 9238432 -> 9320372 B; was 9e1e9552a92d….….
    // st-vitphys r1 re-pinned 2026-11-06: deep family r8 skin albedo + Vitruvian brown iris (post-export byte stages, image bytes only,
    // mesh inventory identical): 9320372 -> 9476168 B; was 34c5aec8fe30….
    // st-palette re-pinned 2026-11-04: sRGB palette fold replaced the scrub_shirt
    // texture (3969ae031; 9618436 -> 9293412 B, geometry identical); was 4b823cbd….
    // st-weld2 re-pinned 2026-11-03: garment topology weld (post-export byte stage;
    // size holds at 9618436); was 921d7a60….
    // tsk_2a74bbdb3f03cb3e re-pinned 2026-11-11: physician teeth swap (fitted CC0 teeth/tongue,
    // retreat 6.1 mm, viseme coupling, decimation 7120 -> 4627 tris);
    // 9497600 -> 12596836 B (old pin was the pre-swap GLB).
    expect(physician?.assetSha256).toBe(
      "2faef74ab1ed20a155f992c8e8f79f8229cedab7cf3dd511317d1e333b3860e0",
    );
    expect(physician?.byteCount).toBe(12596836);
    expect(expected.expectedClipRevision).toBe("openclinxr_retarget_walk_source");
    expect(expected.expectedAssetSha256).toBe(
      "2faef74ab1ed20a155f992c8e8f79f8229cedab7cf3dd511317d1e333b3860e0",
    );
    expect(expected.expectedBytes).toBe(12596836);
    // Independent provenance lineage agrees; retired formal_cc0 preserved.
    const provenance = JSON.parse(
      readFileSync(
        path.join(
          REPO_ROOT,
          "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.provenance.json",
        ),
        "utf8",
      ),
    ) as {
      outputSha256?: string;
      outputBytes?: number;
      motionClips?: Array<{ clipName?: string }>;
      retiredMotionClips?: Array<{ clipName?: string; removedAt?: string }>;
    };
    expect(provenance.outputSha256).toBe(expected.expectedAssetSha256);
    expect(provenance.outputBytes).toBe(expected.expectedBytes);
    expect(provenance.motionClips?.[0]?.clipName).toBe(
      "openclinxr_retarget_walk_source",
    );
    const retired = (provenance.retiredMotionClips ?? []).find(
      (c) => c?.clipName === "openclinxr_retarget_walk_formal_cc0",
    );
    expect(retired?.removedAt).toContain("2026-09-23");
  });

  it("(meta) producer POSTURE_SOURCE tracks the public canonical sources", async () => {
    const staging = (await import("../inpatient-supine-staging.js")) as unknown as {
      POSTURE_SOURCE?: string;
      DECLARED_INPATIENT_SCENARIO_IDS?: readonly string[];
    };
    // Public source binding: the producer metadata must name the reviewed
    // public factory seams it relies on (no private mod import, no withdrawn
    // postureForSupportSurface facade binding allowed). The direct case-intent
    // source is the existing public scenarioBank patient placement (ph54
    // narrowing removed the redundant case-actor-placements entrypoint, so
    // this unit binds scenarioBank itself and never imports that retired
    // direct dependency to appease policy).
    const postureEntry = (await import(
      "@openclinxr/asset-registry/actor-posture"
    )) as unknown as { resolveActorPosture?: unknown };
    const bankEntry = (await import(
      "@openclinxr/scenario-fixtures/scenario-bank"
    )) as unknown as {
      scenarioBank?: Array<{
        scenarioId?: string;
        actors?: Array<{
          role?: string;
          placement?: { supportSurface?: unknown };
        }>;
      }>;
    };
    const bundlesEntry = (await import(
      "@openclinxr/asset-registry/runtime-bundles"
    )) as unknown as {
      createEdChestPainRuntimeSceneManifest?: unknown;
      resolveScenarioActorCast?: unknown;
    };
    expect(typeof postureEntry.resolveActorPosture).toBe("function");
    // Direct intent proof: read the live public bank binding and verify the
    // current case-authored placement for all six cases (not a helper copy).
    expect(Array.isArray(bankEntry.scenarioBank)).toBe(true);
    for (const decl of SIX_CANONICAL_DECLARATIONS) {
      const scenario = bankEntry.scenarioBank!.find(
        (s) => s?.scenarioId === decl.scenarioId,
      );
      const patient = scenario?.actors?.find((a) => a?.role === "patient");
      expect(
        patient?.placement?.supportSurface,
        `${decl.scenarioId} public bank placement`,
      ).toBe(decl.primarySupportSurface);
    }
    // Withdrawn API must not be bound by product metadata (Main still carries
    // the new export during this job; W facade old proves no dependency).
    expect(staging.POSTURE_SOURCE).not.toContain("postureForSupportSurface");
    // Retired direct entrypoint must stay retired: neither the module path
    // nor the helper name may appear in the producer source string.
    expect(staging.POSTURE_SOURCE).not.toContain("authoredCasePlacements");
    expect(staging.POSTURE_SOURCE).not.toContain("case-actor-placements");
    expect(typeof bundlesEntry.createEdChestPainRuntimeSceneManifest).toBe(
      "function",
    );
    expect(typeof bundlesEntry.resolveScenarioActorCast).toBe("function");
    expect(staging.POSTURE_SOURCE).toContain(
      "createEdChestPainRuntimeSceneManifest",
    );
    expect(staging.POSTURE_SOURCE).toContain("resolveScenarioActorCast");
    expect(staging.POSTURE_SOURCE).toContain("actorPlacements");
    expect(staging.POSTURE_SOURCE).toContain("runtime-bundles");
    expect(staging.POSTURE_SOURCE).toContain("resolveActorPosture");
    expect(staging.POSTURE_SOURCE).toContain("scenario-bank");
    expect(staging.POSTURE_SOURCE).toContain("scenarioBank");
    expect(staging.POSTURE_SOURCE).toContain("placement.supportSurface");
    expect(staging.POSTURE_SOURCE).toContain("supportSurface");
    expect([...(staging.DECLARED_INPATIENT_SCENARIO_IDS ?? [])]).toEqual([
      "ward_delirium_med_rec_v1",
      "stepdown_sepsis_nurse_escalation_v1",
      "postop_fever_consult_pressure_v1",
    ]);
  });
});
