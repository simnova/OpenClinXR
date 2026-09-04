import { describe, expect, it } from "vitest";
import type { ApiFetchTransport } from "./api-fetch-transport.js";
import { createInProcessFetch, IN_PROCESS_ORIGIN, type HonoLikeApp } from "./scenario-promotion-io.js";

function recordingApp(calls: Array<{ path: string; init?: RequestInit }>): HonoLikeApp {
  return {
    request: (path, init) => {
      calls.push({ path, ...(init === undefined ? {} : { init }) });
      return new Response(null, { status: 204 });
    },
  };
}

describe("scenario-promotion in-process fetch adapter", () => {
  it("records string, URL, and request-like inputs as Hono paths", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const requestedPaths: string[] = [];
    const fetchLike = createInProcessFetch(recordingApp(calls), requestedPaths) as ApiFetchTransport;

    await fetchLike("/health");
    await fetchLike(new URL(`${IN_PROCESS_ORIGIN}/exam-blueprints/step2cs-seed/readiness`));
    await fetchLike({
      url: `${IN_PROCESS_ORIGIN}/admin/graphql?op=SubmitScenarioReview`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "mutation { ping }" }),
    });

    expect(requestedPaths).toEqual([
      "/health",
      "/exam-blueprints/step2cs-seed/readiness",
      "/admin/graphql?op=SubmitScenarioReview",
    ]);
    expect(calls.map((call) => call.path)).toEqual(requestedPaths);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ query: "mutation { ping }" }));
  });

  it("preserves JSON and binary request bodies on app.request", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const requestedPaths: string[] = [];
    const fetchLike = createInProcessFetch(recordingApp(calls), requestedPaths) as ApiFetchTransport;
    const jsonBody = JSON.stringify({ decision: "APPROVED" });
    const binaryBody = new Uint8Array([1, 2, 3, 255]);

    await fetchLike("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody,
    });
    await fetchLike("/runtime/blob", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: binaryBody,
    });

    expect(requestedPaths).toEqual(["/admin/graphql", "/runtime/blob"]);
    expect(calls[0]?.init?.body).toBe(jsonBody);
    expect(calls[1]?.init?.body).toBe(binaryBody);
    expect(calls[1]?.init?.headers).toEqual({ "content-type": "application/octet-stream" });
  });
});
