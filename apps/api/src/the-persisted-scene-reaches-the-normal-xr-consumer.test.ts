import { describe, expect, it } from "vitest";
import { resolveScenarioActorCast } from "@openclinxr/asset-registry";
import { authoredCasePlacements } from "@openclinxr/asset-registry/case-actor-placements";
import { bindInitialSceneContents } from "@openclinxr/asset-registry/initial-scene-contents";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import {
  AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX,
  authoredScenarioContentIdentity,
  toAdminGraphqlScenario,
} from "@openclinxr/rest";
import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "@openclinxr/rest";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import { createApiApp } from "./index.js";

/**
 * SC-01 — a PERSISTED synthetic encounter determines who the normal runtime consumer stages.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT (baseline `df05fa5d`, measured 2026-09-09)
 *
 * Stated correctly here after a first version of this header blamed the wrong function. There are
 * TWO defects, in different files, and only the first is what the baseline RED measured.
 *
 * 1. AT THE ROUTE, THE SELECTION WAS DISCARDED. `GET /runtime/asset-bundles/:bundleId` read no
 *    scenario parameter and called `createEdChestPainLocalLearnerRuntimeAssetBundle()` with NO
 *    ARGUMENTS. A persisted case therefore never reached the cast resolver at all: the served
 *    bundle was the ED bundle, ED `scenarioId` and ED cast together. That is the RED below.
 *
 * 2. INSIDE THE CONSTRUCTOR, a scenario id alone was not enough. `castFromScenarioBank`
 *    (`packages/openclinxr/asset-registry/src/actor-casting.ts:294`) resolves through a
 *    module-level `scenarioBank.find()` and returns `[]` for an id the bank does not carry, and
 *    `resolveBundleCastActorIds` (`.../cast-actor-ids.ts:43-50`) then substitutes the ED literals.
 *    `apps/ui-xr/src/main.ts:650-652` passes an id and nothing else, so it hits this one and gets a
 *    bundle whose only correct field is `scenarioId` — while `describeRuntimeBundleScenarioMatch`
 *    (`packages/openclinxr/xr-pose/src/actor-floor-composition.ts:191`) compares scenario ids only
 *    and reports `matches: true`. The mismatch was silent.
 *
 * Every clause below therefore reads the SERVED BUNDLE. Asserting on a planner helper would prove
 * that a helper works; the card's controls are about what the scene actually contains.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS EXERCISES
 *
 * The production boundary: the case is SAVED through `POST /scenarios`, APPROVED through the real
 * `SubmitScenarioReview` admin GraphQL mutation with a content-identity-bound evidence ref, READ
 * BACK through `GET /scenarios/:id`, and only then requested through
 * `GET /runtime/asset-bundles/:bundleId`, the route that resolves the authored scenario through the
 * existing `ScenarioCatalogPort`/`resolveScenarioById` and hands it to
 * `createEdChestPainLocalLearnerRuntimeAssetBundle` — the SAME constructor
 * `apps/ui-xr/src/main.ts:650-652` calls. No fixture is edited and no bundle is injected into a
 * recorder.
 *
 * NOT TESTED / RESIDUAL, stated rather than implied:
 *   - `apps/ui-xr/src/main.ts:924` reaches this route through
 *     `getLearnerRuntimeAssetBundle(bundleId)` (`packages/openclinxr/xr-station/src/api-client.ts:155`),
 *     which takes no scenario argument, so the query parameter this slice adds has NO production
 *     caller yet. That client file is outside this card's frozen write roots and is owned by the
 *     linked repair card. This proves the persisted case reaches the shared constructor through the
 *     API; it does not prove a browser session did.
 *   - The scene manifest's dialogue, vitals and room props remain the ED literals for every case.
 *     Initial state and dialogue are SC-02's; placement composition is SC-03's.
 *   - The bundle realizes two real-GLB equipment fixtures only. Parametric ward items (bed, rails,
 *     call bell, EHR screen) bind at authoring time and are not realized into `equipment` or
 *     `equipmentPlacements`; the route REFUSES a decision naming them rather than accepting one it
 *     cannot act on.
 *   - `describeRuntimeBundleScenarioMatch` itself is not called here: it lives in
 *     `@openclinxr/xr-pose`, which `apps/api` does not depend on. Its entire input is the bundle's
 *     `scenarioId`, which every clause reads directly.
 *
 * CLAIM SCOPE: local formative synthetic authoring reaching a local runtime bundle.
 * NOT EVIDENCE FOR clinical validity, scoring validity, learner launch readiness, headset
 * readiness, or that any reviewer with clinical credentials approved this case.
 */

