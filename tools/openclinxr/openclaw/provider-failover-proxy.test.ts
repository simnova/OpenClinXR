import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  goResponsesJsonToChatCompletion,
  goResponsesStreamToChatChunks,
  translateChatRequestToGoResponses,
} from "./provider-failover-go-responses.ts";
import {
  CircuitBreaker,
  chatToGoResponses,
  cooldownMsFor,
  createServer,
  DEFAULT_PORT,
  forwardChat,
  goResponsesToChat,
  QUOTA_COOLDOWN_MS,
  routeFor,
  shouldFailover,
  TRANSIENT_COOLDOWN_MS,
} from "./provider-failover-proxy.ts";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const readFixture = (name: string): string => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("provider-failover-proxy", () => {
  it("routes muse to OpenRouter then Go", () => {
    const r = routeFor("muse-spark-1");
    expect(r?.primary.name).toBe("openrouter");
    expect(r?.primary.model).toBe("meta/muse-spark-1.3-contributor");
    expect(r?.secondary.name).toBe("go");
    expect(r?.secondary.model).toBe("muse-spark-1.3-contributor");
  });

  it("routes deepseek-v4-flash to Go then OpenRouter", () => {
    const r = routeFor("deepseek-v4-flash");
    expect(r?.primary.name).toBe("go");
    expect(r?.primary.model).toBe("deepseek-v4-flash");
    expect(r?.secondary.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("failovers 402/403/429/5xx and not 400", () => {
    expect(shouldFailover(402)).toBe(true);
    expect(shouldFailover(403)).toBe(true);
    expect(shouldFailover(400)).toBe(false);
  });

  it("maps chat messages into a Go responses input", () => {
    const body = chatToGoResponses(
      { messages: [{ role: "user", content: "PONG please" }] },
      "muse-spark-1.3-contributor",
    );
    expect(body.model).toBe("muse-spark-1.3-contributor");
    expect(body.input).toBe("PONG please");
  });

  it("maps a Go responses payload back to chat.completion", () => {
    const chat = goResponsesToChat(
      { output_text: "PONG" },
      "muse-spark-1.3-contributor",
    );
    expect((chat.choices as Array<{ message: { content: string } }>)[0]?.message.content).toBe("PONG");
  });

  it("fails over to secondary when primary returns 402", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("openrouter")) {
        return new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 });
      }
      return new Response(
        JSON.stringify({
          output_text: "FROM_GO",
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
    expect(out.status).toBe(200);
    expect(out.via).toBe("go");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(out.json)).toContain("FROM_GO");
  });

  it("does not failover a 400", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n += 1;
      return new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
    };
    const out = await forwardChat({
      body: { model: "muse-spark-1", messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.status).toBe(400);
    expect(n).toBe(1);
  });

  it("quota 429 cools down for the Go 5h window; Retry-After wins when present", () => {
    expect(cooldownMsFor(429)).toBe(QUOTA_COOLDOWN_MS);
    expect(cooldownMsFor(402)).toBe(QUOTA_COOLDOWN_MS);
    expect(cooldownMsFor(503)).toBe(TRANSIENT_COOLDOWN_MS);
    expect(cooldownMsFor(429, "60")).toBe(60_000);
  });

  it("skips an open Go circuit until the 5h window, then half-opens and can close on success", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    let now = 1_000_000;
    const breaker = new CircuitBreaker(() => now);
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("opencode.ai")) {
        return new Response(JSON.stringify({ error: { message: "rate" } }), { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OR" } }] }), { status: 200 });
    };
    const route = routeFor("deepseek-v4-flash")!;
    const first = await forwardChat({
      body: { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
      route,
      fetchImpl,
      breaker,
    });
    expect(first.via).toBe("openrouter");
    expect(calls.filter((u) => u.includes("opencode.ai"))).toHaveLength(1);

    calls.length = 0;
    const skipped = await forwardChat({
      body: { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
      route,
      fetchImpl,
      breaker,
    });
    expect(skipped.via).toBe("openrouter");
    expect(calls.some((u) => u.includes("opencode.ai"))).toBe(false);
    expect(breaker.snapshot().go?.state).toBe("open");

    now += QUOTA_COOLDOWN_MS;
    let goStatus = 429;
    const recover: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("opencode.ai")) {
        if (goStatus === 200) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "GO" } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "rate" } }), { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OR" } }] }), { status: 200 });
    };
    goStatus = 200;
    const half = await forwardChat({
      body: { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] },
      route,
      fetchImpl: recover,
      breaker,
    });
    expect(half.via).toBe("go");
    expect(breaker.snapshot().go?.state).toBe("closed");
  });
});

