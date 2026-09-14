import { describe, expect, it } from "vitest";
import { CircuitBreaker, createServer, forwardChat, routeFor } from "./provider-failover-proxy.ts";

/*
 * MEASURED 2026-09-14. Every worker dispatched on the cheap rung died with
 *   Internal error: "empty response from model (no_visible_content)"
 * and the grok harness retried the identical request 14 times before giving up. The rung was
 * blamed and two cards were escalated to a model billing ~$8 each. The rung was never down.
 *
 * The same prompt, captured raw on the wire:
 *
 *   route                                    response
 *   direct to OpenRouter, "stream": true     4 chat.completion.chunk objects, real content delta
 *   through 127.0.0.1:38450, "stream": true  1 chat.completion body, ZERO data: lines
 *
 * provider-failover-proxy.ts:231 forces `stream: false` onto every forwarded request. The grok CLI
 * asks for streaming inference, receives one whole non-SSE body, finds no content deltas, and
 * reports that the model said nothing.
 *
 * THE LINE IS NOT A TYPO AND DELETING IT IS NOT THE FIX. It exists so isEmptyCompletion (:149) can
 * read choices[0].message.content and decide whether to fail over — the guarantee tsk_97c645be6b9d5d66
 * landed after a dead provider killed dispatches with its circuit reading healthy. Two things break
 * if the line simply goes away:
 *
 *   1. forwardChat:244 does `await res.text()` then JSON.parse. An SSE body is not JSON, so it lands
 *      in the catch at :248 as { error: { message: <first 400 chars> } }, which isEmptyCompletion
 *      calls empty. BOTH upstreams then "fail" and the client gets HTTP 200 carrying an error.
 *   2. createServer:314-318 writes content-type: application/json and res.end(JSON.stringify(...)).
 *      It cannot emit an event stream at all, whatever forwardChat returns.
 *
 * So the fix spans both functions: forward the client's stream flag, tee the event stream to judge
 * emptiness from accumulated content deltas rather than from a whole body, and pass the bytes
 * through with the upstream's own content-type.
 *
 * Clauses (1) and (2) are the RED. They are marked `it.fails` so this suite is green while the
 * defect stands; MEASURED as plain `it(` on 2026-09-14 they fail with:
 *   (1) expected false to be true          — the forwarded payload carries stream:false
 *   (2) expected 'application/json' to contain 'text/event-stream'
 * THE FIX MUST CONVERT BOTH BACK TO `it(`. Leaving them as `it.fails` makes a real fix ERROR, so
 * a green run here is not evidence of repair — the card's `live:` rule is what proves the flip.
 *
 * Clauses (3) and (4) pass today and MUST STILL PASS after the fix. They are what refuses the
 * cheap change. Do not delete this header; append a `## FIXED` block below it.
 *
 * ## FIXED (tsk_1050a76f3dd27799)
 * forwardChat forwards the client's own stream flag, judges a completed event stream from
 * accumulated content deltas (empty stream fails over with the same transient circuit entry),
 * and returns the upstream bytes plus content-type for createServer to emit. Non-streaming
 * callers keep the single JSON body path unchanged.
 */

