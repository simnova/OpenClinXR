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
