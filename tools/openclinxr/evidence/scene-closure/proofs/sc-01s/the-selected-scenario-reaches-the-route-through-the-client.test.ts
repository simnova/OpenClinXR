// SOURCE BARREL, not the package name. `@openclinxr/xr-station` resolves through
// `exports["."]` to `dist/index.js`, and `dist/` is gitignored, so on a fresh clone this file did
// not fail — it failed to RESOLVE, and vitest reported "no tests" for it, which reads as a pass in
// any invocation that only checks for failures. Measured by moving dist aside. The root
// `//#test:tools` turbo task carries no `dependsOn`, so nothing builds the package before the
// tools suite runs, and `pnpm test` runs the tools suite FIRST. This is the same barrel — line 139
// of that index aliases `createStationApiClient` — and it matches how the other four imports in
// this file already reach across the tree. Take the alias BY ITS EXPORTED NAME: the barrel maps
// `createAssembledStationApiClient` to `station-api-client.ts`'s wrapper, not to `api-client.ts`'s
// base factory, and renaming the base one instead fails as "createStationApiClient is not a function".

import { describe, expect, it } from "vitest";
import { createApiApp } from "../../../../../../apps/api/src/index.js";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import type { ApiPersistenceSink, ApiScenarioReviewDecisionRecord } from "../../../../../../packages/openclinxr/rest/src/index.js";
import { scenarioBank } from "../../../../../../packages/openclinxr/scenario-fixtures/src/index.js";
import type { Scenario } from "../../../../../../packages/openclinxr/shared-schemas/src/index.js";
import { createAssembledStationApiClient } from "../../../../../../packages/openclinxr/xr-station/src/index.js";

/**
 * SC-01S — the learner's SELECTED scenario id reaches the API route through the normal client.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT (baseline `1da9ce04`, measured 2026-09-09)
 *
 * SC-01 landed the ROUTE half: `GET /runtime/asset-bundles/:bundleId` now reads `?scenarioId=`,
 * resolves it authored-first through the existing `ScenarioCatalogPort`/`resolveScenarioById`, and
 * refuses an unresolvable id with `scenario_not_found` instead of serving the ED bay.
 *
 * The CLIENT half was untouched, so that query parameter had ZERO PRODUCTION CALLERS.
 * `getLearnerRuntimeAssetBundle(bundleId)` took no scenario argument
 * (`packages/openclinxr/xr-station/src/api-client.ts:155`) and `apps/ui-xr/src/main.ts:924` called
 * it without one, while `main.ts:1017-1027` was already holding the selection. Independent review
 * recorded this as A01 unmet: the persisted id never reached the main-UI consumer.
 *
 * MEASURED on the baseline, through the assembled client `main.ts:291` imports and `main.ts:1464`
 * constructs:
 *
 *   requested URL   http://localhost:8787/runtime/asset-bundles/local_exam_run%3A…%3Aruntime-assets
 *   served cast     patient_robert_hayes_v1, nurse_maria_alvarez_v1, spouse_anna_hayes_v1
 *   selection       ward_delirium_med_rec_v1, in every place `main.ts` looks for it
 *
 * The ED bay, for a ward delirium case, with `scenarioId` echoing the request so
 * `describeRuntimeBundleScenarioMatch` reported `matches: true`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS EXERCISES
 *
 * The real `createAssembledStationApiClient` from the `@openclinxr/xr-station` ROOT BARREL — the
 * exact factory `apps/ui-xr/src/main.ts:291,1464` imports and calls — driving the real Hono API app
 * from `apps/api/src/index.ts` through `fetch`. Nothing is stubbed between them: the client builds
 * the URL, the route parses it, and the assertions read the served bundle.
 *
 * `main.ts` is NOT in this card's frozen write roots and is not edited. Two of the clauses below
 * therefore exercise the AMBIENT path — the client reads the same selection `main.ts:1017-1027`
 * reads — which is what makes the parameter reachable from `main.ts` AS IT STANDS.
 *
 * NOT TESTED / RESIDUAL, stated rather than implied:
 *   - No browser ran. `window` is stubbed on `globalThis` for the ambient clauses; this proves the
 *     client reads the selection, not that a Vite bundle in Chrome did.
 *   - `apps/ui-xr/src/main.ts` still passes no explicit argument. The ambient path is what carries
 *     the id today; an explicit call site is available to SC-02 and is asserted here as an API, not
 *     as a shipped caller.
 *   - Dialogue, vitals and room props remain ED literals for every case (SC-02's).
 *   - `describeRuntimeBundleScenarioMatch` is not called here; `@openclinxr/xr-pose` is not a
 *     dependency of this path. Its entire input is `bundle.scenarioId`, read directly below.
 *
 * CLAIM SCOPE: a local selected scenario id reaching a local API route through the production
 * client. NOT EVIDENCE FOR clinical validity, scoring validity, learner launch readiness, headset
 * readiness or public deployment.
 */

