import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#88) — the server says authored wins, the client asks the bank first, and the
 * result is labelled as though it came from the API.
 *
 * TWO `it.fails` FLIP (1 and 2) — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT and is a plain `it(` — GREEN RIGHT NOW and it must stay green. Unlike
 *       recent plants, `resolveLearnerExamScenarios` already exists, so the counterweight can run
 *       today; it asserts behaviour the obvious fix would destroy.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * TWO HALVES OF THE SAME PRODUCT DISAGREE, IN WRITING
 *
 * Server (`apps/api/src/exam-assembly-pool.ts:6-17`), its own doc comment:
 *
 *     "Assembly pool = fixture bank UNION persisted authored scenarios... Authored wins on
 *      scenarioId clash (reversible default). Only approved authored scenarios enter the pool."
 *
 * Client (`apps/ui-xr/src/learner-exam-scenario-source.ts:93-101`), for each id the queue returns:
 *
 *     const fromBank = scenarioBank.find((s) => s.scenarioId === scenarioId) ?? ...;
 *     if (fromBank) { resolved.push(fromBank); continue; }   // <- the API is never asked
 *
 * `GET /scenarios/:id` below it is reached ONLY for an id absent from the bank. And the bank holds
 * all fourteen shipped scenarios, so **every scenario a faculty member can currently edit is one the
 * learner receives from the build-time fixture instead.** Authored-wins is implemented on the server
 * and discarded by the client.
 *
 * THE LABEL IS THE SHARPER HALF. That path returns `scenarioSource: "api_queue", fallbackActive:
 * false` (`:114-118`). The queue supplied IDS; the BODIES came from fixtures. This module built a
 * deliberate three-way vocabulary — `fixture_offline` (a supported zero-network mode, not a
 * fallback), `fixture_fallback` (transport failure, labelled), `api_queue` — precisely so provenance
 * could not be misreported, and this is the one case it has no word for.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE OBVIOUS FIX IS WRONG AND CONTRACT (3) EXISTS TO STOP IT
 *
 * "When a baseUrl is present, use the API and drop the bank" empties seed exams. Bank ids that were
 * never authored return 404 from `GET /scenarios/:id` (the authored store only — `authoring-routes.ts:32-38`),
 * the `catch` at `:108-110` skips the station rather than inventing one, and the learner gets an exam
 * with no stations. A bank RESIDUAL on GET-miss is required, not optional.
 *
 * A PER-SET LABEL IS THE WRONG SHAPE. A real queue mixes authored and residual bodies, so one
 * `scenarioSource` for the whole set cannot describe it honestly whatever fourth value is added.
 * Provenance belongs on each record. Keep `scenarioSource` for QUEUE mode — it is correct and the
 * mirror type at `exam-assembly/src/types.ts:195-206` depends on it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE THREE PULL APART. (1) is satisfiable by always preferring the API, which empties seed
 * exams — (3) forbids that. (3) is satisfiable by never asking the API, which is today's bug — (1)
 * forbids that. (2) is satisfiable by neither, because a label is not a fetch.
 *
 * WHAT THIS WILL BREAK, from the peer round — expect to touch these and say what you changed:
 * `api-client` and the `ExamStationRunQueueScenarioSource` mirror (`exam-assembly/src/types.ts:197`),
 * the exam-assembly snapshot type, and the admin snapshot UI that renders the source.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * NOT DETERMINED, and I have not distinguished between these:
 *   - whether bank-first was ever deliberate. The peer round found NO MADR, comment or test
 *     establishing it as an offline or caching optimisation, and the healthy-path test only asserts
 *     the queue fetch and the `api_queue` label — never "do not GET bodies". If you find a decision
 *     record I missed, STOP and say so; this contract would then be wrong.
 *   - whether N extra GETs at exam boot (14 on a full seed queue) is a latency problem worth
 *     batching. Measure it if it looks close; do not pre-optimise.
 *   - whether any admin flow can persist an edit to an existing id in practice, or only in principle.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `resolveLearnerExamScenarios` returning records
 * that each carry their own body provenance. Change the shape and say why if a different one is
 * better. What must not change: an authored body beats a fixture of the same id, a GET miss still
 * yields the fixture, and provenance is recorded per record rather than per set.
 *
 * DO NOT weaken `#53`'s fail-closed behaviour: a malformed 200 body still throws and is never
 * converted into a labelled fallback. That is a separate guarantee and it is currently correct.
 *
 * REQUIRED, NOT OPTIONAL: this must be reachable from the running app, not just from the resolver's
 * unit tests. Three slices in this repo landed correct and inert because a brief said wiring was
 * optional.
 *
 * SCOPE: which body a learner receives for a scenario id, and how that is labelled. Says NOTHING
 * about whether authored content is clinically sound — that needs a clinician — nor about the
 * authoring UI's usability.
 */

