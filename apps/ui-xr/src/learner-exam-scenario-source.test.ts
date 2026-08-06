import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#43) — the learner runtime cannot see what the factory produces.
 *
 * `main.ts:20-21` imports `scenarioBank` at build time and `:2073-2085` resolves an exam form's
 * scenarios from it, falling back to `edChestPainScenario`. There is no scenario-sourcing call in
 * the API client, which is otherwise real and wired (`api-client.ts:115`, constructed at
 * `main.ts:1775` only when a base url is configured). So #32 (assembly → runtime), #25 (authored
 * scenarios into the pool) and #39 (approval enforced server-side) all terminate at the app
 * boundary: a case authored, reviewed, approved and assembled still cannot appear in an exam.
 *
 * WHY THIS FILE AND NOT main.ts: `apps/ui-xr/src/main.ts` is size-frozen at 10255 lines
 * (file-size-budgets.ts:43) and sits at 10254 — one line of headroom, on a file the budget itself
 * calls the "#1 paydown". The freeze is shrink-only and must never be raised. `main.ts` also
 * touches the DOM at import (`requireElement`, :539) and does not export the resolver, so it is not
 * directly testable. The fix is therefore forced to extract, which is the point: this is the slice
 * that finally moves ratchet debt, flat at size=38148 for eighteen cycles.
 *
 * NOT DISCOVERED UNTIL THE PEER ROUND, and it sizes the work: the form is built SYNCHRONOUSLY at
 * module scope (`main.ts:1810`), while any HTTP resolution is async. This is real restructuring —
 * an async init or a deferred form build — not a three-line wiring swap.
 *
 * The three contracts pull against each other. Always-bank fails the first; always-fetch fails the
 * second; fabricating an id without HTTP fails the first's request assertion; skipping validation
 * fails the third.
 */

type RecordedRequest = { url: string; method: string };

/** Mirrors api-client.test.ts: record URLs so "fetched it" cannot be faked by a literal. */
function recordingFetch(requests: RecordedRequest[], responder: (url: string) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    return {
      ok: true,
      status: 200,
      json: async () => responder(url),
    } as Response;
  }) as unknown as typeof fetch;
}

const load = async () => import("./learner-exam-scenario-source.js") as Promise<Record<string, unknown>>;

type Resolver = (input: {
  baseUrl?: string | undefined;
  blueprintId: string;
  fetch?: typeof fetch;
}) => Promise<Array<{ scenarioId: string }>>;