const LOCAL_BUNDLE_ID = "local_exam_run:ed_chest_pain_local_encounter:runtime-assets";
const ED_CAST = ["nurse_maria_alvarez_v1", "patient_robert_hayes_v1", "spouse_anna_hayes_v1"];
const WARD_CAST = [
  "daughter_lena_ellis_v1",
  "patient_margaret_ellis_v1",
  "senior_resident_ward_v1",
  "ward_nurse_patel_v1",
];

type ServedBundle = {
  error?: string;
  scenarioId: string;
  scenarioCatalogSource?: string;
  retrievalMode?: string;
  actors: Array<{ actorId: string }>;
  equipment: Array<{ equipmentId: string }>;
  sceneManifest: { equipmentPlacements: Record<string, { position: { x: number; y: number; z: number } }> };
};

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

/** Every URL the client asked for, in order. The whole client half is measured here. */
type Wire = { urls: string[]; app: ReturnType<typeof createApiApp> };

function wireToApi(sink?: ApiPersistenceSink): Wire & { fetch: typeof fetch } {
  const app = sink ? createApiApp(undefined, sink) : createApiApp();
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    urls.push(request.url);
    return app.request(request);
  };
  return { urls, app, fetch: fetcher };
}

/**
 * Stub the two browser surfaces `main.ts:1017-1027` reads its selection from, for one call.
 *
 * Restored in `finally` so a failure cannot leak a `window` into a later suite.
 */
async function withBrowserSelection<T>(
  selection: { search?: string; storedScenarioId?: string },
  body: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as Record<string, unknown>;
  const hadWindow = "window" in globals;
  const priorWindow = globals["window"];
  const stored = new Map<string, string>();
  if (selection.storedScenarioId !== undefined) stored.set("openclinxr.scenarioId", selection.storedScenarioId);
  globals["window"] = {
    location: { search: selection.search ?? "" },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    },
  };
  try {
    return await body();
  } finally {
    if (hadWindow) globals["window"] = priorWindow;
    else delete globals["window"];
  }
}

/** The bundle payload with the transport envelope stripped, for field-by-field comparison. */
function payloadOf(bundle: ServedBundle): Record<string, unknown> {
  const { retrievalMode: _retrievalMode, scenarioCatalogSource: _source, ...rest } = bundle as Record<string, unknown> & ServedBundle;
  delete (rest as Record<string, unknown>)["productionCloudCall"];
  return rest as unknown as Record<string, unknown>;
}

function castOf(bundle: ServedBundle): string[] {
  return bundle.actors.map((actor) => actor.actorId).sort();
}

