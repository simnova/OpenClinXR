import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PLANTED RED — BothyBoard card tsk_03375de020895d8f (M1). IMMUTABLE HEADER.
 *
 * Do not rewrite this block. Flip `it.fails` -> `it` and append a `## FIXED` block BELOW it.
 * Do not edit the measured tables or the paths in this header.
 *
 * OBSERVABLE TODAY, measured 2026-08-29 on this tree:
 *
 *   packages/openclinxr/motion-compiler/            EXISTS (this file only)
 *   packages/openclinxr/motion-compiler/src/motion-program.ts                     ABSENT
 *   packages/openclinxr/motion-compiler/src/motion-body-region.ts                 ABSENT
 *   packages/openclinxr/motion-compiler/src/deterministic-scenario-motion-planner.ts  ABSENT
 *   packages/openclinxr/motion-compiler/src/skeleton-profile.ts                   ABSENT
 *
 *   grep -rn "MotionProgram\|MotionBodyRegion\|SkeletonProfile" packages/ apps/  -> 0 hits
 *
 * So there is no MotionProgram v1, no MotionBodyRegion vocabulary, no SkeletonProfile, and no
 * deterministic planner. Nothing in the tree turns an authored `bodyMechanics.touchResponses` row
 * into a motion plan; the rows terminate at `responseClip` — a hand-named clip id an author typed.
 * That is the D9 gap this card exists to close: the motion step of the pipeline is authored, not
 * generated, and there is no artifact a later stage could retarget.
 *
 * THE INPUT IS REAL AND ALREADY SHIPS. `scenario-fixtures/src/adult-abdominal-pain.ts:54-64`
 * authors, on `patient_elena_vasquez_v1` of `adult_abdominal_pain_v1`:
 *
 *   region "abdomen_rlq" | responseKind "guarding" | forceThreshold 0.28
 *   emotionEventId "guard_rlq_v1" | emotion "pain"
 *   responseClip "openclinxr_role_patient_guard_withdraw_rlq"
 *   traceTag "clinical_touch_guard_rlq"
 *
 * Clause (1) reads that row from the fixture source at runtime rather than restating it, so the
 * clause cannot drift away from the case the factory actually ships.
 *
 * THE BOUNDARY THIS CARD ESTABLISHES (clause 2). `ComplianceRegion`
 * (shared-schemas/src/schemas.ts:58-69) is a CLINICAL TOUCH SITE vocabulary — ten quadrant and
 * laterality sites a physician palpates. It answers "where did the learner press". A motion target
 * answers a different question: "what does the actor's body do". Those are not the same set and
 * must not become the same set by accident, because the day they merge, every new touch site
 * silently becomes a motion primitive target and every new motion target silently becomes
 * palpable. The mapping between them is a product decision that has to be written down somewhere a
 * reader can find it — an explicit exported mapping — not implied by a shared string.
 *
 * COUNTERWEIGHT INSIDE CLAUSE (2). The cheapest way to pass "a raw ComplianceRegion cannot be a
 * MotionAction target" is a 1:1 rename — `"abdomen_rlq" -> "motion_abdomen_rlq"`. That is the same
 * vocabulary with new spelling, and it satisfies the letter of the clause while establishing no
 * boundary at all. So clause (2) also requires MOTION_BODY_REGIONS to contain at least one member
 * that has NO ComplianceRegion counterpart: a region the touch vocabulary cannot express, drawn
 * from the ones brief §6 names as motion-needed — sternum, left_precordium, right_shoulder,
 * left_thigh, forehead, mouth. A pure rename produces exactly the ten renamed values and nothing
 * else, so it cannot satisfy this.
 *
 * CARDINALITY IS DELIBERATELY UNCONSTRAINED, and this is a product-owner ruling (2026-08-29)
 * overriding the author's first draft. That draft required the six abdominal quadrants to collapse
 * to fewer than six motion regions. It is withdrawn. Brief §6 says the vocabularies are DIFFERENT,
 * never that motion's is smaller, and every region it names as motion-needed runs the other way —
 * they are sites the touch schema LACKS. Clinically, a guard toward abdomen_rlq is a different arm
 * pose from a guard toward abdomen_llq, so a forced collapse may be wrong on the merits. An
 * implementer may map the six quadrants 1:1, or to fewer, or to more; nothing here has an opinion.
 * The counterpart-existence requirement above is what stops a pure rename, not a cardinality bound.
 *
 * WHAT THESE CLAUSES CANNOT SEE:
 *   - Whether any emitted MotionProgram, once retargeted, LOOKS like guarding. No pixels here.
 *   - Whether the mapping is clinically sensible. It checks that a mapping exists and is not
 *     identity; it has no opinion on which motion region a quadrant should reach.
 *   - Whether the planner is genuinely LLM-free. Determinism across two calls in one process is
 *     necessary and not sufficient — a cached response satisfies it. That is the residual.
 *   - Clause (3) reads the DECLARATION of ComplianceRegionSchema in its source file. It cannot see
 *     a value added to the runtime union by composition, extension, or a second declaration site.
 *
 * claimScope: that a deterministic planner consumes a shipped authored touch row and emits a
 *   MotionProgram v1 that its own validator accepts, and that the motion and compliance region
 *   vocabularies are separated by an explicit mapping.
 * notEvidenceFor: clinical_validity, scoring_validity, production_asset_readiness, quest_readiness,
 *   animation quality, retargeting correctness, or that any actor visibly moves.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

