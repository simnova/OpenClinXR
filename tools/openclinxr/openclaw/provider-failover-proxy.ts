#!/usr/bin/env node
/**
 * Local OpenAI-compatible proxy: Muse → OpenRouter then OpenCode Go;
 * DeepSeek → Go then OpenRouter. Failover on 401/402/403/408/429/5xx
 * and network errors. Secrets from env only.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export const DEFAULT_PORT = 38450;
export const FAILOVER_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504]);
/** OpenCode Go short window is $12 / 5 h; quota 402/429 stay open that long then half-open. */
export const QUOTA_COOLDOWN_MS = 5 * 60 * 60 * 1000;
export const REGION_COOLDOWN_MS = 60 * 60 * 1000;
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

export function cooldownMsFor(status: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader && /^\d+(\.\d+)?$/.test(retryAfterHeader.trim())) {
    return Math.max(1000, Number(retryAfterHeader) * 1000);
  }
  if (status === 402 || status === 429) return QUOTA_COOLDOWN_MS;
  if (status === 403) return REGION_COOLDOWN_MS;
  return TRANSIENT_COOLDOWN_MS;
}

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private readonly state = new Map<string, { kind: CircuitState; openUntil: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  allow(name: string): boolean {
    const row = this.state.get(name);
    if (!row || row.kind === "closed") return true;
    if (this.now() < row.openUntil) return false;
    row.kind = "half_open";
    return true;
  }

  recordSuccess(name: string): void {
    this.state.set(name, { kind: "closed", openUntil: 0 });
  }

  recordFailure(name: string, status: number, retryAfterHeader?: string | null): void {
    if (status === 401) return;
    const ms = cooldownMsFor(status, retryAfterHeader);
    this.state.set(name, { kind: "open", openUntil: this.now() + ms });
  }

  snapshot(): Record<string, { state: CircuitState; openUntil: number; openForMs: number }> {
    const t = this.now();
    const out: Record<string, { state: CircuitState; openUntil: number; openForMs: number }> = {};
    for (const [name, row] of this.state) {
      out[name] = { state: row.kind, openUntil: row.openUntil, openForMs: Math.max(0, row.openUntil - t) };
    }
    return out;
  }
}

const defaultBreaker = new CircuitBreaker();

export type Upstream = { name: "openrouter" | "go"; base: string; keyEnv: string; model: string };

export function routeFor(model: string): { primary: Upstream; secondary: Upstream } | null {
  const id = model.trim().toLowerCase();
  const muse =
    id === "muse-spark-1" ||
    id === "muse-spark-1.3-contributor" ||
    id === "meta/muse-spark-1.3-contributor" ||
    id === "muse-spark-1-go";
  if (muse) {
    return {
      primary: {
        name: "openrouter",
        base: "https://openrouter.ai/api/v1",
        keyEnv: "OPENROUTER_API_KEY",
        model: "meta/muse-spark-1.3-contributor",
      },
      secondary: {
        name: "go",
        base: "https://opencode.ai/zen/go/v1",
        keyEnv: "OPENCODE_API_KEY",
        model: "muse-spark-1.3-contributor",
      },
    };
  }
  const flash = id === "deepseek-v4-flash" || id === "deepseek-v4.1-flash" || id === "deepseek-flash";
  if (flash) {
    return {
      primary: {
        name: "go",
        base: "https://opencode.ai/zen/go/v1",
        keyEnv: "OPENCODE_API_KEY",
        model: id === "deepseek-v4.1-flash" ? "deepseek-v4.1-flash" : "deepseek-v4-flash",
      },
      secondary: {
        name: "openrouter",
        base: "https://openrouter.ai/api/v1",
        keyEnv: "OPENROUTER_API_KEY",
        model: "deepseek/deepseek-v4-flash",
      },
    };
  }
  if (id === "deepseek-v4-flash-vision-exp") {
    return {
      primary: {
        name: "go",
        base: "https://opencode.ai/zen/go/v1",
        keyEnv: "OPENCODE_API_KEY",
        model: "deepseek-v4-flash-vision-exp",
      },
      secondary: {
        name: "openrouter",
        base: "https://openrouter.ai/api/v1",
        keyEnv: "OPENROUTER_API_KEY",
        model: "deepseek/deepseek-v4-flash-vision-exp",
      },
    };
  }
  if (id === "deepseek-v4-pro" || id === "deepseek-pro-chat" || id === "deepseek") {
    return {
      primary: {
        name: "go",
        base: "https://opencode.ai/zen/go/v1",
        keyEnv: "OPENCODE_API_KEY",
        model: "deepseek-v4-pro",
      },
      secondary: {
        name: "openrouter",
        base: "https://openrouter.ai/api/v1",
        keyEnv: "OPENROUTER_API_KEY",
        model: "deepseek/deepseek-v4-flash",
      },
    };
  }
  return null;
}

export function shouldFailover(status: number): boolean {
  return FAILOVER_STATUSES.has(status);
}

