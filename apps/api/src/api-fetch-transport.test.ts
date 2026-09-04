import { describe, expect, it } from "vitest";
import {
  createApiFetchTransport,
  resolveApiFetchCall,
  type ResolvedApiFetchCall,
} from "./api-fetch-transport.js";

describe("api fetch transport", () => {
  it("resolves string, URL, and request-like inputs", () => {
    expect(resolveApiFetchCall("/health")).toEqual({ url: "/health", method: "GET" });
    expect(resolveApiFetchCall(new URL("http://in-process.openclinxr.local/readiness"))).toEqual({
      url: "http://in-process.openclinxr.local/readiness",
      method: "GET",
    });
    expect(
      resolveApiFetchCall({
        url: "http://in-process.openclinxr.local/admin/graphql",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ ping }" }),
      }),
    ).toEqual({
      url: "http://in-process.openclinxr.local/admin/graphql",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ ping }" }),
    });
  });

  it("lets init override request-like method, headers, and body", () => {
    const call = resolveApiFetchCall(
      {
        url: "/admin/graphql",
        method: "PUT",
        headers: { accept: "text/plain" },
        body: "from-request",
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      },
    );
    expect(call).toEqual({
      url: "/admin/graphql",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
  });

  it("does not take a request-like body on GET or HEAD unless init supplies one", () => {
    expect(resolveApiFetchCall({ url: "/health", method: "GET", body: "ignored" })).toEqual({
      url: "/health",
      method: "GET",
    });
    expect(resolveApiFetchCall({ url: "/health", method: "HEAD", body: "ignored" })).toEqual({
      url: "/health",
      method: "HEAD",
    });
    expect(resolveApiFetchCall({ url: "/health", method: "GET", body: "ignored" }, { body: "from-init" })).toEqual({
      url: "/health",
      method: "GET",
      body: "from-init",
    });
  });

  it("dispatches JSON string and binary bodies through the transport", async () => {
    const seen: ResolvedApiFetchCall[] = [];
    const fetchLike = createApiFetchTransport(async (call) => {
      seen.push(call);
      return new Response(null, { status: 204 });
    });
    const jsonBody = JSON.stringify({ decision: "APPROVED" });
    const binaryBody = new Uint8Array([0x00, 0xff, 0x10]);

    await fetchLike("/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody,
    });
    await fetchLike(new URL("http://in-process.openclinxr.local/runtime/upload"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: binaryBody,
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      url: "/admin/graphql",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody,
    });
    expect(seen[1]?.url).toBe("http://in-process.openclinxr.local/runtime/upload");
    expect(seen[1]?.method).toBe("POST");
    expect(seen[1]?.body).toBe(binaryBody);
    expect(seen[1]?.body).toBeInstanceOf(Uint8Array);
  });
});