/** A well-formed SSE completion carrying exactly one content delta. */
const SSE_WITH_CONTENT = [
  `data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}`,
  "",
  `data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ALIVE"}}]}`,
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

/** A well-formed SSE completion that opens a message and never says anything. */
const SSE_WITHOUT_CONTENT = [
  `data: {"id":"c2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}`,
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

function sse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Records the JSON payload the proxy actually put on the wire for each upstream. */
function recordingFetch(reply: (url: string) => Response): {
  fetchImpl: typeof fetch;
  sent: Array<{ url: string; payload: Record<string, unknown> }>;
} {
  const sent: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    sent.push({ url: String(url), payload: JSON.parse(raw) as Record<string, unknown> });
    return reply(String(url));
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

async function withServer(
  fetchImpl: typeof fetch,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(fetchImpl, new CircuitBreaker());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("the proxy streams, and still fails over", () => {
  // Vacuity guard. If a later edit empties these fixtures, clause (2) could pass on a body that
  // never carried a delta and clause (3) could "fail over" from a stream that was never valid.
  it("fixtures are what they claim to be", () => {
    expect(SSE_WITH_CONTENT).toContain(`"content":"ALIVE"`);
    expect(SSE_WITH_CONTENT.split("\n").filter((l) => l.startsWith("data: "))).toHaveLength(3);
    expect(SSE_WITHOUT_CONTENT).not.toContain(`"content"`);
    expect(SSE_WITHOUT_CONTENT.split("\n").filter((l) => l.startsWith("data: "))).toHaveLength(2);
  });

  // (1) RED — the client's streaming request must reach the upstream AS a streaming request.
  it("forwards the client's stream flag instead of forcing stream:false", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const { fetchImpl, sent } = recordingFetch(() => sse(SSE_WITH_CONTENT));

    await forwardChat({
      body: {
        model: "muse-spark-1",
        stream: true,
        messages: [{ role: "user", content: "Reply with exactly: ALIVE" }],
      },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });

    expect(sent.length).toBeGreaterThan(0);
    // provider-failover-proxy.ts:231 rewrites this to false today.
    expect(sent[0]!.payload.stream).toBe(true);
  });

  // (2) RED — and the content deltas must reach the client as an event stream.
  it("returns content deltas to a streaming client", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const { fetchImpl } = recordingFetch(() => sse(SSE_WITH_CONTENT));

    await withServer(fetchImpl, async (base) => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "muse-spark-1",
          stream: true,
          messages: [{ role: "user", content: "Reply with exactly: ALIVE" }],
        }),
      });
      const text = await res.text();

      // createServer:314-318 answers application/json and stringifies a parsed body today.
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(text).toContain("data: ");
      expect(text).toContain(`"content":"ALIVE"`);
    });
  });

  // (3) COUNTERWEIGHT — a stream that says nothing is still an empty completion, and still fails
  // over. This is the clause that deleting :231 cannot satisfy: the failover guarantee from
  // tsk_97c645be6b9d5d66 must survive streaming.
  it("fails over when the primary streams no content at all", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const { fetchImpl, sent } = recordingFetch((url) =>
      url.includes("openrouter")
        ? sse(SSE_WITHOUT_CONTENT)
        : new Response(JSON.stringify({ output_text: "ALIVE" }), { status: 200 }),
    );

    const out = await forwardChat({
      body: { model: "muse-spark-1", stream: true, messages: [{ role: "user", content: "hi" }] },
      route: routeFor("muse-spark-1")!,
      fetchImpl,
      breaker: new CircuitBreaker(),
    });

    expect(sent).toHaveLength(2);
    expect(out.via).toBe("go");
    expect(JSON.stringify(out.json)).toContain("ALIVE");
  });

  // (4) COUNTERWEIGHT — a client that did NOT ask for a stream still gets one whole JSON body, and
  // still fails over on an empty one. Refuses a fix that forces event-stream on every caller.
  it("leaves a non-streaming request answering JSON, and still fails over", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.OPENCODE_API_KEY = "go-test";
    const { fetchImpl, sent } = recordingFetch((url) =>
      url.includes("openrouter")
        ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
        : new Response(JSON.stringify({ output_text: "ALIVE" }), { status: 200 }),
    );

    await withServer(fetchImpl, async (base) => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "muse-spark-1", messages: [{ role: "user", content: "hi" }] }),
      });
      const text = await res.text();

      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("x-openclinxr-via")).toBe("go");
      expect(text).toContain("ALIVE");
      expect(text).not.toContain("data: ");
    });

    // Not "must be absent" — forwarding an explicit stream:false is legitimate. The requirement is
    // that a client which never asked for a stream is never upgraded to one.
    expect(sent.every((s) => s.payload.stream !== true)).toBe(true);
  });
});