/**
 * An HTTP 200 with no usable content is a provider failure, not a success.
 * Detected after response parsing (not inside res.ok) so it applies to
 * both OpenRouter and Go-converted payloads.
 */
export function isEmptyCompletion(body: unknown): boolean {
  if (body === null || body === undefined || typeof body !== "object") return true;
  const b = body as Record<string, unknown>;
  if (b.error) return true;
  if (!Array.isArray(b.choices) || b.choices.length === 0) return true;
  const first = b.choices[0] as { message?: { content?: string } } | undefined;
  const content = first?.message?.content;
  return content === undefined || content === null || content === "";
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? ""))
        .join("\n");
    }
  }
  return "";
}

export function chatToGoResponses(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const text = lastUserText(body.messages);
  return { model, input: text || JSON.stringify(body.messages ?? "") };
}

export function goResponsesToChat(raw: unknown, model: string): Record<string, unknown> {
  const d = raw as {
    output?: Array<{ content?: Array<{ text?: string }>; text?: string }>;
    output_text?: string;
  };
  let content = "";
  if (typeof d?.output_text === "string") content = d.output_text;
  else if (Array.isArray(d?.output)) {
    content = d.output
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("");
  }
  return {
    id: "failover-go-muse",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function forwardChat(opts: {
  body: Record<string, unknown>;
  route: { primary: Upstream; secondary: Upstream };
  fetchImpl?: FetchLike;
  breaker?: CircuitBreaker;
}): Promise<{ status: number; json: unknown; via: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const breaker = opts.breaker ?? defaultBreaker;
  const order = [opts.route.primary, opts.route.secondary];
  let last: { status: number; json: unknown; via: string } | undefined;
  for (const up of order) {
    if (!breaker.allow(up.name)) {
      last = {
        status: 503,
        json: { error: { message: `${up.name} circuit open` } },
        via: `${up.name}-open`,
      };
      continue;
    }
    const key = process.env[up.keyEnv] ?? "";
    if (!key) {
      last = { status: 401, json: { error: { message: `missing ${up.keyEnv}` } }, via: up.name };
      continue;
    }
    const useGoResponses = up.name === "go" && up.model === "muse-spark-1.3-contributor";
    const path = useGoResponses ? "/responses" : "/chat/completions";
    const payload = useGoResponses
      ? chatToGoResponses(opts.body, up.model)
      : { ...opts.body, model: up.model, stream: false };
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "openclinxr-grok/1.0",
    };
    if (up.name === "go") headers["x-opencode-session"] = "openclinxr-grok";
    try {
      const res = await fetchImpl(`${up.base}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { error: { message: text.slice(0, 400) } };
      }
      if (res.ok) {
        if (useGoResponses) json = goResponsesToChat(json, up.model);
        if (isEmptyCompletion(json)) {
          // HTTP 200 with empty body — treat as transient failure, failover.
          // Status 500 routes to TRANSIENT_COOLDOWN_MS (30 s) in cooldownMsFor:
          // not a quota signal (402/429), not a region block (403), not a missing key (401).
          breaker.recordFailure(up.name, 500);
          last = { status: 200, json, via: up.name };
          if (up === order[order.length - 1]) return last;
          continue;
        }
        breaker.recordSuccess(up.name);
        return { status: 200, json, via: up.name };
      }
      breaker.recordFailure(up.name, res.status, res.headers.get("retry-after"));
      last = { status: res.status, json, via: up.name };
      if (!shouldFailover(res.status) || up === order[order.length - 1]) return last;
    } catch (err) {
      breaker.recordFailure(up.name, 503);
      last = {
        status: 503,
        json: { error: { message: err instanceof Error ? err.message : "upstream down" } },
        via: up.name,
      };
      if (up === order[order.length - 1]) return last;
    }
  }
  return last ?? { status: 502, json: { error: { message: "no upstream" } }, via: "none" };
}

export function createServer(fetchImpl?: FetchLike, breaker: CircuitBreaker = defaultBreaker): http.Server {
  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/health" || url === "/v1/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, circuits: breaker.snapshot() }));
      return;
    }
    if (req.method !== "POST" || !url.includes("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid json" } }));
          return;
        }
        const model = String(body.model ?? "");
        const route = routeFor(model);
        if (!route) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: `no failover route for ${model}` } }));
          return;
        }
        const out = await forwardChat({ body, route, fetchImpl, breaker });
        res.writeHead(out.status, {
          "content-type": "application/json",
          "x-openclinxr-via": out.via,
        });
        res.end(JSON.stringify(out.json));
      })();
    });
  });
}

const runningDirect =
  typeof process.argv[1] === "string" && /provider-failover-proxy\.ts$/.test(process.argv[1]);
if (runningDirect) {
  const port = Number(process.env.OPENCLINXR_FAILOVER_PORT ?? DEFAULT_PORT);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    process.stderr.write(`provider-failover listening 127.0.0.1:${port}\n`);
  });
}