/**
 * The ten values authored in ComplianceRegionSchema, restated here so clause (3) has something to
 * compare the live declaration against. A change to either side is the finding.
 */
const KNOWN_COMPLIANCE_REGIONS = [
  "abdomen_ruq",
  "abdomen_rlq",
  "abdomen_luq",
  "abdomen_llq",
  "abdomen_epigastric",
  "abdomen_suprapubic",
  "chest_R",
  "chest_L",
  "neck_anterior",
  "neck_posterior",
] as const;

/**
 * Regions brief §6 names as needed for motion and absent from the clinical touch schema. Clause (2)
 * requires MOTION_BODY_REGIONS to hold at least one of these. The list is quoted from the brief, not
 * invented here, and it is a floor rather than the expected vocabulary — an implementer may declare
 * motion regions well beyond it.
 */
const MOTION_ONLY_REGIONS_FROM_BRIEF = [
  "sternum",
  "left_precordium",
  "right_shoulder",
  "left_thigh",
  "forehead",
  "mouth",
] as const;

/** A bone-track name, as a skeleton emits them. No clinical touch site may look like one. */
const BONE_TRACK_SHAPE =
  /^(root|hips?|pelvis|spine|chest|neck|head|clavicle|shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe)(_\d+)?(\.[LR])?$/;

/** The four effectors MotionAction may drive. A region vocabulary may not contain these. */
const EFFECTORS = ["handL", "handR", "head", "pelvis"] as const;

// --- structural types. The test owns these; it does not import them from the absent module. ---

type MotionActionTarget = {
  kind: "body_region" | "actor" | "clinical_object" | "world_position";
  id?: string;
  position?: { x: number; y: number; z: number };
};

type MotionAction = {
  actionId: string;
  primitiveId: string;
  trigger: { kind: string; ref: string };
  timing: {
    startMs?: number;
    durationMs: number;
    attackFraction?: number;
    holdFraction?: number;
    releaseFraction?: number;
  };
  intensity: number;
  target: MotionActionTarget;
  effector: (typeof EFFECTORS)[number];
  constraints: unknown[];
};

type MotionProgram = {
  schemaVersion: string;
  scenarioId: string;
  actorId: string;
  provenance: { sourceKind: string; sourceRefs: string[] };
  baseline: { posture: string; supportSurface?: string; affect?: string; breathing?: string; gaze?: string };
  actions: MotionAction[];
  deterministicSeed: unknown;
  claimBoundary: string;
  notEvidenceFor: string[];
};

