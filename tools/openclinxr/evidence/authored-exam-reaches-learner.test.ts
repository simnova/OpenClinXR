import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#164) — LANE B, which has had **zero board items this entire session**. Per the
 * loop's own rule an empty lane means go read that lane's code, so I did, and I was wrong about what
 * I would find.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — offline and Quest boot must keep working with no API
 * at all. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY HYPOTHESIS WAS WRONG AND THE CORRECTION IS THE HEADER
 *
 * I expected to find #43's old finding still true — "the runtime never calls the API". **It is not.**
 * Verified in the tree:
 *
 *   `main.ts:1740`   `configuredApiBaseUrl = import.meta.env.VITE_OPENCLINXR_API_BASE_URL ?? ""`
 *   `main.ts:1915`   `void bootLearnerExamFormFromApi({ baseUrl: configuredApiBaseUrl, … })`
 *   `learner-exam-form-boot.ts:117` → `resolveLearnerExamScenarios`
 *   `learner-exam-scenario-source.ts:76` fetches the station-run-queue, validates each body, and
 *   falls back to the fixture bank when no baseUrl is set.
 *
 * **The seam is wired end to end and #43 landed properly.** Lane B is more built than the empty board
 * suggested.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY MISSING — verified, not assumed
 *
 * - `VITE_OPENCLINXR_API_BASE_URL` appears in exactly **two** files: `main.ts` and
 *   `ui-admin/src/api-client.ts`
 * - `learner-exam-scenario-source.test.ts` drives a `recordingFetch` **mock**, not a server
 * - **nothing anywhere boots `apps/api` and the resolver together** — no test, no script, no harness
 *
 * So a learner has never received an authored, approved exam from a running server. Only from a mock
 * that always answers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONTRACT I WAS GOING TO WRITE WAS VACUOUS. A PEER ROUND CAUGHT IT.
 *
 * I intended to assert `scenarioSource === "api_queue"`. **That proves nothing.**
 * `learner-exam-scenario-source.ts:137-140` returns `scenarioSource: "api_queue"` **unconditionally**
 * at the tail — including when every single station fell through the GET-miss path at `:126-133` and
 * was re-labelled `bank_residual`.
 *
 * A run in which the API serves a queue of fixture ids, every authored GET 404s, and the learner ends
 * up with the plain fixture bank **satisfies `api_queue`**.
 *
 * **So the assertion that matters is `bodySource: "api_authored"` on a body carrying a field that
 * exists ONLY in the seeded scenario** — a chief concern, title or id that is not in the fixture bank.
 * Contract (1) is written that way and contract (2) exists to keep it honest.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ISOLATED, NOT TWO SERVERS AND A BROWSER
 *
 * The operator's 2026-08-07 direction is to test what is under test, in isolation (§9a). A full
 * two-process Vite + API + Playwright end-to-end is the opposite and it would rot — §7b records a
 * suite that paid three cold boots, took 542 s and left main red.
 *
 * The isolated shape, and the machinery already exists:
 *
 *   `apps/api/src/app.test.ts:45-46` — `createApiApp()` then `app.request("/health")`.
 *   **The API boots in-process. No port, no server, no browser.**
 *
 * So: build a `fetch`-shaped adapter over `app.request`, hand it to the REAL
 * `resolveLearnerExamScenarios`, and the join is proven with no Vite and no browser at all. That is
 * genuinely isolated — an API process and a pure resolver — while still crossing the seam that mocks
 * cannot.
 *
 * **If your run boots a dev server or launches a browser, you have built the wrong thing.**
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CATCHES THAT THE MOCKS CANNOT — and what it does not
 *
 * | failure | why the mock misses it |
 * |---|---|
 * | real Hono route / path / auth mismatch | `recordingFetch` answers whatever URL it is given |
 * | queue empty, or only drafts, so a learner cannot start | mock returns a full queue |
 * | authored body fails `validateScenario` → station silently skipped (`:124-125`) | mock always returns valid |
 * | **silent bank residual** on a GET miss | mock never 404s |
 *
 * **It does NOT prove** anything about the XR runtime, cast, garments, or rooms. Do not let the report
 * claim product end-to-end. `claimScope` and `notEvidenceFor` must say so.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A REAL LANE B WEAKNESS THE PEER ROUND NAMED — check it, and report what you find
 *
 * The activation pool is reportedly thin: often **one** activation-ready blueprint (ED) with
 * `canStartLearnerExam: false` and eleven drafts. If that is true on the current tree, an authored
 * exam cannot reach a learner regardless of transport, and that is a bigger finding than the seam.
 * **I have not verified it** — it came from a peer reading admin tests. Measure it and put the number
 * in your report either way.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **How the exam is seeded.** Through the real assemble/approve routes if they exist, or by
 *    seeding the store directly. Going through the real path proves more and may be much heavier —
 *    say which you chose and what the other would have proven.
 *  - **What distinguishing field marks the authored body.** It must be something the fixture bank
 *    cannot produce, so a bank residual cannot masquerade as authored. Say what you picked.
 *  - **Whether the adapter lives in the test or ships as a helper.** If other slices will want an
 *    in-process API `fetch`, it belongs somewhere reusable — but do not build a framework for one
 *    caller.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a learner-visible scenario body that came from the API, and is satisfiable by seeding a
 * scenario whose id is already in the fixture bank — the resolver would return a bank residual and it
 * would look identical. (2) forbids that by requiring a field only the seeded body has, and requiring
 * the run to have crossed a real route. (3) is green today and forbids buying either by breaking the
 * no-baseUrl path that offline and Quest boot depend on.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectAuthoredExamReachesLearner()`. What must
 * not change: the REAL `resolveLearnerExamScenarios` is called — not a copy, not a re-implementation —
 * and the API is the real `createApiApp()`.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-164/pre-fix.json` BEFORE any product edit, recording:
 * how many blueprints are activation-ready, `canStartLearnerExam`, how many stations the queue
 * returns, and for each what `bodySource` the resolver assigns today. I predict `api_authored` is
 * **zero**. If it is not, say so — that is data about my premise.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether an authored, approved scenario body reaches the learner resolver from a real API.
 * Says NOTHING about the XR scene, actors, rooms, or whether the runtime renders it.
 */