describe("provider-failover HTTP server", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("serves /health", async () => {
    server = createServer(undefined, new CircuitBreaker());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : DEFAULT_PORT;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; circuits: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.circuits).toEqual({});
  });
});

// ## CHANGED (2026-09-24): this describe block used to prove tool requests were REFUSED
// (canFailoverToGoResponses) because the old translation carried only the last user text, so
// grok's agentic turns never failed over. translateChatRequestToGoResponses now carries the full
// request — system prompt, tools, history, tool_calls and tool results — across the wire, so these
// scenarios now assert the opposite: Go IS called and the client gets a valid tool_calls stream.
// The refusal path still exists for a genuinely untranslatable request (e.g. image content).
describe("provider-failover: tool requests fail over to Go", () => {
  it("## CHANGED: tool-calling streamed request with OpenRouter 500 fails over to Go and returns a tool_calls delta", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const calls: string[] = [];
    const goToolCallSse = readFixture("go-responses-tool-call.sse");
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("openrouter")) {
        return new Response(JSON.stringify({ error: { message: "upstream error" } }), { status: 500 });
      }
      return new Response(goToolCallSse, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const out = await forwardChat({
      body: {
        model: "muse-spark-1",
        stream: true,
        tools: [{ type: "function", function: { name: "get_weather", description: "test", parameters: { type: "object", properties: {} } } }],
        messages: [
          { role: "system", content: "You are a test assistant" },
          { role: "user", content: "What is the weather in Boston?" },
        ],
      },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.status).toBe(200);
    expect(out.via).toBe("go");
    expect(calls.filter((u) => u.includes("opencode.ai"))).toHaveLength(1);
    const dataLines = (out.sse as string).split("\n").filter((l) => l.startsWith("data:") && l.slice(5).trim() !== "[DONE]");
    const chunks = dataLines.map((l) => JSON.parse(l.slice(5).trim()));
    for (const chunk of chunks) expect(chunk.object).toBe("chat.completion.chunk");
    const toolChunks = chunks.filter((c) => c.choices[0].delta.tool_calls);
    expect(toolChunks.length).toBeGreaterThan(0);
    expect(toolChunks[0].choices[0].delta.tool_calls[0].function.name).toBe("get_weather");
    const args = toolChunks.map((c) => c.choices[0].delta.tool_calls[0].function.arguments ?? "").join("");
    expect(args).toContain("Boston");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("## CHANGED: a request with an untranslatable content part (image) leaves the Go circuit closed", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const breaker = new CircuitBreaker();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "upstream error" } }), { status: 500 });
    await forwardChat({
      body: {
        model: "muse-spark-1",
        stream: true,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/x.png" } }] }],
      },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker,
    });
    expect(breaker.allow("go")).toBe(true);
    expect(breaker.snapshot()["go"]).toBeUndefined();
  });

  it("## CHANGED: a multi-turn request with an assistant turn now fails over too", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    let goCalled = false;
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("openrouter")) return new Response("{}", { status: 503 });
      goCalled = true;
      return new Response(JSON.stringify({ output_text: "X" }), { status: 200 });
    };
    const out = await forwardChat({
      body: { model: "muse-spark-1", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.status).toBe(200);
    expect(out.via).toBe("go");
    expect(goCalled).toBe(true);
  });

  it("## CHANGED: a Go event-stream text answer now parses into valid content chunks instead of failing", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const goTextSse = readFixture("go-responses-text.sse");
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("openrouter")) return new Response("{}", { status: 500 });
      return new Response(goTextSse, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const out = await forwardChat({
      body: { model: "muse-spark-1", stream: true, messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.status).toBe(200);
    expect(out.via).toBe("go");
    expect(out.sse).toBeDefined();
    const converted = goResponsesStreamToChatChunks(goTextSse, "muse-spark-1.3-contributor");
    expect(converted.hasContent).toBe(true);
    expect(converted.finishReason).toBe("stop");
  });

  it("translates a follow-up turn (assistant tool_call + tool result) into function_call / function_call_output items", () => {
    const result = translateChatRequestToGoResponses(
      {
        messages: [
          { role: "user", content: "What is the weather in Boston?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Boston"}' } }],
          },
          { role: "tool", tool_call_id: "call_1", content: '{"tempF":52,"condition":"cloudy"}' },
        ],
      },
      "muse-spark-1.3-contributor",
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const input = result.payload.input as Array<Record<string, unknown>>;
    expect(input[0]).toMatchObject({ type: "message", role: "user" });
    expect(input[1]).toMatchObject({ type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"Boston"}' });
    expect(input[2]).toMatchObject({ type: "function_call_output", call_id: "call_1", output: '{"tempF":52,"condition":"cloudy"}' });
  });

  it("the recorded fixtures round-trip through the translator", () => {
    const text = goResponsesStreamToChatChunks(readFixture("go-responses-text.sse"), "m");
    expect(text.hasContent).toBe(true);
    expect(text.finishReason).toBe("stop");

    const tool = goResponsesStreamToChatChunks(readFixture("go-responses-tool-call.sse"), "m");
    expect(tool.hasToolCalls).toBe(true);
    expect(tool.finishReason).toBe("tool_calls");
    expect(tool.sse).toContain("get_weather");
    expect(tool.sse).toContain("Boston");

    const followup = goResponsesStreamToChatChunks(readFixture("go-responses-followup.sse"), "m");
    expect(followup.hasContent).toBe(true);
    expect(followup.finishReason).toBe("stop");
    expect(followup.sse).toContain("52");

    const nonStream = goResponsesJsonToChatCompletion({ output_text: "ALIVE" }, "m");
    expect((nonStream.choices as Array<{ message: { content: string } }>)[0]?.message.content).toBe("ALIVE");
  });

  it("plain single-turn streamed request with OpenRouter 500 and Go JSON response produces valid chat.completion.chunk events", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("openrouter")) {
        return new Response(JSON.stringify({ error: { message: "upstream error" } }), { status: 500 });
      }
      return new Response(
        JSON.stringify({ output_text: "GO_ANSWER" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const out = await forwardChat({
      body: {
        model: "muse-spark-1",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });
    expect(out.status).toBe(200);
    expect(out.via).toBe("go");
    expect(out.sse).toBeDefined();
    // Parse the SSE stream and validate each chunk
    const lines = (out.sse as string).trim().split("\n");
    const dataLines = lines.filter((l) => l.startsWith("data:"));
    let sawStop = false;
    for (const line of dataLines) {
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const chunk = JSON.parse(data);
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(typeof chunk.created).toBe("number");
      expect(typeof chunk.model).toBe("string");
      expect(Array.isArray(chunk.choices)).toBe(true);
      const choice = chunk.choices[0];
      if (choice.finish_reason === "stop") {
        sawStop = true;
      }
    }
    expect(sawStop).toBe(true);
  });
});

describe("provider-failover HTTP server: tool requests", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  // ## CHANGED (2026-09-24): used to prove a tool request was refused and never reached Go
  // (500 from OpenRouter, no failover). Now the full request translates, so it fails over end to
  // end through the real HTTP server and the client receives a valid tool_calls SSE stream.
  it("## CHANGED: tool request with OpenRouter 500 fails over to Go through the HTTP server", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    let goCalled = false;
    const goToolCallSse = readFixture("go-responses-tool-call.sse");
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("openrouter")) {
        return new Response(JSON.stringify({ error: { message: "upstream error" } }), { status: 500 });
      }
      goCalled = true;
      return new Response(goToolCallSse, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    server = createServer(fetchImpl, new CircuitBreaker());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : DEFAULT_PORT;
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "muse-spark-1",
        stream: true,
        tools: [{ type: "function", function: { name: "get_weather", description: "test", parameters: { type: "object", properties: {} } } }],
        messages: [
          { role: "system", content: "You are a test assistant" },
          { role: "user", content: "What is the weather in Boston?" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(goCalled).toBe(true);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-openclinxr-via")).toBe("go");
    const text = await res.text();
    expect(text).toContain("get_weather");
    expect(text).toContain('"finish_reason":"tool_calls"');
  });
});