type MotionCompiler = {
  planMotionProgram: (input: unknown) => MotionProgram;
  validateMotionProgram: (program: unknown) => { ok: boolean; errors: string[] };
  motionBodyRegionForComplianceRegion: (region: string) => string;
  MOTION_BODY_REGIONS: readonly string[];
};

/**
 * Load the module under test. The specifiers are held in variables so this file COLLECTS cleanly
 * while the module is absent — a static import would crash the whole file and take clause (3),
 * which must pass on arrival, down with it. The failure raised here is a module-resolution failure,
 * which is the right reason for clauses (1) and (2) to be red today.
 */
async function loadMotionCompiler(): Promise<MotionCompiler> {
  const programSpecifier = "./motion-program.js";
  const regionSpecifier = "./motion-body-region.js";
  const plannerSpecifier = "./deterministic-scenario-motion-planner.js";
  const [program, region, planner] = await Promise.all([
    import(/* @vite-ignore */ programSpecifier),
    import(/* @vite-ignore */ regionSpecifier),
    import(/* @vite-ignore */ plannerSpecifier),
  ]);
  return {
    planMotionProgram: (program as Record<string, unknown>)["planMotionProgram"] as MotionCompiler["planMotionProgram"] ??
      ((planner as Record<string, unknown>)["planMotionProgram"] as MotionCompiler["planMotionProgram"]),
    validateMotionProgram: (program as Record<string, unknown>)[
      "validateMotionProgram"
    ] as MotionCompiler["validateMotionProgram"],
    motionBodyRegionForComplianceRegion: (region as Record<string, unknown>)[
      "motionBodyRegionForComplianceRegion"
    ] as MotionCompiler["motionBodyRegionForComplianceRegion"],
    MOTION_BODY_REGIONS: (region as Record<string, unknown>)[
      "MOTION_BODY_REGIONS"
    ] as MotionCompiler["MOTION_BODY_REGIONS"],
  };
}

type TouchResponseRow = {
  region: string;
  responseKind: string;
  forceThreshold: number;
  emotionEventId: string;
  emotion: string;
  responseClip: string;
  dialogueLine: string;
  traceTag: string;
};

/**
 * Read the SHIPPED authored row out of the fixture at runtime. Both of the fixture's imports are
 * `import type`, so vitest transpiles it with no external resolution and this is a real read of the
 * case object the factory consumes — not a restatement of it in this file.
 */
async function shippedGuardingRow(): Promise<{ scenarioId: string; actorId: string; row: TouchResponseRow }> {
  const fixtureSpecifier = "../../scenario-fixtures/src/adult-abdominal-pain.ts";
  const mod = (await import(/* @vite-ignore */ fixtureSpecifier)) as Record<string, unknown>;
  const scenario = mod["adultAbdominalPainScenario"] as {
    scenarioId: string;
    actors: { actorId: string; bodyMechanics?: { touchResponses?: TouchResponseRow[] } }[];
  };
  const actor = scenario.actors.find((a) => (a.bodyMechanics?.touchResponses ?? []).length > 0);
  if (!actor) throw new Error("fixture no longer authors any bodyMechanics.touchResponses row");
  const row = (actor.bodyMechanics?.touchResponses ?? []).find(
    (r) => r.region === "abdomen_rlq" && r.responseKind === "guarding",
  );
  if (!row) throw new Error("fixture no longer authors the abdomen_rlq guarding row this clause reads");
  return { scenarioId: scenario.scenarioId, actorId: actor.actorId, row };
}

/**
 * Extract the literal members of a `Type.Union([...])` declaration from the schema SOURCE, by
 * bracket-balanced scan of the named binding. This reads the declared vocabulary structurally; it
 * is not a substring presence check. Limitation stated in the header.
 */