describe("learner exam scenario source (#43)", () => {
  it("resolves an authored approved scenario absent from the fixture bank when an api base url is configured", async () => {
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as Resolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const requests: RecordedRequest[] = [];
    // An id that exists in no fixture — the only way it can appear is over HTTP.
    const scenarios = await resolve!({
      baseUrl: "http://localhost:8787",
      blueprintId: "step2cs-seed",
      fetch: recordingFetch(requests, (url) =>
        url.includes("/station-run-queue")
          ? { stationQueue: [{ scenarioId: "authored_only_case_v1" }] }
          : { scenarioId: "authored_only_case_v1", status: "approved" }),
    });

    expect(scenarios.map((s) => s.scenarioId)).toContain("authored_only_case_v1");
    // Kills the laziest dual pass — `if (baseUrl) return [...bank, fake]` with no HTTP at all.
    expect(requests.some((r) => r.url.includes("/station-run-queue"))).toBe(true);
  });

  it("falls back to the fixture bank with no api base url, so offline and Quest boot are unaffected", async () => {
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as Resolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const requests: RecordedRequest[] = [];
    const scenarios = await resolve!({
      baseUrl: undefined,
      blueprintId: "step2cs-seed",
      fetch: recordingFetch(requests, () => ({})),
    });

    // Offline is the dev-portless and headset-boot path; it must not acquire a network dependency.
    expect(requests).toEqual([]);
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it("refuses a scenario body that fails validateScenario rather than assembling it", async () => {
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as Resolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const requests: RecordedRequest[] = [];
    // The client must not trust raw JSON: an exam station is built from whatever this returns.
    const scenarios = await resolve!({
      baseUrl: "http://localhost:8787",
      blueprintId: "step2cs-seed",
      fetch: recordingFetch(requests, (url) =>
        url.includes("/station-run-queue")
          ? { stationQueue: [{ scenarioId: "malformed_case_v1" }] }
          : { scenarioId: "malformed_case_v1", status: "approved", actors: "not-an-array" }),
    });

    expect(scenarios.map((s) => s.scenarioId)).not.toContain("malformed_case_v1");
  });
});

/**
 * PLANTED CONTRACT (#53, second half) — the silence, not just the mock gap.
 *
 * With a base url configured, a queue that parses to zero ids on an HTTP 200 currently falls back to
 * the fixture bank without a word. That IS the defect; the unbound mock (see the exam-assembly
 * contract) is only why it stays invisible in tests. Fixing the binding and leaving this in place
 * would close the test gap and ship the production behaviour unchanged.
 *
 * The peer round raised this and it was not in my original framing of the issue.
 *
 * SCOPE, and it matters: fail-closed applies ONLY when a base url is configured. The contract above
 * this one — "falls back to the fixture bank with no api base url, so offline and Quest boot are
 * unaffected" — must keep passing untouched. Offline is not a degraded state; it is the supported
 * one. What must never happen again is a CONFIGURED runtime quietly serving fixtures because a
 * response shape moved.
 *
 * HOW it surfaces is the implementer's choice — throw, a rejected promise, or a recorded runtime
 * error the caller must handle. Record the choice in the commit. What must not happen is a silent
 * empty list.
 */
describe("a configured runtime does not silently serve fixtures (#53)", () => {
  it("fails instead of falling back when a configured api returns an unparseable queue", async () => {
    const mod = await import("./learner-exam-scenario-source.js") as Record<string, unknown>;
    const resolve = mod["resolveLearnerExamScenarios"] as undefined | ((input: {
      baseUrl?: string | undefined;
      blueprintId: string;
      fetch?: typeof fetch;
    }) => Promise<Array<{ scenarioId: string }>>);
    expect(resolve).toBeTypeOf("function");

    // HTTP 200, but the queue shape has moved — exactly what a producer rename looks like.
    const movedShape = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ queue: [{ scenarioId: "authored_only_case_v1" }] }),
    })) as unknown as typeof fetch;

    await expect(resolve!({
      baseUrl: "http://localhost:8787",
      blueprintId: "step2cs-seed",
      fetch: movedShape,
    })).rejects.toThrow();
  });
});

/**
 * PLANTED CONTRACTS (#57) — a configured runtime serves fixtures silently when its API is down.
 *
 * THREE OF THE FOUR CONTRACTS BELOW ARE PLANTED AND FLIP. The fourth — the malformed-body one —
 * is LIVE ALREADY (#53 made it fail closed) and must keep passing; it is marked in place. The #43
 * contracts above are also live; do not edit them. This header is THE RECORD, not scratch — flip the `it.fails`, append a
 * `## FIXED (#57)` block below, and leave the measured table intact.
 *
 * MEASURED, six silent paths, not the one the issue originally described:
 *
 *   learner-exam-scenario-source.ts:63-71   queue fetch fails -> `return [...scenarioBank]`, no marker
 *   main.ts:2066-2072                       outer catch swallows EVERYTHING from resolve, including
 *                                           #53's deliberate shape-drift throw
 *   main.ts:1810                            form built from fixtures BEFORE api boot
 *   main.ts:2070                            `?? examFormRunState` keeps fixtures on empty/unassemblable
 *   main.ts:2083-2087                       assembly's own `catch { return null }`
 *   main.ts:2075-2076                       snapshot persist `.catch(() => {})`
 *
 * The first two are INDEPENDENT. Fixing either alone leaves the other, which is why #53's guarantee
 * does not currently reach the running app.
 *
 * THE DECISION, made rather than deferred: transport failure DEGRADES WITH A LABEL, shape drift
 * STILL REFUSES. A headset mid-session must not hard-fail on a server blip — so the exam continues
 * on fixtures, and stops pretending they are authored.
 *
 * MATCH THE EXISTING VOCABULARY, do not invent a third. The asset path already solved this:
 * `fallbackActive` / `fallbackReason` / `activeBundleSource: "local_fixture_fallback" | "api_bundle"`
 * (main.ts:657-665, runtime-state.ts:838-841) and `retrievalMode` (api-client.ts:110).
 *
 * THE FOUR CONTRACTS PULL APART IN PAIRS, and no cheap implementation satisfies all four.
 *
 * Marking every fixture result as a fallback fails the offline contract — no baseUrl is a deliberate
 * mode, not a degradation. Never marking one fails the transport contract. Marking on any exception
 * fails the shape-drift contract, because a malformed body on a 200 must still throw rather than
 * become a tidy labelled fallback. And returning a bare array with a property bolted on fails the
 * reachable-queue contract, which requires the healthy path to say so positively.
 *
 * OFFLINE IS NOT A FALLBACK. That distinction is the one most likely to be collapsed by an
 * implementation that treats "did we end up on fixtures?" as the question. The question is "did we
 * end up on fixtures because something failed?".
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read a discriminated result from
 * `resolveLearnerExamScenarios` carrying `scenarioSource` and, when degraded, `fallbackActive` and a
 * reason. A different shape is fine if the reason is recorded at the call site. What must not
 * change: offline is not a fallback, transport failure is labelled, shape drift still throws, and
 * the bare-array return is gone so callers cannot ignore it.
 *
 * SCOPE: resolution only. Whether a human can SEE the label is `learner-exam-form-boot.test.ts`, and
 * whether a reviewer can see it later is the ui-admin contract. All three are required by the issue;
 * this file alone does not close it.
 */
