import { describe, expect, it } from "vitest";
import {
  forwardChat,
  routeFor,
  CircuitBreaker,
  isEmptyCompletion,
  TRANSIENT_COOLDOWN_MS,
} from "./provider-failover-proxy.ts";

// --- isEmptyCompletion unit tests ---

describe("isEmptyCompletion", () => {
  it("returns true for empty object (no choices)", () => {
    expect(isEmptyCompletion({})).toBe(true);
  });

  it("returns true for null", () => {
    expect(isEmptyCompletion(null)).toBe(true);
  });

  it("returns true for choices array with empty string content", () => {
    expect(
      isEmptyCompletion({
        choices: [{ message: { role: "assistant", content: "" } }],
      }),
    ).toBe(true);
  });

  it("returns true for choices array with null content", () => {
    expect(
      isEmptyCompletion({
        choices: [{ message: { role: "assistant", content: null } }],
      }),
    ).toBe(true);
  });

  it("returns true when choices array is empty", () => {
    expect(isEmptyCompletion({ choices: [] })).toBe(true);
  });

  it("returns true when body has an error field", () => {
    expect(isEmptyCompletion({ error: { message: "rate limited" } })).toBe(true);
  });

  it("returns false for a legitimate completion with content", () => {
    expect(
      isEmptyCompletion({
        choices: [{ message: { role: "assistant", content: "Hello" } }],
      }),
    ).toBe(false);
  });

  it("returns false for completion with whitespace-only content", () => {
    expect(
      isEmptyCompletion({
        choices: [{ message: { role: "assistant", content: "  " } }],
      }),
    ).toBe(false);
  });
});

// --- Failover integration tests ---

describe("empty completion failover", () => {
  it("failovers to secondary when primary returns HTTP 200 with empty choices", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("openrouter")) {
        // Simulate the 2026-09-12 measured outage: 200 OK, empty completion
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      // Go responses format — the proxy converts this to chat.completion
      return new Response(
        JSON.stringify({ output_text: "ALIVE" }),
        { status: 200 },
      );
    };
    const out = await forwardChat({
      body: { model: "muse-spark-1", messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    // Before fix: out.via === "openrouter" (empty body returned as success)
    // After fix: out.via === "go" (failover to secondary)
    expect(out.via).toBe("go");
    expect(out.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(out.json)).toContain("ALIVE");
  });

  it("failovers to secondary when primary returns 200 with null content", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("openrouter")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: null } }] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "FROM_GO" } }],
        }),
        { status: 200 },
      );
    };
    const out = await forwardChat({
      body: { model: "muse-spark-1", messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.via).toBe("go");
    expect(calls).toHaveLength(2);
  });

  it("does NOT failover a legitimate non-empty response", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    let n = 0;
    const fetchImpl: typeof fetch = async (url) => {
      n += 1;
      if (String(url).includes("openrouter")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Real content" } }],
          }),
          { status: 200 },
        );
      }
      throw new Error("should not reach secondary");
    };
    const out = await forwardChat({
      body: { model: "muse-spark-1", messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.via).toBe("openrouter");
    expect(n).toBe(1);
    expect(JSON.stringify(out.json)).toContain("Real content");
  });

  it("opens circuit on empty completion with TRANSIENT_COOLDOWN_MS (30 s)", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const now = Date.now();
    const breaker = new CircuitBreaker(() => now);
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("openrouter")) {
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        { status: 200 },
      );
    };
    await forwardChat({
      body: { model: "muse-spark-1", messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker,
    });
    const snap = breaker.snapshot();
    expect(snap.openrouter?.state).toBe("open");
    expect(snap.openrouter?.openForMs).toBe(TRANSIENT_COOLDOWN_MS);
  });
});
