/**
 * A tool call is an answer, not an empty completion — on both the streamed and unstreamed path.
 *
 * DIAGNOSIS (measured 2026-09-17, same tool-calling request to meta/muse-spark-1.3-contributor):
 *   direct OpenRouter, unstreamed  -> tool_calls=[run_shell]
 *   direct OpenRouter, streamed    -> tool_calls=[run_shell]
 *   via this proxy,    unstreamed  -> tool_calls=[run_shell]
 *   via this proxy,    streamed    -> content '' tool_calls=[] finish=None   <- dropped
 * The streamed tool call carried no text delta, so accumulateStreamContent returned "" and the
 * stream was recorded as an empty-completion failure. Grok streams, so every agentic muse turn
 * vanished and grok retried the identical request 15 times.
 *
 * COUNTERWEIGHT: a stream carrying neither text nor a tool call must still fail over — the
 * behaviour the-proxy-fails-over-on-an-empty-completion.test.ts protects is kept.
 */
import { describe, expect, it } from "vitest";
import { accumulateStreamContent, CircuitBreaker, forwardChat, isEmptyCompletion, routeFor, streamHasToolCalls } from "./provider-failover-proxy.ts";

const sse = (...events: unknown[]): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";

const toolCallStream = sse(
  { choices: [{ index: 0, delta: { role: "assistant", content: null } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_shell", arguments: "" } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"command\":\"pwd\"}" } }] } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
);

const emptyStream = sse(
  { choices: [{ index: 0, delta: { role: "assistant", content: null } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
);

describe("the proxy passes a tool call through", () => {
  it("a streamed tool call carries no text, which is why the old text-only check dropped it", () => {
    expect(accumulateStreamContent(toolCallStream)).toBe("");
  });

  it("a streamed tool call is recognised as a real answer", () => {
    expect(streamHasToolCalls(toolCallStream)).toBe(true);
  });

  it("an unstreamed tool call with null content is not an empty completion", () => {
    const body = {
      choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "run_shell", arguments: "{}" } }],
      } }],
    };
    expect(isEmptyCompletion(body)).toBe(false);
  });

  it("COUNTERWEIGHT: a stream with neither text nor a tool call is still empty", () => {
    expect(accumulateStreamContent(emptyStream)).toBe("");
    expect(streamHasToolCalls(emptyStream)).toBe(false);
  });

  it("COUNTERWEIGHT: an unstreamed reply with null content and no tool calls is still empty", () => {
    const body = { choices: [{ index: 0, message: { role: "assistant", content: null } }] };
    expect(isEmptyCompletion(body)).toBe(true);
    const emptyToolList = { choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [] } }] };
    expect(isEmptyCompletion(emptyToolList)).toBe(true);
  });

  it("END TO END: forwardChat returns a streamed tool call to the client instead of failing over", async () => {
    // Drives the shipped forwardChat, so the test fails if the SSE branch stops consulting
    // streamHasToolCalls — a helper test alone would keep passing against an unwired branch.
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-key";
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(toolCallStream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const out = await forwardChat({
      body: { model: "muse-spark-1", stream: true, messages: [{ role: "user", content: "pwd?" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.status).toBe(200);
    expect(out.sse).toBe(toolCallStream);
    expect(streamHasToolCalls(out.sse ?? "")).toBe(true);
    // served by the primary; no failover to the second provider
    expect(calls).toHaveLength(1);
  });
});