const load = async () => import("./authored-exam-reaches-learner.js") as Promise<Record<string, unknown>>;

type ResolvedStation = {
  scenarioId: string;
  /** "api_authored" is the only value that proves the body came from the server. */
  bodySource: string;
  /** A value present ONLY in the seeded body — proves it is not a bank row wearing the same id. */
  distinguishingValue: string | null;
};

type SeamRun = {
  /** Blueprints the API reports as activation-ready. */
  activationReadyCount: number;
  canStartLearnerExam: boolean;
  /** Stations the station-run-queue returned. */
  queueStationCount: number;
  /** What the REAL resolver returned. */
  scenarioSource: string;
  stations: ResolvedStation[];
  /** Routes actually requested against the in-process app. Proves transport, not a mock. */
  requestedPaths: string[];
  /** Must be zero — this is an isolated seam proof, not a browser end-to-end. */
  devServerBoots: number;
  browserLaunches: number;
  /** The no-baseUrl control, run in the same pass. */
  offline: { scenarioSource: string; stationCount: number; fetchCount: number };
};

type Inspect = () => Promise<SeamRun>;

describe("an authored exam reaches the learner resolver from a real API (#164)", () => {
  it.fails("a seeded authored body arrives with bodySource api_authored", async () => {
    // learner-exam-scenario-source.ts:137-140 returns scenarioSource "api_queue" unconditionally,
    // including when every station fell through the GET-miss path at :126-133 and became a bank
    // residual. So bodySource is the assertion that carries weight, not scenarioSource.
    const mod = await load();
    const inspect = mod["inspectAuthoredExamReachesLearner"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.queueStationCount, "the station-run-queue returned nothing to resolve").toBeGreaterThan(0);

    const authored = run.stations.filter((s) => s.bodySource === "api_authored");
    expect(
      authored.map((s) => s.scenarioId),
      `no station resolved to an authored body — sources were: ${run.stations.map((s) => `${s.scenarioId}=${s.bodySource}`).join(", ")}`,
    ).not.toHaveLength(0);

    for (const s of authored) {
      expect(
        s.distinguishingValue,
        `${s.scenarioId} claims api_authored but carries no field the fixture bank could not produce`,
      ).toBeTruthy();
    }
  }, 900_000);

  it.fails("it crossed a real route, with no dev server and no browser", async () => {
    // Kills two cheap satisfactions at once. First: seeding a scenario whose id is already in the
    // fixture bank, so a bank residual looks identical to an authored body. Second: proving the seam
    // by booting Vite and a browser, which is the 542-second suite shape (§7b) and the opposite of
    // the operator's isolation direction (§9a).
    const mod = await load();
    const inspect = mod["inspectAuthoredExamReachesLearner"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(
      run.requestedPaths.length,
      "no route was requested — the resolver never reached the API",
    ).toBeGreaterThan(1);
    expect(
      run.requestedPaths.some((p) => /station-run-queue/u.test(p)),
      `the station-run-queue was never requested; paths were: ${run.requestedPaths.join(", ")}`,
    ).toBe(true);

    expect(run.devServerBoots, "this is an isolated seam proof — no dev server").toBe(0);
    expect(run.browserLaunches, "this is an isolated seam proof — no browser").toBe(0);
  }, 900_000);

  it.fails("offline boot is untouched (COUNTERWEIGHT)", async () => {
    // The whole point of the fixture fallback is that a Quest with no network still boots an exam.
    // Anything that makes the API mandatory breaks the only path that has ever run on hardware.
    const mod = await load();
    const inspect = mod["inspectAuthoredExamReachesLearner"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.offline.scenarioSource, "no-baseUrl boot stopped reporting fixture_offline")
      .toBe("fixture_offline");
    expect(run.offline.stationCount, "no-baseUrl boot returned no stations").toBeGreaterThan(0);
    expect(run.offline.fetchCount, "no-baseUrl boot made a network call").toBe(0);
  }, 900_000);
});