const load = async () =>
  import("./learner-exam-scenario-source.js") as Promise<Record<string, unknown>>;

/** Where a single record's BODY came from — not where the queue came from. */
type BodySource = "api_authored" | "bank_residual";

type ResolvedRecord = { scenarioId: string; bodySource?: BodySource } & Record<string, unknown>;
type Result = {
  scenarios: ResolvedRecord[];
  scenarioSource: "fixture_offline" | "fixture_fallback" | "api_queue";
  fallbackActive: boolean;
};
type Resolve = (input: {
  baseUrl?: string;
  blueprintId: string;
  fetch?: typeof fetch;
}) => Promise<Result>;

/** In the bank AND authorable — the collision at the heart of this issue. */
const SHARED_ID = "ed_chest_pain_priority_v1";

/**
 * The live queue shape, read off `parseExamStationRunQueueScenarioIds`
 * (`exam-assembly/src/assembly.ts:212-227`): `{ stationQueue: [{ scenarioId }] }`. An earlier draft
 * of this fixture used `{ scenarioIds: [...] }`, which the parser rejects outright — a contract
 * planted against a shape that does not exist tests nothing.
 */
const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

/** Queue returns the shared id; GET serves an AUTHORED body carrying a marker the fixture lacks. */
const fetchWithAuthored: typeof fetch = (async (url: string | URL) => {
  const href = String(url);
  if (href.includes("station-run-queue")) return jsonResponse({ stationQueue: [{ scenarioId: SHARED_ID }] });
  if (href.includes(`/scenarios/${SHARED_ID}`)) {
    return jsonResponse({ scenario: { scenarioId: SHARED_ID, status: "approved", authoredMarker: "from_admin" } });
  }
  return jsonResponse({ message: "not found" }, 404);
}) as unknown as typeof fetch;

/** Queue returns the shared id; nothing is authored, so GET 404s — the seed-exam case. */
const fetchWithNothingAuthored: typeof fetch = (async (url: string | URL) => {
  const href = String(url);
  if (href.includes("station-run-queue")) return jsonResponse({ stationQueue: [{ scenarioId: SHARED_ID }] });
  return jsonResponse({ message: "not found" }, 404);
}) as unknown as typeof fetch;

describe("an authored scenario reaches the learner (#88)", () => {
  it.fails("an authored body beats a fixture of the same id", async () => {
    // The server already implements this (exam-assembly-pool.ts:9, "Authored wins on scenarioId
    // clash"). The client discards it by checking the bank first and never asking.
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as Resolve | undefined;
    expect(resolve).toBeTypeOf("function");

    const result = await resolve!({ baseUrl: "http://api.test", blueprintId: "step2cs-seed", fetch: fetchWithAuthored });
    const record = result.scenarios.find((s) => s.scenarioId === SHARED_ID);
    expect(record, "the shared id did not resolve at all").toBeDefined();
    expect(
      record!["authoredMarker"],
      "the learner got the build-time fixture; the authored edit never arrived",
    ).toBe("from_admin");
  });

  it.fails("each record says where its own body came from", async () => {
    // A per-set label cannot describe a mixed queue honestly. scenarioSource stays for QUEUE mode;
    // body provenance belongs on the record.
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as Resolve | undefined;
    expect(resolve).toBeTypeOf("function");

    const authored = await resolve!({ baseUrl: "http://api.test", blueprintId: "step2cs-seed", fetch: fetchWithAuthored });
    expect(authored.scenarios[0]?.bodySource, "an authored body is not labelled as such").toBe("api_authored");

    const residual = await resolve!({ baseUrl: "http://api.test", blueprintId: "step2cs-seed", fetch: fetchWithNothingAuthored });
    expect(residual.scenarios[0]?.bodySource, "a fixture body is reported as authored").toBe("bank_residual");
  });

  it("a queue id with nothing authored still yields its fixture (COUNTERWEIGHT — green TODAY, must stay green)", async () => {
    // Kills the obvious fix. "baseUrl present => API only" makes every un-authored seed id 404, the
    // catch skips the station, and the learner gets an exam with no stations at all. The bank
    // residual is required, not optional.
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as Resolve | undefined;
    expect(resolve).toBeTypeOf("function");

    const result = await resolve!({
      baseUrl: "http://api.test",
      blueprintId: "step2cs-seed",
      fetch: fetchWithNothingAuthored,
    });
    expect(result.scenarios.length, "the seed exam came back with no stations").toBeGreaterThan(0);
    expect(result.scenarios[0]?.scenarioId).toBe(SHARED_ID);
    // Still a healthy queue — a GET miss on an un-authored id is not a transport failure.
    expect(result.fallbackActive, "a 404 on an un-authored id was mislabelled as a degrade").toBe(false);
  });
});