/** The result shape this slice introduces; the live #43/#53 `Resolver` above stays as it is. */
type DegradedResolver = (input: {
  baseUrl?: string | undefined;
  blueprintId: string;
  fetch?: typeof fetch;
}) => Promise<unknown>;

describe("a configured runtime says when it fell back to fixtures (#57)", () => {
  it.fails("configured baseUrl with a failing queue fetch reports fixture_fallback rather than a bare bank", async () => {
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as DegradedResolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const downstream = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = (await resolve!({
      baseUrl: "http://localhost:8787",
      blueprintId: "step2cs-seed",
      fetch: downstream,
    })) as unknown as Record<string, unknown>;

    expect(Array.isArray(result), "a bare array cannot carry the reason it is a bank").toBe(false);
    expect(result["scenarioSource"]).toBe("fixture_fallback");
    expect(result["fallbackActive"]).toBe(true);
    expect(String(result["fallbackReason"] ?? ""), "a reason nobody can read is not a reason").not.toHaveLength(0);
    // The learner still gets an exam — this is degrade-with-label, not refuse.
    expect((result["scenarios"] as unknown[]).length).toBeGreaterThan(0);
  });

  it.fails("no baseUrl reports fixture_offline and makes zero fetches", async () => {
    // Kills "mark anything that lands on fixtures": offline is a deliberate mode, not a degradation.
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as DegradedResolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const requests: RecordedRequest[] = [];
    const result = (await resolve!({
      blueprintId: "step2cs-seed",
      fetch: recordingFetch(requests, () => ({ queue: [] })),
    })) as unknown as Record<string, unknown>;

    expect(requests).toEqual([]);
    expect(result["scenarioSource"]).toBe("fixture_offline");
    expect(result["fallbackActive"]).toBe(false);
  });

  it.fails("a reachable queue reports api_queue and does not mark a fallback", async () => {
    // Kills "always mark a fallback": the healthy path must say so positively, not by omission.
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as DegradedResolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const requests: RecordedRequest[] = [];
    const result = (await resolve!({
      baseUrl: "http://localhost:8787",
      blueprintId: "step2cs-seed",
      fetch: recordingFetch(requests, () => ({ queue: [{ scenarioId: "ed_chest_pain_priority_v1" }] })),
    })) as unknown as Record<string, unknown>;

    expect(requests.length).toBeGreaterThan(0);
    expect(result["scenarioSource"]).toBe("api_queue");
    expect(result["fallbackActive"]).toBe(false);
  });

  it("a malformed queue body still throws and is never converted into a labelled fallback", async () => {
    // LIVE, NOT PLANTED — this already passes today because #53 made shape drift fail closed, and it
    // must KEEP passing. I planted it as `it.fails` by mistake and the first run caught it: three
    // contracts flip, this one does not. Kills "mark on any exception". #53 made shape drift fail closed on purpose: a malformed body on
    // a 200 is a contract defect, and turning it into a tidy fixture_fallback would relabel a bug as
    // a network condition and lose it.
    const mod = await load();
    const resolve = mod["resolveLearnerExamScenarios"] as DegradedResolver | undefined;
    expect(resolve).toBeTypeOf("function");

    const movedShape = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ stations: [{ id: "not_the_agreed_shape" }] }),
    })) as unknown as typeof fetch;

    await expect(resolve!({
      baseUrl: "http://localhost:8787",
      blueprintId: "step2cs-seed",
      fetch: movedShape,
    })).rejects.toThrow();
  });
});
