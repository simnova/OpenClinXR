import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  createServer,
  forwardChat,
  routeFor,
  shouldFailover,
  chatToGoResponses,
  goResponsesToChat,
  DEFAULT_PORT,
} from "./provider-failover-proxy.ts";

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
    });
    expect(out.status).toBe(400);
    expect(n).toBe(1);
  });
});

describe("provider-failover HTTP server", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("serves /health", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : DEFAULT_PORT;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