describe("SC-01S — the selected scenario reaches the route through the normal client", () => {
  it("SC-01S-required-behavior", async () => {
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // (1) client-carries-selected-scenario-id — a configured selection reaches the route.
    //     COUNTERWEIGHT: with the client half reverted the URL carries no query at all and the
    //     served cast is the ED bay, which is exactly what the baseline measured.
    const configured = wireToApi();
    const configuredClient = createAssembledStationApiClient({
      baseUrl: "http://localhost:8787",
      fetch: configured.fetch,
      selectedScenarioId: () => "ward_delirium_med_rec_v1",
    });
    const configuredBundle = (await configuredClient.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    expect(configured.urls).toHaveLength(1);
    expect(configured.urls[0]).toContain("?scenarioId=ward_delirium_med_rec_v1");
    expect(castOf(configuredBundle)).toEqual(WARD_CAST);
    expect(configuredBundle.scenarioId).toBe("ward_delirium_med_rec_v1");

    // (2) The AMBIENT query path — `?scenarioId=` in the page URL, which `main.ts:1017-1027`
    //     reads and `main.ts:1464` constructs no resolver for. This is the clause that makes the
    //     parameter reachable from `main.ts` with no edit to it.
    const ambientQuery = wireToApi();
    const ambientQueryBundle = await withBrowserSelection({ search: "?scenarioId=ward_delirium_med_rec_v1" }, async () => {
      const client = createAssembledStationApiClient({ baseUrl: "http://localhost:8787", fetch: ambientQuery.fetch });
      return (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    });
    expect(ambientQuery.urls[0]).toContain("?scenarioId=ward_delirium_med_rec_v1");
    expect(castOf(ambientQueryBundle)).toEqual(WARD_CAST);

    // (3) The AMBIENT storage path — `openclinxr.scenarioId`, which `main.ts:1015` writes.
    const ambientStore = wireToApi();
    const ambientStoreBundle = await withBrowserSelection({ storedScenarioId: "ward_delirium_med_rec_v1" }, async () => {
      const client = createAssembledStationApiClient({ baseUrl: "http://localhost:8787", fetch: ambientStore.fetch });
      return (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    });
    expect(ambientStore.urls[0]).toContain("?scenarioId=ward_delirium_med_rec_v1");
    expect(castOf(ambientStoreBundle)).toEqual(WARD_CAST);

    // (4) An EXPLICIT per-call id outranks both. A caller SC-02 could add in `main.ts` wins over a
    //     stale ambient value; without the precedence this serves the clinic knee cast.
    const explicit = wireToApi();
    const explicitBundle = await withBrowserSelection({ search: "?scenarioId=clinic_knee_pain_return_to_play_v1" }, async () => {
      const client = createAssembledStationApiClient({
        baseUrl: "http://localhost:8787",
        fetch: explicit.fetch,
        selectedScenarioId: () => "clinic_knee_pain_return_to_play_v1",
      });
      return (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID, {
        scenarioId: "ward_delirium_med_rec_v1",
      })) as unknown as ServedBundle;
    });
    expect(explicit.urls[0]).toContain("?scenarioId=ward_delirium_med_rec_v1");
    expect(castOf(explicitBundle)).toEqual(WARD_CAST);

    // (5) catalog-source-reported — the route names WHERE the case came from, so a fixture cannot
    //     pass as an authored, reviewed case.
    expect(configuredBundle.scenarioCatalogSource).toBe("fixture");

    // (6) unresolvable-id-refuses-with-scenario-not-found and ed-bay-is-not-served-for-an-unknown-id.
    //     `ed_chest_pain_priority_v2` is not in `scenarioBank`. The client must surface the refusal
    //     and MUST NOT receive the ED cast under that id.
    const unknown = wireToApi();
    const unknownClient = createAssembledStationApiClient({
      baseUrl: "http://localhost:8787",
      fetch: unknown.fetch,
      selectedScenarioId: () => "ed_chest_pain_priority_v2",
    });
    await expect(unknownClient.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)).rejects.toThrow(/404 scenario_not_found/u);
    const refusal = (await (await unknown.app.request(unknown.urls[0]!)).json()) as ServedBundle;
    expect(refusal.error).toBe("scenario_not_found");
    expect(refusal.actors).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // absent-scenario-id-keeps-prior-default — the no-selection request is byte-identical to the
  // constructor called with no arguments, URL included. This is the clause a change that always
  // appends a query fails, and it is why the default cannot drift.
  it("absent-scenario-id-keeps-prior-default", async () => {
    const wire = wireToApi();
    const client = createAssembledStationApiClient({ baseUrl: "http://localhost:8787", fetch: wire.fetch });
    const bundle = (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    expect(wire.urls).toEqual([
      `http://localhost:8787/runtime/asset-bundles/${encodeURIComponent(LOCAL_BUNDLE_ID)}`,
    ]);
    expect(bundle.scenarioCatalogSource).toBeUndefined();
    expect(payloadOf(bundle)).toEqual(
      JSON.parse(JSON.stringify(createEdChestPainLocalLearnerRuntimeAssetBundle())) as Record<string, unknown>,
    );
  });

  // fixture-id-still-resolves — the shipped ED case still resolves through the route exactly as
  // before, cast and equipment together.
  it("fixture-id-still-resolves", async () => {
    const wire = wireToApi();
    const client = createAssembledStationApiClient({
      baseUrl: "http://localhost:8787",
      fetch: wire.fetch,
      selectedScenarioId: () => "ed_chest_pain_priority_v1",
    });
    const bundle = (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    expect(castOf(bundle)).toEqual(ED_CAST);
    expect(bundle.scenarioCatalogSource).toBe("fixture");
    expect(bundle.equipment.map((row) => row.equipmentId)).toEqual(["ecg_cart_equipment", "iv_stand_equipment"]);
  });

  // authored-shadows-fixture-of-same-id — a PERSISTED case with a bank id wins over the fixture,
  // and the route says so. Without authored-first resolution this serves the bank cast.
  it("authored-shadows-fixture-of-same-id", async () => {
    const sink = memorySink();
    const wire = wireToApi(sink);
    const fixture = scenarioBank.find((candidate) => candidate.scenarioId === "ward_delirium_med_rec_v1");
    expect(fixture).toBeDefined();
    const authored = {
      ...(fixture as Scenario),
      version: (fixture as Scenario).version + 1,
      actors: (fixture as Scenario).actors.map((actor) =>
        actor.role === "family" ? { ...actor, actorId: "sc01s_authored_shadow_relative_v1" } : actor,
      ),
    };
    const saved = await wire.app.request("/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: authored }),
    });
    expect(saved.status).toBe(201);

    const client = createAssembledStationApiClient({
      baseUrl: "http://localhost:8787",
      fetch: wire.fetch,
      selectedScenarioId: () => "ward_delirium_med_rec_v1",
    });
    const bundle = (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    expect(bundle.scenarioCatalogSource).toBe("authored");
    expect(castOf(bundle)).toContain("sc01s_authored_shadow_relative_v1");
    expect(castOf(bundle)).not.toContain("daughter_lena_ellis_v1");
  });

  // equipment-survives-an-injected-document — the regression independent review MEASURED. Injecting
  // a resolved document must not empty `equipment` or `sceneManifest.equipmentPlacements` for the
  // two cases where it did. Compared against the uninjected default, not against a literal.
  it("equipment-survives-an-injected-document", async () => {
    const bare = wireToApi();
    const bareClient = createAssembledStationApiClient({ baseUrl: "http://localhost:8787", fetch: bare.fetch });
    const uninjected = (await bareClient.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
    const defaultEquipment = uninjected.equipment.map((row) => row.equipmentId);
    const defaultPlacements = uninjected.sceneManifest.equipmentPlacements;
    expect(defaultEquipment.length).toBeGreaterThan(0);
    expect(Object.keys(defaultPlacements).length).toBeGreaterThan(0);

    for (const scenarioId of ["ward_delirium_med_rec_v1", "clinic_knee_pain_return_to_play_v1"]) {
      const wire = wireToApi();
      const client = createAssembledStationApiClient({
        baseUrl: "http://localhost:8787",
        fetch: wire.fetch,
        selectedScenarioId: () => scenarioId,
      });
      const injected = (await client.getLearnerRuntimeAssetBundle(LOCAL_BUNDLE_ID)) as unknown as ServedBundle;
      expect(injected.scenarioId).toBe(scenarioId);
      expect(injected.equipment.map((row) => row.equipmentId)).toEqual(defaultEquipment);
      expect(injected.sceneManifest.equipmentPlacements).toEqual(defaultPlacements);
    }
  });
});