/** The manifest is AUTHORING INPUT under `tools/`. Loaded through a runtime-computed specifier so
 * no static `apps/` -> `tools/` import edge exists and no production module can reach it. */
const CASE_SOURCE_SPECIFIER = "../../../tools/openclinxr/factory/scene-closure-case-source.js";

type CaseDocument = Scenario;

type CaseSourceModule = {
  SCENE_CLOSURE_CASE_ID: string;
  SCENE_CLOSURE_ENVIRONMENT_ID: string;
  SCENE_CLOSURE_PINNED_CAST: { patient: string; physician: string };
  SCENE_CLOSURE_EQUIPMENT_DECISIONS: {
    requirementSources: Record<string, string>;
    reviewedAliases: Record<string, string[]>;
    optional: string[];
    intentionallyAbsent: string[];
    copies: Record<string, number>;
  };
  sceneClosureCaseDocument: () => CaseDocument;
  refuseIfCastDriftsFromSelection: (document: CaseDocument) => Array<{
    pinnedRole: string;
    expectedActorId: string;
    foundActorId: string;
    reason: string;
  }>;
};

async function caseSource(): Promise<CaseSourceModule> {
  // Resolved against THIS MODULE, not the process cwd. `@vite-ignore` hands the bare relative
  // string to Node, which resolves it from wherever the runner happened to start — so under
  // `vitest --root apps/api`, which is what `pnpm --filter @openclinxr/api test` runs, it became
  // `/tools/openclinxr/factory/scene-closure-case-source.js` and every clause died on
  // `Cannot find module`. The runtime-computed specifier still keeps `apps/` free of any static
  // edge into `tools/`; only its base changes.
  return (await import(/* @vite-ignore */ new URL(CASE_SOURCE_SPECIFIER, import.meta.url).href)) as CaseSourceModule;
}

/** Catalogue ids the authoring-time planner may bind to. From the case, never invented here. */
const CATALOGUE_EQUIPMENT_IDS = [
  "hospital_bed_equipment",
  "side_rails_equipment",
  "call_bell_equipment",
  "ehr_screen_equipment",
  "medication_cart_equipment",
  "12_lead_ecg_machine_equipment",
  "iv_pole_equipment",
] as const;

/** The two real-GLB fixtures the local encounter bundle can realize. */
const ECG = "ecg_cart_equipment";
const IV = "iv_stand_equipment";

/** The bundle id the local encounter route serves; `main.ts` selects the scenario, not the bundle. */
const LOCAL_BUNDLE_ID = "ed_chest_pain_local_encounter";

const REVIEW_GATES = ["clinical", "psychometric", "legal", "simulationQa"] as const;

function memorySink(): ApiPersistenceSink {
  const store = new Map<string, Scenario>();
  const decisions: ApiScenarioReviewDecisionRecord[] = [];
  return {
    saveAuthoredScenario: (scenario) => {
      store.set(`${scenario.scenarioId}::${scenario.version}`, scenario);
    },
    listAuthoredScenarios: () => Array.from(store.values()),
    getAuthoredScenario: (scenarioId) =>
      Array.from(store.values())
        .filter((scenario) => scenario.scenarioId === scenarioId)
        .sort((left, right) => right.version - left.version)[0],
    saveScenarioReviewDecision: (record) => {
      decisions.push(record);
    },
    listScenarioReviewDecisions: () => decisions,
  };
}

type ApiApp = ReturnType<typeof createApiApp>;

/** The listing identity the review route binds an approval to (mirrors admin listing dressing). */
function listingIdentity(scenario: Scenario): string {
  const graphqlScenario = toAdminGraphqlScenario(scenario);
  const marker = "catalog_source:authored";
  const dressed = graphqlScenario.governance.sourceIds.includes(marker)
    ? graphqlScenario
    : {
        ...graphqlScenario,
        governance: {
          ...graphqlScenario.governance,
          sourceIds: [...graphqlScenario.governance.sourceIds, marker],
        },
      };
  return authoredScenarioContentIdentity(dressed);
}