function declaredUnionMembers(sourcePath: string, bindingName: string): string[] {
  const src = readFileSync(sourcePath, "utf8");
  const start = src.indexOf(`export const ${bindingName} = Type.Union([`);
  if (start < 0) throw new Error(`${bindingName} is no longer declared as a Type.Union in ${sourcePath}`);
  const open = src.indexOf("[", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "[") depth += 1;
    else if (src[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`unbalanced union body for ${bindingName}`);
  const body = src.slice(open, end + 1);
  return [...body.matchAll(/Type\.Literal\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] as string);
}

describe("the planner emits a validated motion program", () => {
  it.fails(
    "the deterministic planner turns the shipped abdomen_rlq guarding row into a MotionProgram v1 that its own validator accepts",
    async () => {
      const { scenarioId, actorId, row } = await shippedGuardingRow();
      const { planMotionProgram, validateMotionProgram, motionBodyRegionForComplianceRegion } =
        await loadMotionCompiler();

      const program = planMotionProgram({ scenarioId, actorId, touchResponses: [row] });

      // Envelope: v1, provenance, and the claim boundary the card names.
      expect(program.schemaVersion).toBe("openclinxr.motion-program.v1");
      expect(program.scenarioId).toBe(scenarioId);
      expect(program.actorId).toBe(actorId);
      expect(program.provenance.sourceKind).toBe("deterministic_case_compiler");
      expect(program.provenance.sourceRefs.length).toBeGreaterThan(0);
      expect(program.provenance.sourceRefs.join(" ")).toContain(scenarioId);
      expect(program.claimBoundary).toBe("motion_plan_not_animation_or_clinical_validity_evidence");
      expect([...program.notEvidenceFor].sort()).toEqual([
        "clinical_validity",
        "production_asset_readiness",
        "quest_readiness",
        "scoring_validity",
      ]);
      expect(["standing", "seated", "supine"]).toContain(program.baseline.posture);

      // D9/D13: no LLM, and the seed is recorded on the program so the bake is repeatable.
      expect(program.deterministicSeed).toBeDefined();
      const second = planMotionProgram({ scenarioId, actorId, touchResponses: [row] });
      expect(second).toEqual(program);

      // THE REACH: the authored region arrives at a MotionAction target, through the mapping.
      const expectedTarget = motionBodyRegionForComplianceRegion(row.region);
      const guard = program.actions.find((a) => a.primitiveId === "guard_body_region");
      expect(guard, "no guard_body_region action was emitted for a guarding touch row").toBeDefined();
      expect(guard?.target.kind).toBe("body_region");
      expect(guard?.target.id).toBe(expectedTarget);
      expect(guard?.trigger.ref).toBe(row.emotionEventId);
      expect(EFFECTORS).toContain(guard?.effector as (typeof EFFECTORS)[number]);
      expect(guard?.timing.durationMs).toBeGreaterThan(0);
      expect(guard?.intensity).toBeGreaterThan(0);
      expect(guard?.intensity).toBeLessThanOrEqual(1);
      expect(Array.isArray(guard?.constraints)).toBe(true);

      const verdict = validateMotionProgram(program);
      expect(verdict.errors).toEqual([]);
      expect(verdict.ok).toBe(true);
    },
  );

  it.fails(
    "MotionBodyRegion is a separate vocabulary: no raw ComplianceRegion value may be a MotionAction target, and the motion set holds a region the touch set has no counterpart for",
    async () => {
      const { scenarioId, actorId, row } = await shippedGuardingRow();
      const { planMotionProgram, validateMotionProgram, motionBodyRegionForComplianceRegion, MOTION_BODY_REGIONS } =
        await loadMotionCompiler();

      // The mapping is explicit, closed, and not identity — for every one of the ten, not just the
      // one this card's example uses. A special case on a single string does not pass this.
      expect(Array.isArray(MOTION_BODY_REGIONS)).toBe(true);
      const motionRegions = new Set(MOTION_BODY_REGIONS);
      for (const compliance of KNOWN_COMPLIANCE_REGIONS) {
        const mapped = motionBodyRegionForComplianceRegion(compliance);
        expect(mapped, `no motion region is mapped for ${compliance}`).toBeTruthy();
        expect(mapped, `${compliance} maps to itself — that is one vocabulary, not two`).not.toBe(compliance);
        expect(motionRegions.has(mapped), `${mapped} is not a declared MotionBodyRegion`).toBe(true);
      }

      // The two vocabularies do not intersect at all.
      for (const compliance of KNOWN_COMPLIANCE_REGIONS) {
        expect(motionRegions.has(compliance), `${compliance} leaked into MOTION_BODY_REGIONS`).toBe(false);
      }

      // COUNTERWEIGHT (a), see header. The motion vocabulary must hold at least one region the
      // touch vocabulary has no counterpart for. A pure rename yields exactly the ten renamed
      // values and nothing else, so it cannot satisfy this. The CARDINALITY of the quadrant
      // mapping is deliberately unconstrained: 1:1, fewer, or more all pass.
      const mappedFromCompliance = new Set(KNOWN_COMPLIANCE_REGIONS.map(motionBodyRegionForComplianceRegion));
      const motionOnly = [...motionRegions].filter(
        (r) => !mappedFromCompliance.has(r) && !(KNOWN_COMPLIANCE_REGIONS as readonly string[]).includes(r),
      );
      expect(
        motionOnly.length,
        "every MotionBodyRegion is the image of a ComplianceRegion - this is a rename, not a separate vocabulary",
      ).toBeGreaterThan(0);
      expect(
        motionOnly.filter((r) => (MOTION_ONLY_REGIONS_FROM_BRIEF as readonly string[]).includes(r)),
        `no brief-named motion-only region is declared; expected at least one of ${MOTION_ONLY_REGIONS_FROM_BRIEF.join(", ")}`,
      ).not.toEqual([]);

      // And the validator refuses a program that puts a raw compliance value in a target.
      const program = planMotionProgram({ scenarioId, actorId, touchResponses: [row] });
      for (const compliance of KNOWN_COMPLIANCE_REGIONS) {
        const smuggled: MotionProgram = {
          ...program,
          actions: program.actions.map((a, i) =>
            i === 0 ? { ...a, target: { kind: "body_region", id: compliance } } : a,
          ),
        };
        const verdict = validateMotionProgram(smuggled);
        expect(verdict.ok, `validator accepted raw ComplianceRegion "${compliance}" as a MotionAction target`).toBe(
          false,
        );
        expect(verdict.errors.join(" ")).toContain(compliance);
      }
    },
  );

  /**
   * LIVE COUNTERWEIGHT — passes on arrival, and its evidence is ONLY
   * packages/openclinxr/shared-schemas/src/schemas.ts. It shares no file, no import and no fixture
   * with clauses (1) and (2), so implementing the motion compiler cannot make it green and cannot
   * make it red. It goes red if a later change collapses the two vocabularies back together by
   * pushing motion or skeleton terms into the clinical touch vocabulary.
   */
  it("the clinical touch vocabulary stays ten clinical sites and admits no effector or bone-track name", () => {
    const schemas = join(REPO_ROOT, "packages/openclinxr/shared-schemas/src/schemas.ts");
    const declared = declaredUnionMembers(schemas, "ComplianceRegionSchema");

    expect([...declared].sort()).toEqual([...KNOWN_COMPLIANCE_REGIONS].sort());

    for (const region of declared) {
      expect(EFFECTORS).not.toContain(region as (typeof EFFECTORS)[number]);
      expect(BONE_TRACK_SHAPE.test(region), `"${region}" is bone-track shaped, not a clinical touch site`).toBe(false);
      expect(region, `"${region}" is not an abdomen/chest/neck clinical site`).toMatch(/^(abdomen|chest|neck)_/);
    }
  });
});

// NOT TESTED: that the planner is genuinely LLM-free. Determinism across two calls inside one
// process is satisfied by a cached or memoised LLM response, and by a planner that reads a network
// service once. Proving D9 needs a run with egress denied, or a seed-replay across two processes —
// neither is here. Also not tested: whether any MotionProgram, once retargeted onto a
// SkeletonProfile, produces visible or plausible motion; whether the chosen quadrant-to-motion
// mapping is clinically sensible; and whether ComplianceRegionSchema gains members by composition
// at a second declaration site, which the source-declaration read in clause (3) cannot see.