async function saveCase(app: ApiApp, document: unknown): Promise<Response> {
  return app.request("/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: document }),
  });
}

async function readCase(app: ApiApp, scenarioId: string): Promise<Scenario> {
  const response = await app.request(`/scenarios/${encodeURIComponent(scenarioId)}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { scenario: Scenario };
  return body.scenario;
}

/** Drive all four review gates through the real admin GraphQL mutation. Local formative only. */
async function approveEveryGate(app: ApiApp, scenarioId: string): Promise<Scenario> {
  const document = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
  for (const reviewerRole of REVIEW_GATES) {
    const current = await readCase(app, scenarioId);
    const response = await app.request("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: document.source,
        operationName: "SubmitScenarioReview",
        variables: {
          input: {
            scenarioId,
            version: current.version,
            reviewerRole,
            reviewerId: `reviewer_${reviewerRole}`,
            decision: "APPROVED",
            comments: `${reviewerRole} gate approved for the SC-01 synthetic scene-closure draft (local formative only; not clinical validity).`,
            evidenceRefs: [
              `evidence:sc-01:${scenarioId}:${reviewerRole}`,
              `${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${listingIdentity(current)}`,
            ],
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { errors?: Array<{ message: string }> };
    expect(body.errors ?? []).toEqual([]);
  }
  return readCase(app, scenarioId);
}

type ServedBundle = {
  /** Present only on a refusal. The route never serves a default in place of one. */
  error?: string | undefined;
  unrealizableEquipmentDecisions?: Array<{ authoredEquipmentId: string; decision: string; reason: string }> | undefined;
  retrievalMode?: string | undefined;
  scenarioCatalogSource?: string | undefined;
  productionCloudCall?: boolean | undefined;
  scenarioId: string;
  actors: Array<{ actorId: string; role: string }>;
  equipment: Array<{ equipmentId: string }>;
  sceneManifest: {
    actorPlacements: Record<string, { posture?: string; position?: { x: number; y: number; z: number } }>;
    equipmentPlacements: Record<string, { position: { x: number; y: number; z: number } }>;
  };
};

/** The normal consumer request: select a scenario, receive the runtime bundle for it. */
async function loadRuntimeBundle(app: ApiApp, scenarioId: string): Promise<{ status: number; bundle: ServedBundle }> {
  const response = await app.request(
    `/runtime/asset-bundles/${LOCAL_BUNDLE_ID}?scenarioId=${encodeURIComponent(scenarioId)}`,
  );
  return { status: response.status, bundle: (await response.json()) as ServedBundle };
}

/** Strip the transport envelope so two bundles can be compared field-by-field. */
function bundlePayload(bundle: ServedBundle): Partial<ServedBundle> {
  const {
    retrievalMode: _retrievalMode,
    scenarioCatalogSource: _scenarioCatalogSource,
    productionCloudCall: _productionCloudCall,
    ...payload
  } = bundle;
  return payload;
}

/** A constructor-built bundle as the wire would carry it, for comparison against a served one. */
function servedShapeOf(bundle: object): Partial<ServedBundle> {
  return JSON.parse(JSON.stringify(bundle)) as Partial<ServedBundle>;
}

function stagedActorIds(bundle: ServedBundle): string[] {
  return bundle.actors.map((actor) => actor.actorId).sort();
}

function equipmentIds(bundle: ServedBundle): string[] {
  return bundle.equipment.map((row) => row.equipmentId);
}

/** Persist + approve the scene-closure case on a fresh app, and hand back both. */
async function persistedSceneClosureCase(
  overrides: (document: CaseDocument) => CaseDocument = (document) => document,
): Promise<{ app: ApiApp; source: CaseSourceModule; approved: Scenario }> {
  const source = await caseSource();
  const app = createApiApp(undefined, memorySink());
  const saved = await saveCase(app, overrides(source.sceneClosureCaseDocument()));
  expect(saved.status).toBe(201);
  const approved = await approveEveryGate(app, source.SCENE_CLOSURE_CASE_ID);
  return { app, source, approved };
}

function bankScenario(scenarioId: string): Scenario {
  const found = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  expect(found, `${scenarioId} must be a shipped bank fixture`).toBeDefined();
  return found as Scenario;
}

describe("the persisted scene reaches the normal xr consumer", () => {
  it("SC-01-required-behavior", async () => {
    const { app, source, approved } = await persistedSceneClosureCase();

    // The authoring path really persisted and really promoted — not a client self-assertion.
    expect(approved.scenarioId).toBe(source.SCENE_CLOSURE_CASE_ID);
    expect(approved.status).toBe("approved");
    expect(approved.environment?.environmentId).toBe(source.SCENE_CLOSURE_ENVIRONMENT_ID);

    const { status, bundle } = await loadRuntimeBundle(app, source.SCENE_CLOSURE_CASE_ID);
    expect(status).toBe(200);

    // THE DECISIVE ASSERTION. On the unchanged baseline this is the ED cast:
    // ["nurse_maria_alvarez_v1","patient_robert_hayes_v1","spouse_anna_hayes_v1"].
    expect(stagedActorIds(bundle)).toEqual([
      "daughter_lena_ellis_v1",
      "patient_margaret_ellis_v1",
      "senior_resident_ward_v1",
      "ward_nurse_patel_v1",
    ]);

    // Both halves of the silence, together: the id agrees AND the people are right. On the
    // baseline the id disagreed too, because the route discarded the selection entirely.
    expect(bundle.scenarioId).toBe(source.SCENE_CLOSURE_CASE_ID);
    expect(bundle.scenarioCatalogSource).toBe("authored");

    // The persisted case's authored placement reaches the scene: supine on the bed support.
    expect(bundle.sceneManifest.actorPlacements[source.SCENE_CLOSURE_PINNED_CAST.patient]?.posture)
      .toBe("supine");
    const placements = authoredCasePlacements(source.SCENE_CLOSURE_CASE_ID, approved);
    expect(placements[source.SCENE_CLOSURE_PINNED_CAST.patient]).toEqual({
      supportSurface: "stretcher",
      plantOffsetMeters: { x: 0.12, y: 0, z: -0.08 },
    });

    // The physician STARTS away from the bedside, so there is a walk to make. The bedside
    // destination is computed from the patient's position and is not this authored offset.
    const physicianStart = placements[source.SCENE_CLOSURE_PINNED_CAST.physician];
    expect(physicianStart?.supportSurface).toBe("none");
    const bedsideDestination = bundle.sceneManifest.actorPlacements[source.SCENE_CLOSURE_PINNED_CAST.physician];
    expect(bedsideDestination?.position).toBeDefined();
    expect(physicianStart?.plantOffsetMeters).not.toEqual(bedsideDestination?.position);
  });

  it("(2) an unknown or unreviewed decision refuses at the route instead of defaulting", async () => {
    // A decision naming an id the bundle cannot realize is REFUSED, named, and NOT served past.
    const { app, source } = await persistedSceneClosureCase((document) => ({
      ...document,
      equipmentDecisions: {
        intentionallyAbsentEquipmentIds: [
          ...(document.equipmentDecisions?.intentionallyAbsentEquipmentIds ?? []),
          "bedside_ultrasound_equipment",
        ],
      },
    }));

    const refused = await loadRuntimeBundle(app, source.SCENE_CLOSURE_CASE_ID);
    expect(refused.status).toBe(422);
    expect(refused.bundle.error).toBe("unrealizable_equipment_decision");
    expect(refused.bundle.unrealizableEquipmentDecisions?.map((row) => row.authoredEquipmentId))
      .toEqual(["bedside_ultrasound_equipment"]);
    // It refused rather than quietly handing back the ED bay.
    expect(refused.bundle.actors).toBeUndefined();

    // A scenario id nothing resolves refuses the same way rather than defaulting.
    const unknown = await loadRuntimeBundle(app, "no_such_case_v1");
    expect(unknown.status).toBe(404);
    expect(unknown.bundle.error).toBe("scenario_not_found");
    expect(unknown.bundle.actors).toBeUndefined();
  });

  it("(3) a reordered asset list leaves the served scene and its binding unchanged", async () => {
    const source = await caseSource();
    const document = source.sceneClosureCaseDocument();
    const reordered: CaseDocument = {
      ...document,
      assetNeeds: [...(document.assetNeeds ?? [])].reverse(),
      actors: [...document.actors].reverse(),
    };

    const original = await persistedSceneClosureCase();
    const shuffled = await persistedSceneClosureCase(() => reordered);
    const served = await loadRuntimeBundle(original.app, source.SCENE_CLOSURE_CASE_ID);
    const servedReordered = await loadRuntimeBundle(shuffled.app, source.SCENE_CLOSURE_CASE_ID);
    expect(served.status).toBe(200);
    expect(servedReordered.status).toBe(200);

    // THE WHOLE SCENE, field by field. This is the assertion that is genuinely order-sensitive:
    // body assignment consumes a pool in cast-iteration order (`pickAdultGlb` and its `used` set),
    // so a resolver that walked document order would hand a DIFFERENT GLB to each actor here even
    // though the ids and roles matched. Comparing only ids and roles missed exactly that, and a
    // probe that reversed the resolver's ordering passed against the weaker form.
    expect(bundlePayload(servedReordered.bundle)).toEqual(bundlePayload(served.bundle));

    const bundle = servedReordered.bundle;
    // Slot assignment is by ROLE, so it is stable under a reorder and is stated as a literal.
    expect(bundle.actors.map((actor) => `${actor.role}:${actor.actorId}`)).toEqual([
      "patient:patient_margaret_ellis_v1",
      "nurse:ward_nurse_patel_v1",
      "family_member:daughter_lena_ellis_v1",
      "physician:senior_resident_ward_v1",
    ]);
    expect(Object.keys(bundle.sceneManifest.actorPlacements)).toEqual([
      "patient_margaret_ellis_v1",
      "ward_nurse_patel_v1",
      "daughter_lena_ellis_v1",
      "senior_resident_ward_v1",
    ]);

    // AUTHORING-SIDE, and labelled as such: the reviewed phrase -> catalogue binding is also
    // order-independent. This half exercises the planner, not the scene.
    const decisions = source.SCENE_CLOSURE_EQUIPMENT_DECISIONS;
    const planFor = (doc: CaseDocument) =>
      bindInitialSceneContents({
        scenario: { scenarioId: doc.scenarioId, equipment: doc.equipment, assetNeeds: doc.assetNeeds },
        catalogueEquipmentIds: [...CATALOGUE_EQUIPMENT_IDS],
        reviewedAliases: decisions.reviewedAliases,
        requirementSources: decisions.requirementSources,
        optional: decisions.optional,
        intentionallyAbsent: decisions.intentionallyAbsent,
        copies: decisions.copies,
      });
    const byPhrase = (plan: ReturnType<typeof planFor>) =>
      Object.fromEntries(plan.rows.map((row) => [row.authoredPhrase, {
        boundEquipmentId: row.boundEquipmentId,
        precedence: row.precedence,
        realizedPlacementIds: row.realizedPlacementIds,
      }]));
    expect(byPhrase(planFor(reordered))).toEqual(byPhrase(planFor(document)));
  });

  it("(4) the deliberately absent ECG and IV are not injected into the served scene", async () => {
    const { app, source } = await persistedSceneClosureCase();
    const { bundle } = await loadRuntimeBundle(app, source.SCENE_CLOSURE_CASE_ID);

    // The case authored the refusal, so the scene carries neither fixture nor a placement for one.
    expect(equipmentIds(bundle)).toEqual([]);
    expect(Object.keys(bundle.sceneManifest.equipmentPlacements)).toEqual([]);

    // AND the refusal is the case's, not a new default: a case on the SAME route that authors no
    // decision keeps both. This is the regression an earlier revision of this slice shipped —
    // ward and clinic came back with `equipment: []` because silence had been read as refusal.
    const ward = await loadRuntimeBundle(app, "ward_delirium_med_rec_v1");
    expect(ward.status).toBe(200);
    expect(equipmentIds(ward.bundle)).toEqual([ECG, IV]);
    expect(Object.keys(ward.bundle.sceneManifest.equipmentPlacements)).toEqual([ECG, IV]);
  });

  it("(5) two copies of one equipment id keep distinct realized ids in the served scene", async () => {
    // A control variant of the selected case: it refuses the ECG and authors TWO IV poles. The
    // pinned selection authors neither, so this is a deliberately separate document on its own app.
    const { app, source } = await persistedSceneClosureCase((document) => ({
      ...document,
      equipmentDecisions: {
        intentionallyAbsentEquipmentIds: ["12_lead_ecg_machine_equipment"],
        copies: { iv_pole_equipment: 2 },
      },
    }));

    const { status, bundle } = await loadRuntimeBundle(app, source.SCENE_CLOSURE_CASE_ID);
    expect(status).toBe(200);

    // Two mounts, one asset id, distinct realized placement ids — not one that collapsed.
    expect(equipmentIds(bundle)).toEqual([IV, IV]);
    const placementIds = Object.keys(bundle.sceneManifest.equipmentPlacements);
    expect(placementIds).toEqual([IV, `${IV}#2`]);
    expect(new Set(placementIds).size).toBe(2);
    expect(bundle.sceneManifest.equipmentPlacements[IV]?.position)
      .not.toEqual(bundle.sceneManifest.equipmentPlacements[`${IV}#2`]?.position);

    // The ECG it refused is absent from the same scene, so the two decisions do not interfere.
    expect(equipmentIds(bundle)).not.toContain(ECG);
  });

  it("(6) a stale fixture version cannot override the persisted version", async () => {
    const app = createApiApp(undefined, memorySink());
    const wardDeliriumScenario = bankScenario("ward_delirium_med_rec_v1");
    const edited: Scenario = {
      ...wardDeliriumScenario,
      version: wardDeliriumScenario.version + 1,
      actors: wardDeliriumScenario.actors.map((actor) =>
        actor.actorId === "patient_margaret_ellis_v1"
          ? { ...actor, actorId: "patient_margaret_ellis_v2" }
          : actor,
      ),
      eventSchedule: wardDeliriumScenario.eventSchedule.map((entry) => ({ ...entry })),
    };
    expect((await saveCase(app, edited)).status).toBe(201);

    const { bundle } = await loadRuntimeBundle(app, wardDeliriumScenario.scenarioId);
    expect(bundle.scenarioCatalogSource).toBe("authored");
    expect(stagedActorIds(bundle)).toContain("patient_margaret_ellis_v2");
    expect(stagedActorIds(bundle)).not.toContain("patient_margaret_ellis_v1");

    // The in-repo fixture itself is untouched — the persisted document shadowed it, nothing more.
    expect(wardDeliriumScenario.version).toBe(1);
    expect(wardDeliriumScenario.actors.map((actor) => actor.actorId)).toContain("patient_margaret_ellis_v1");
  });

  it("(7) a misidentified physician is named and refused rather than silently substituted", async () => {
    const source = await caseSource();

    // NOT SUBSTITUTED, observed at the served scene: the runtime stages whoever the persisted
    // document names, and never quietly restores the pinned identity in that slot.
    const { app } = await persistedSceneClosureCase((document) => ({
      ...document,
      actors: document.actors.map((actor) =>
        actor.role === "physician" ? { ...actor, actorId: "senior_resident_ward_v9" } : actor,
      ),
    }));
    const { bundle } = await loadRuntimeBundle(app, source.SCENE_CLOSURE_CASE_ID);
    expect(bundle.actors.find((actor) => actor.role === "physician")?.actorId).toBe("senior_resident_ward_v9");
    expect(stagedActorIds(bundle)).not.toContain(source.SCENE_CLOSURE_PINNED_CAST.physician);

    // NAMED, at the producer: the pin check reports who was found instead of the selection.
    const misidentified: CaseDocument = {
      ...source.sceneClosureCaseDocument(),
      actors: source.sceneClosureCaseDocument().actors.map((actor) =>
        actor.role === "physician" ? { ...actor, actorId: "senior_resident_ward_v9" } : actor,
      ),
    };
    expect(source.refuseIfCastDriftsFromSelection(misidentified)).toEqual([
      {
        pinnedRole: "physician",
        expectedActorId: source.SCENE_CLOSURE_PINNED_CAST.physician,
        foundActorId: "senior_resident_ward_v9",
        reason: "the persisted case declares physician senior_resident_ward_v9; the selection pins senior_resident_ward_v1",
      },
    ]);
    expect(source.refuseIfCastDriftsFromSelection(source.sceneClosureCaseDocument())).toEqual([]);

    // A case with NO physician leaves the slot empty rather than filling it from the ED literals.
    const withoutPhysician = await persistedSceneClosureCase((document) => ({
      ...document,
      actors: document.actors.filter((actor) => actor.role !== "physician"),
      eventSchedule: document.eventSchedule.filter((entry) => entry.actorId !== source.SCENE_CLOSURE_PINNED_CAST.physician),
    }));
    const thin = await loadRuntimeBundle(withoutPhysician.app, source.SCENE_CLOSURE_CASE_ID);
    expect(thin.bundle.actors.map((actor) => actor.role)).not.toContain("physician");
    expect(stagedActorIds(thin.bundle)).not.toContain(source.SCENE_CLOSURE_PINNED_CAST.physician);
    expect(source.refuseIfCastDriftsFromSelection({
      ...source.sceneClosureCaseDocument(),
      actors: source.sceneClosureCaseDocument().actors.filter((actor) => actor.role !== "physician"),
    })[0]?.foundActorId).toBe("");
  });

  it("(8) COUNTERWEIGHT: injecting a resolved case changes nothing for a case that authors no decision", async () => {
    const app = createApiApp(undefined, memorySink());

    // KNOWN-GOOD COLUMN: the bundle the constructor produces with NO injection — byte for byte what
    // `apps/ui-xr/src/main.ts:650-652` builds today. Field-by-field equality against the SERVED
    // bundle is what catches a regression the earlier revision shipped, where injecting a resolved
    // fixture silently emptied `equipment` for every case that had not authored a decision.
    for (const scenarioId of [
      "ward_delirium_med_rec_v1",
      "ed_chest_pain_priority_v1",
      "clinic_knee_pain_return_to_play_v1",
    ]) {
      const { status, bundle } = await loadRuntimeBundle(app, scenarioId);
      expect(status, scenarioId).toBe(200);
      expect(bundle.scenarioCatalogSource).toBe("fixture");

      const withoutInjection = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId });
      expect(bundlePayload(bundle), scenarioId).toEqual(servedShapeOf(withoutInjection));

      // Named explicitly, because a deep comparison of two empty scenes would also pass.
      expect(equipmentIds(bundle), scenarioId).toEqual([ECG, IV]);
      expect(bundle.actors.length, scenarioId).toBeGreaterThanOrEqual(3);
      // The fixture's OWN patient reaches the patient slot — a literal from the bank, not a
      // filtered view of what the bundle already contains.
      const fixturePatientId = bankScenario(scenarioId).actors.find((actor) => actor.role === "patient")?.actorId;
      expect(bundle.actors.find((actor) => actor.role === "patient")?.actorId, scenarioId)
        .toBe(fixturePatientId);
    }

    // And the no-selection default is byte-identical to the constructor `main.ts` calls.
    const direct = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const response = await app.request(`/runtime/asset-bundles/${LOCAL_BUNDLE_ID}`);
    const served = (await response.json()) as ServedBundle;
    expect(bundlePayload(served)).toEqual(servedShapeOf(direct));
  });

  it("(9) the persisted case still casts its own people through the constructor main.ts calls", async () => {
    // main.ts passes a scenario id and nothing else, which is defect 2 in the header. Injecting the
    // approved document is what removes it; the id alone still resolves to the ED literals, and
    // that gap is why `api-client.ts` must learn to pass the selection.
    const { source, approved } = await persistedSceneClosureCase();

    const idOnly = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId: source.SCENE_CLOSURE_CASE_ID });
    expect(idOnly.actors.map((actor) => actor.actorId).sort()).toEqual([
      "nurse_maria_alvarez_v1",
      "patient_robert_hayes_v1",
      "spouse_anna_hayes_v1",
    ]);
    expect(idOnly.scenarioId).toBe(source.SCENE_CLOSURE_CASE_ID);

    const withCase = createEdChestPainLocalLearnerRuntimeAssetBundle({
      scenarioId: source.SCENE_CLOSURE_CASE_ID,
      scenario: approved,
    });
    expect(withCase.actors.map((actor) => actor.actorId).sort()).toEqual([
      "daughter_lena_ellis_v1",
      "patient_margaret_ellis_v1",
      "senior_resident_ward_v1",
      "ward_nurse_patel_v1",
    ]);
    expect(resolveScenarioActorCast(source.SCENE_CLOSURE_CASE_ID).map((entry) => entry.actorId)).toEqual([]);
    expect(resolveScenarioActorCast(source.SCENE_CLOSURE_CASE_ID, approved).map((entry) => entry.role).sort())
      .toEqual(["family", "nurse", "patient", "physician"]);
  });
});
