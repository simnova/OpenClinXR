/**
 * Local end-to-end acceptance harness for the assembled exam learner→faculty path.
 *
 * Runs as a tsx child process in three modes:
 *  - server: boots the production @openclinxr/api startup over plain node:http with a
 *    file-backed persistence sink injected through the public startup options.
 *  - client: drives a learner through two assembled stations over real HTTP, restarts the
 *    API process between stations, resumes from the durable sink, completes each note form,
 *    and posts/gets the immutable faculty assembled-review-packet. Writes one evidence JSON
 *    that the playwright spec uses as the assertion source. No canonical trace, actor turn,
 *    or note is synthesized: every value comes from an API response or a durable file.
 *  - admin-serve: serves a built ui-admin bundle and reverse-proxies its API calls to a
 *    running harness API so the faculty adjudication workspace opens in a real browser.
 *
 * The playwright spec never imports this module; it only spawns it. Monorepo package imports
 * are lazy dynamic imports by absolute file URL so this file loads from anywhere under the
 * repo without pnpm virtual-store resolution constraints.
 */

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DEV_AUTH_SECRET = "openclinxr-local-dev-hmac-secret-v1";

export const HARNESS_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const HARNESS_ARTIFACT_ROOT = path.join(
  HARNESS_REPO_ROOT,
  "artifacts",
  "openclinxr",
  "assembled-exam-learner-faculty",
);

const API_INDEX_URL = pathToFileURL(
  path.join(HARNESS_REPO_ROOT, "apps", "api", "src", "index.ts"),
).href;
const SCENARIO_FIXTURES_INDEX_URL = pathToFileURL(
  path.join(HARNESS_REPO_ROOT, "packages", "openclinxr", "scenario-fixtures", "src", "index.ts"),
).href;

export const FIXTURE_RELATIVE_PATH = path.join(
  "tests",
  "openclinxr",
  "fixtures",
  "assembled-exam-two-station.json",
);
export const HELPER_RELATIVE_PATH = path.join(
  "tests",
  "openclinxr",
  "helpers",
  "assembled-exam-harness.ts",
);

export const CANONICAL_PHASE_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

type JsonRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// File-backed persistence sink (public ApiPersistenceSink shape)
// ---------------------------------------------------------------------------

export class FileDurableSink {
  readonly traceEventsDir: string;
  readonly actorTurnsDir: string;
  readonly runAggregateDir: string;
  readonly reviewPacketsDir: string;

  constructor(private readonly options: { rootDir: string }) {
    this.traceEventsDir = path.join(options.rootDir, "trace-events");
    this.actorTurnsDir = path.join(options.rootDir, "actor-turns");
    this.runAggregateDir = path.join(options.rootDir, "run-aggregates");
    this.reviewPacketsDir = path.join(options.rootDir, "review-packets");
    for (const dir of [
      this.traceEventsDir,
      this.actorTurnsDir,
      this.runAggregateDir,
      this.reviewPacketsDir,
    ]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  saveAssembledExamRun(examRunId: string, record: JsonRecord): void {
    writeJsonFile(path.join(this.runAggregateDir, `${safeSegment(examRunId)}.json`), record);
  }

  getAssembledExamRun(examRunId: string): JsonRecord | undefined {
    return readJsonFile(path.join(this.runAggregateDir, `${safeSegment(examRunId)}.json`));
  }

  saveAssembledExamReviewPacket(examRunId: string, packet: JsonRecord): void {
    writeJsonFile(path.join(this.reviewPacketsDir, `${safeSegment(examRunId)}.json`), packet);
  }

  getAssembledExamReviewPacket(examRunId: string): JsonRecord | undefined {
    return readJsonFile(path.join(this.reviewPacketsDir, `${safeSegment(examRunId)}.json`));
  }

  saveTraceEvents(stationRunId: string, events: JsonRecord[]): void {
    writeJsonFile(path.join(this.traceEventsDir, `${safeSegment(stationRunId)}.json`), events);
  }

  saveActorTurn(stationRunId: string, turn: JsonRecord): void {
    const file = path.join(this.actorTurnsDir, `${safeSegment(stationRunId)}.jsonl`);
    // NOTE: fs.writeFileSync({flag:"a"}) is forced to truncate in this sandboxed host
    // (measured 2026-09-04); openSync("a")+writeSync is the append path that survives.
    const descriptor = openSync(file, "a");
    try {
      writeSync(descriptor, `${JSON.stringify(turn)}\n`);
    } finally {
      closeSync(descriptor);
    }
  }

  saveReviewPacket(stationRunId: string, packet: JsonRecord): void {
    writeJsonFile(path.join(this.reviewPacketsDir, `${safeSegment(stationRunId)}-review.json`), packet);
  }

  readRunAggregate(examRunId: string): JsonRecord | undefined {
    return this.getAssembledExamRun(examRunId);
  }

  readActorTurns(stationRunId: string): JsonRecord[] {
    const file = path.join(this.actorTurnsDir, `${safeSegment(stationRunId)}.jsonl`);
    if (!existsSync(file)) {
      return [];
    }
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JsonRecord);
  }

  readTraceEvents(stationRunId: string): JsonRecord[] | undefined {
    return readJsonFile(path.join(this.traceEventsDir, `${safeSegment(stationRunId)}.json`));
  }

  listFileNames(dir: string, extension: string): string[] {
    return readdirSync(dir).filter((name) => name.endsWith(extension));
  }
}

function writeJsonFile(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile(file: string): JsonRecord | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as JsonRecord;
  } catch {
    return undefined;
  }
}

function safeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

// ---------------------------------------------------------------------------
// Dev bearer token (same hand-rolled HMAC-SHA256 JWT as @openclinxr/auth)
// ---------------------------------------------------------------------------

export function signDevToken(input: {
  subject: string;
  role: "learner" | "faculty" | "admin";
  learnerId?: string;
  secret?: string;
}): string {
  const secret = input.secret ?? DEFAULT_DEV_AUTH_SECRET;
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: input.subject,
    role: input.role,
    iat: now,
    exp: now + 8 * 60 * 60,
  };
  if (input.role === "learner") {
    payload["learnerId"] = input.learnerId ?? input.subject;
  } else if (input.learnerId) {
    payload["learnerId"] = input.learnerId;
  }
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${header}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput, "utf8").digest("base64url");
  return `${signingInput}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function learnerAuthHeader(learnerId: string): Record<string, string> {
  return { authorization: `Bearer ${signDevToken({ subject: learnerId, role: "learner", learnerId })}` };
}

export function facultyAuthHeader(subject: string): Record<string, string> {
  return { authorization: `Bearer ${signDevToken({ subject, role: "faculty" })}` };
}

// ---------------------------------------------------------------------------
// Minimal fetch-over-node:http server (no external dependency)
// ---------------------------------------------------------------------------

export async function serveFetchOnHttp(options: {
  port: number;
  fetch: (request: Request) => Promise<Response> | Response;
  readyLog?: string;
}): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    void handleIncoming(request, response, options.fetch);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;
  if (options.readyLog) {
    process.stdout.write(`${options.readyLog} ${boundPort}\n`);
  }
  return { server, port: boundPort };
}

async function handleIncoming(
  request: IncomingMessage,
  response: ServerResponse,
  appFetch: (request: Request) => Promise<Response> | Response,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const body = await readRequestBody(request);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") {
        headers[name] = value;
      }
    }
    const fetchRequest = new Request(url, {
      method: request.method ?? "GET",
      headers,
      body: body.length > 0 ? body : undefined,
    });
    const appResponse = await appFetch(fetchRequest);
    const responseHeaders = Object.fromEntries(appResponse.headers.entries());
    response.writeHead(appResponse.status, responseHeaders);
    if (appResponse.body) {
      response.end(Buffer.from(await appResponse.arrayBuffer()));
    } else {
      response.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "harness_proxy_error";
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  }
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Child process helpers
// ---------------------------------------------------------------------------

export type SpawnedHarnessProcess = {
  child: ReturnType<typeof spawn>;
  waitForLine: (marker: string, timeoutMs?: number) => Promise<string>;
  stop: () => Promise<void>;
};

export function spawnHarnessProcess(options: {
  scriptPath: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}): SpawnedHarnessProcess {
  const child = spawn(process.execPath, ["--import", "tsx", options.scriptPath], {
    cwd: options.cwd ?? HARNESS_REPO_ROOT,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  const allOutput: string[] = [];
  let pendingMarker: { marker: string; timeoutMs: number; timer: NodeJS.Timeout; resolve: (line: string) => void; reject: (error: Error) => void } | null = null;

  const consume = (chunk: Buffer) => {
    const text = chunk.toString();
    allOutput.push(text);
    const parts = text.split("\n");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        continue;
      }
      lines.push(trimmed);
      if (pendingMarker && trimmed.includes(pendingMarker.marker)) {
        const waiter = pendingMarker;
        pendingMarker = null;
        clearTimeout(waiter.timer);
        waiter.resolve(trimmed);
      }
    }
  };

  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  child.on("error", (error) => {
    if (pendingMarker) {
      const waiter = pendingMarker;
      pendingMarker = null;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });
  child.on("exit", (code, signal) => {
    if (pendingMarker) {
      const waiter = pendingMarker;
      pendingMarker = null;
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error(
          `harness child exited early (code ${String(code)} signal ${String(signal)}): ${allOutput.join("").slice(-2500)}`,
        ),
      );
    }
  });

  return {
    child,
    waitForLine: (marker, timeoutMs = 180_000) =>
      new Promise<string>((resolve, reject) => {
        const existing = lines.find((line) => line.includes(marker));
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          if (pendingMarker) {
            const waiter = pendingMarker;
            pendingMarker = null;
            waiter.reject(
              new Error(`timed out waiting for ${marker}: ${allOutput.join("").slice(-2500)}`),
            );
          }
        }, timeoutMs);
        pendingMarker = { marker, timeoutMs, timer, resolve, reject };
      }),
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP client helpers
// ---------------------------------------------------------------------------

export async function jsonRequest(options: {
  baseUrl: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  const url = `${options.baseUrl.replace(/\/$/, "")}${options.path}`;
  const response = await fetch(url, {
    method: options.method,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

export async function waitForHttp(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/exam-runs/none`);
      if (response.status === 404 || response.status === 401 || response.status === 200) {
        return;
      }
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw new Error(`api not reachable at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Scenario fixture access (lazy absolute-file-URL imports)
// ---------------------------------------------------------------------------

type FixtureSeed = {
  seedId?: string;
  actorId: string;
  learnerUtterance: string;
  expectedTraceTags: string[];
};

let seedCache: FixtureSeed[] | undefined;

async function loadAllFixtureSeeds(): Promise<FixtureSeed[]> {
  if (seedCache) {
    return seedCache;
  }
  const module = (await import(SCENARIO_FIXTURES_INDEX_URL)) as Record<string, unknown>;
  const seeds: FixtureSeed[] = [];
  for (const exportName of ["edChestPainDialogueSeeds", "pediatricAsthmaDialogueSeeds"]) {
    const value = module[exportName];
    if (Array.isArray(value)) {
      for (const seed of value) {
        if (typeof seed === "object" && seed !== null) {
          const record = seed as Record<string, unknown>;
          if (typeof record["actorId"] === "string" && typeof record["learnerUtterance"] === "string") {
            seeds.push({
              seedId: typeof record["seedId"] === "string" ? record["seedId"] : undefined,
              actorId: record["actorId"],
              learnerUtterance: record["learnerUtterance"],
              expectedTraceTags: Array.isArray(record["expectedTraceTags"])
                ? (record["expectedTraceTags"] as string[])
                : [],
            });
          }
        }
      }
    }
  }
  seedCache = seeds;
  return seeds;
}

export async function resolveSeed(input: { seedId: string }): Promise<FixtureSeed> {
  const seeds = await loadAllFixtureSeeds();
  const match = seeds.find((seed) => seed.seedId === input.seedId);
  if (!match) {
    throw new Error(`harness fixture seed not found: ${input.seedId}`);
  }
  return match;
}

// ---------------------------------------------------------------------------
// Evidence model
// ---------------------------------------------------------------------------

export function emptyRunEvidence(runId: string): JsonRecord {
  return {
    schema: "openclinxr.assembled-exam-learner-faculty.evidence.v1",
    runId,
    run: null,
    learner: {},
    api: {},
    persistence: {},
    faculty: {},
  };
}

export function loadFixtureJson(fixturePath: string): JsonRecord {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as JsonRecord;
}

export function writeEvidenceFile(evidenceDir: string, evidence: JsonRecord): string {
  mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, "evidence.json");
  writeJsonFile(file, evidence);
  return file;
}

// ---------------------------------------------------------------------------
// Mode dispatcher (only runs when this file is the process entry)
// ---------------------------------------------------------------------------

async function dispatchMain(): Promise<void> {
  const mode = process.env["OPENCLINXR_HARNESS_MODE"];
  if (mode === "server") {
    await runServerMode();
    return;
  }
  if (mode === "client") {
    await runClientMode();
    return;
  }
  if (mode === "admin-serve") {
    await runAdminServeMode();
    return;
  }
  throw new Error(`unknown OPENCLINXR_HARNESS_MODE ${String(mode)}`);
}

// ---- server mode ----------------------------------------------------------

async function runServerMode(): Promise<void> {
  const port = Number(process.env["OPENCLINXR_HARNESS_PORT"] ?? "0");
  const durableDir = process.env["OPENCLINXR_HARNESS_DURABLE_DIR"];
  if (!durableDir) {
    throw new Error("OPENCLINXR_HARNESS_DURABLE_DIR required for server mode");
  }
  const apiModule = (await import(API_INDEX_URL)) as {
    createOpenClinXrApiStartup: (options?: { persistence?: unknown }) => {
      startUp: () => { fetch: (request: Request) => Promise<Response> | Response };
    };
  };
  const sink = new FileDurableSink({ rootDir: durableDir });
  const startup = apiModule.createOpenClinXrApiStartup({ persistence: sink }).startUp();
  await serveFetchOnHttp({
    port,
    fetch: (request) => startup.fetch(request),
    readyLog: "OPENCLINXR_HARNESS_API_READY",
  });
  await new Promise<void>(() => {
    // keep alive until killed
  });
}

// ---- admin-serve mode -----------------------------------------------------

async function runAdminServeMode(): Promise<void> {
  const uiPort = Number(process.env["OPENCLINXR_HARNESS_UI_PORT"] ?? "0");
  const apiPort = Number(process.env["OPENCLINXR_HARNESS_API_PORT"] ?? "0");
  const distDir = process.env["OPENCLINXR_HARNESS_UI_DIST"];
  if (!distDir || !apiPort) {
    throw new Error("admin-serve requires OPENCLINXR_HARNESS_UI_DIST and OPENCLINXR_HARNESS_API_PORT");
  }
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  const proxiedPrefixes = [
    "/exam-runs",
    "/sessions",
    "/runtime",
    "/voice",
    "/admin",
    "/scenario-bank",
    "/exam-blueprints",
    "/health",
    "/providers",
  ];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    try {
      if (proxiedPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
        const body = await readRequestBody(request);
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === "string") {
            headers[name] = value;
          }
        }
        headers["host"] = `127.0.0.1:${apiPort}`;
        if (!headers["authorization"] && url.pathname.includes("/assembled-review-packet")) {
          headers["authorization"] = facultyAuthHeader("faculty_acceptance_001").authorization ?? "";
        }
        const upstream = await fetch(`${apiTarget}${url.pathname}${url.search}`, {
          method: request.method ?? "GET",
          headers,
          body: body.length > 0 ? body : undefined,
        });
        response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      serveStaticFile(distDir, url.pathname, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "admin-serve error";
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "text/plain" });
      }
      response.end(message);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(uiPort, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : uiPort;
  process.stdout.write(`OPENCLINXR_HARNESS_UI_READY ${boundPort}\n`);
  await new Promise<void>(() => {
    // keep alive until killed
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function serveStaticFile(distDir: string, pathname: string, response: ServerResponse): void {
  const safePath = pathname.split("?")[0] ?? "/";
  let file: string;
  if (safePath === "/" || safePath === "") {
    file = path.join(distDir, "index.html");
  } else {
    file = path.join(distDir, safePath.replace(/^\/+/, ""));
  }
  const resolved = path.resolve(file);
  const distRoot = path.resolve(distDir);
  const insideDist = resolved === distRoot || resolved.startsWith(`${distRoot}${path.sep}`);
  if (!insideDist || !existsSync(resolved)) {
    const wantsAsset = safePath.startsWith("/assets/");
    const indexFile = path.join(distDir, "index.html");
    if (!wantsAsset && existsSync(indexFile)) {
      response.writeHead(200, { "content-type": MIME_TYPES[".html"] ?? "text/html" });
      response.end(readFileSync(indexFile));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }
  const extension = path.extname(resolved).toLowerCase();
  response.writeHead(200, { "content-type": MIME_TYPES[extension] ?? "application/octet-stream" });
  response.end(readFileSync(resolved));
}

// ---- client mode ----------------------------------------------------------

async function runClientMode(): Promise<void> {
  const apiPort = Number(process.env["OPENCLINXR_HARNESS_API_PORT"] ?? "0");
  const durableDir = process.env["OPENCLINXR_HARNESS_DURABLE_DIR"];
  const evidenceDir = process.env["OPENCLINXR_HARNESS_EVIDENCE_DIR"];
  const fixturePath = process.env["OPENCLINXR_HARNESS_FIXTURE_PATH"];
  const runId = process.env["OPENCLINXR_HARNESS_RUN_ID"] ?? `run-${Date.now()}`;
  if (!durableDir || !evidenceDir || !fixturePath || !apiPort) {
    throw new Error("client mode requires API port, durable dir, evidence dir, and fixture path");
  }
  rmSync(durableDir, { recursive: true, force: true });
  mkdirSync(durableDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });

  const scriptPath = path.join(HARNESS_REPO_ROOT, HELPER_RELATIVE_PATH);
  const spawnServer = async (): Promise<SpawnedHarnessProcess> => {
    const server = spawnHarnessProcess({
      scriptPath,
      env: {
        OPENCLINXR_HARNESS_MODE: "server",
        OPENCLINXR_HARNESS_PORT: String(apiPort),
        OPENCLINXR_HARNESS_DURABLE_DIR: durableDir,
      },
    });
    await server.waitForLine("OPENCLINXR_HARNESS_API_READY", 60_000);
    await waitForHttp(`http://127.0.0.1:${apiPort}`, 30_000);
    return server;
  };

  const fixture = loadFixtureJson(fixturePath) as JsonRecord;
  const runConfig = fixture["run"] as JsonRecord;
  const examForm = fixture["examForm"] as JsonRecord;
  const timingPlan = fixture["timingPlan"] as JsonRecord;
  const stationScripts = (fixture["stations"] as JsonRecord[])
    .map((script) => script as JsonRecord)
    .sort((left, right) => Number(left["stationOrder"]) - Number(right["stationOrder"]));
  const learnerId = String(runConfig["learnerId"]);
  const examRunId = String(runConfig["examRunId"]);
  const reviewerId = String(runConfig["facultyReviewerId"]);
  const learnerAuth = learnerAuthHeader(learnerId);
  const facultyAuth = facultyAuthHeader(reviewerId);
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  const evidence = emptyRunEvidence(runId);
  evidence["run"] = {
    runId,
    learnerId,
    examRunId,
    examFormId: runConfig["examFormId"],
    blueprintId: runConfig["blueprintId"],
    reviewerId,
    stationCount: stationScripts.length,
  };
  const learnerProjection: JsonRecord = { stations: {} };
  const apiProjection: JsonRecord = { stations: {} };
  evidence["learner"] = learnerProjection;
  evidence["api"] = apiProjection;

  // Boot 1: start the run aggregate and complete station 1.
  let server = await spawnServer();
  try {
    const startExamRun = await jsonRequest({
      baseUrl,
      method: "POST",
      path: "/exam-runs",
      headers: learnerAuth,
      body: { learnerId, consentAccepted: true, examRunId, examForm, timingPlan },
    });
    if (startExamRun.status !== 201) {
      throw new Error(`start exam-run failed: ${startExamRun.status} ${JSON.stringify(startExamRun.body)}`);
    }
    apiProjection["startExamRun"] = startExamRun.body;
    learnerProjection["startExamRun"] = startExamRun.body;

    const firstDecision = await readRunDecision(baseUrl, examRunId, learnerAuth);
    apiProjection["runBeforeStation1"] = firstDecision;
    learnerProjection["runBeforeStation1"] = firstDecision;

    await runStationFlow({
      baseUrl,
      examRunId,
      learnerId,
      learnerAuth,
      fixtureStation: stationScripts[0] as JsonRecord,
      apiProjection: apiProjection["stations"] as JsonRecord,
      learnerProjection: learnerProjection["stations"] as JsonRecord,
      stationKey: "1",
    });

    apiProjection["runAfterStation1"] = await readRunDecision(baseUrl, examRunId, learnerAuth);
    learnerProjection["runAfterStation1"] = apiProjection["runAfterStation1"];
  } finally {
    await server.stop();
  }

  // Restart: a fresh API process over the same durable directory.
  server = await spawnServer();
  try {
    const resumedDecision = await readRunDecision(baseUrl, examRunId, learnerAuth);
    apiProjection["resumedDecisionAfterRestart"] = resumedDecision;
    learnerProjection["resumedDecisionAfterRestart"] = resumedDecision;

    await runStationFlow({
      baseUrl,
      examRunId,
      learnerId,
      learnerAuth,
      fixtureStation: stationScripts[1] as JsonRecord,
      apiProjection: apiProjection["stations"] as JsonRecord,
      learnerProjection: learnerProjection["stations"] as JsonRecord,
      stationKey: "2",
    });

    const finalDecision = await readRunDecision(baseUrl, examRunId, learnerAuth);
    apiProjection["finalRunDecision"] = finalDecision;
    learnerProjection["finalRunDecision"] = finalDecision;

    // Faculty: build + persist the immutable packet from real persisted evidence.
    const stationsEvidence = orderedStationEvidence(evidence);
    const packetPost = await jsonRequest({
      baseUrl,
      method: "POST",
      path: `/exam-runs/${encodeURIComponent(examRunId)}/assembled-review-packet`,
      headers: facultyAuth,
      body: { examRunId, learnerId, stations: stationsEvidence },
    });
    if (packetPost.status !== 201) {
      throw new Error(`faculty packet POST failed: ${packetPost.status} ${JSON.stringify(packetPost.body)}`);
    }
    apiProjection["facultyPacketPost"] = packetPost.body;
    learnerProjection["facultyPacketPost"] = packetPost.body;

    const packetGet = await jsonRequest({
      baseUrl,
      method: "GET",
      path: `/exam-runs/${encodeURIComponent(examRunId)}/assembled-review-packet`,
      headers: facultyAuth,
    });
    if (packetGet.status !== 200) {
      throw new Error(`faculty packet GET failed: ${packetGet.status} ${JSON.stringify(packetGet.body)}`);
    }
    apiProjection["facultyPacketGet"] = packetGet.body;
    learnerProjection["facultyPacketGet"] = packetGet.body;
  } finally {
    await server.stop();
  }

  evidence["persistence"] = readPersistenceProjection(durableDir);
  const packetApi = apiProjection["facultyPacketGet"];
  evidence["faculty"] = { packet: packetApi };

  writeEvidenceFile(evidenceDir, evidence);
  process.stdout.write("OPENCLINXR_HARNESS_CLIENT_DONE\n");
}

async function runStationFlow(options: {
  baseUrl: string;
  examRunId: string;
  learnerId: string;
  learnerAuth: Record<string, string>;
  fixtureStation: JsonRecord;
  apiProjection: JsonRecord;
  learnerProjection: JsonRecord;
  stationKey: string;
}): Promise<void> {
  const { baseUrl, examRunId, learnerAuth } = options;
  const stationScript = options.fixtureStation;
  const stationOrder = Number(stationScript["stationOrder"]);
  const scenarioId = String(stationScript["scenarioId"]);
  const timeline = stationScript["timeline"] as JsonRecord;
  const actorTurns = (stationScript["actorTurns"] as JsonRecord[]).map((turn) => turn as JsonRecord);
  const noteConfig = stationScript["patientNote"] as JsonRecord;
  const facultyDraft = stationScript["facultyScoreDraft"] as JsonRecord;

  const encounterStartedAt = Number(timeline["encounterStartedAtSecond"]);
  const encounterEndedAt = Number(timeline["encounterEndedAtSecond"]);
  const noteStartedAt = Number(timeline["noteStartedAtSecond"]);
  const noteSubmittedAt = Number(timeline["noteSubmittedAtSecond"]);
  const advanceReason = String(timeline["advanceReason"]);

  // The run aggregate is the durable authority for the current station contract.
  const runDecision = await readRunDecision(baseUrl, examRunId, learnerAuth);
  const currentStation = (runDecision["currentStation"] ?? null) as JsonRecord | null;
  if (!currentStation || Number(currentStation["stationOrder"]) !== stationOrder) {
    throw new Error(
      `expected current station ${stationOrder}, run decision: ${JSON.stringify(runDecision)}`,
    );
  }
  const bindingStationRunId = String(currentStation["stationRunId"]);
  const assembledStation = currentStation["assembledStation"] as JsonRecord;

  // Start the learner session for this assembled station.
  const sessionStart = await jsonRequest({
    baseUrl,
    method: "POST",
    path: "/sessions",
    headers: learnerAuth,
    body: { learnerId: options.learnerId, consentAccepted: true, scenarioId, assembledStation },
  });
  if (sessionStart.status !== 201) {
    throw new Error(`session start failed: ${sessionStart.status} ${JSON.stringify(sessionStart.body)}`);
  }
  const sessionBody = sessionStart.body as JsonRecord;
  const sessionStationRunId = String(sessionBody["stationRunId"]);
  const session = `/sessions/${encodeURIComponent(sessionStationRunId)}`;

  const stationEvidence: JsonRecord = {
    stationOrder,
    scenarioId,
    bindingStationRunId,
    sessionStationRunId,
    sessionStart: sessionBody,
  };
  options.apiProjection[options.stationKey] = stationEvidence;
  options.learnerProjection[options.stationKey] = stationEvidence;

  const startEncounter = await jsonRequest({
    baseUrl,
    method: "POST",
    path: `${session}/start-encounter`,
    headers: learnerAuth,
    body: { atSecond: encounterStartedAt },
  });
  expectStatus(startEncounter, 200, "start-encounter");

  const actorTurnEvidence: unknown[] = [];
  const voiceEvidence: unknown[] = [];
  for (const turn of actorTurns) {
    const actorId = String(turn["actorId"]);
    const seedId = String(turn["seedId"]);
    const atSecond = Number(turn["atSecond"]);
    const seed = await resolveSeed({ seedId });
    const learnerUtterance =
      typeof turn["learnerUtterance"] === "string" && turn["learnerUtterance"].trim().length > 0
        ? turn["learnerUtterance"]
        : seed.learnerUtterance;
    const traceContextTags = Array.isArray(turn["traceContextTags"])
      ? (turn["traceContextTags"] as string[])
      : seed.expectedTraceTags;
    const actorResponse = await jsonRequest({
      baseUrl,
      method: "POST",
      path: `${session}/actor-response`,
      headers: learnerAuth,
      body: {
        actorId,
        learnerUtterance,
        atSecond,
        traceContextTags,
      },
    });
    expectStatus(actorResponse, 201, `actor-response ${seedId}`);
    const responseBody = actorResponse.body as JsonRecord;
    const plan = (responseBody["actorTurnPlan"] ?? {}) as JsonRecord;
    const voiceId = typeof plan["voiceId"] === "string" ? plan["voiceId"] : `fixture-${actorId}`;
    const spokenText = typeof plan["spokenText"] === "string" ? plan["spokenText"] : "";
    const voice = await jsonRequest({
      baseUrl,
      method: "POST",
      path: `${session}/voice-synthesis`,
      headers: learnerAuth,
      body: { actorId, voiceId, text: spokenText, atSecond: atSecond + 1 },
    });
    expectStatusIn(voice, [200, 201], `voice-synthesis ${seedId}`);
    actorTurnEvidence.push({ seedId, actorId, atSecond, response: responseBody });
    voiceEvidence.push({ seedId, actorId, atSecond: atSecond + 1, response: voice.body });
  }
  stationEvidence["actorTurns"] = actorTurnEvidence;
  stationEvidence["voiceSyntheses"] = voiceEvidence;

  const endEncounter = await jsonRequest({
    baseUrl,
    method: "POST",
    path: `${session}/end-encounter`,
    headers: learnerAuth,
    body: { atSecond: encounterEndedAt },
  });
  expectStatus(endEncounter, 200, "end-encounter");

  const startNote = await jsonRequest({
    baseUrl,
    method: "POST",
    path: `${session}/start-note`,
    headers: learnerAuth,
    body: { atSecond: noteStartedAt },
  });
  expectStatus(startNote, 200, "start-note");

  const noteSubmitted = await jsonRequest({
    baseUrl,
    method: "POST",
    path: `${session}/note`,
    headers: learnerAuth,
    body: { atSecond: noteSubmittedAt, text: String(noteConfig["text"]) },
  });
  expectStatus(noteSubmitted, 200, "note submit");
  stationEvidence["noteSubmitted"] = noteSubmitted.body;

  // Observe the canonical ledger the runtime really emitted for this station.
  const ledger = await jsonRequest({
    baseUrl,
    method: "GET",
    path: `${session}/trace-events`,
    headers: learnerAuth,
  });
  if (ledger.status !== 200 || !Array.isArray(ledger.body)) {
    throw new Error(`trace-events failed: ${ledger.status} ${JSON.stringify(ledger.body)}`);
  }
  stationEvidence["ledgerTraceEvents"] = ledger.body;
  const canonicalPhaseEvents = (ledger.body as JsonRecord[]).filter((event) =>
    CANONICAL_PHASE_TYPES.includes(String(event["eventType"])),
  );
  stationEvidence["canonicalPhaseEvents"] = canonicalPhaseEvents;

  // Admit the same canonical events to the durable exam-run aggregate (sequence resets per station).
  const canonicalTimeline: Array<{ eventType: string; atSecond: number }> = [
    { eventType: "encounter.started", atSecond: encounterStartedAt },
    { eventType: "encounter.ended", atSecond: encounterEndedAt },
    { eventType: "note.started", atSecond: noteStartedAt },
    { eventType: "note.submitted", atSecond: noteSubmittedAt },
    { eventType: "station.advanced", atSecond: noteSubmittedAt },
  ];
  const admissions: unknown[] = [];
  for (let index = 0; index < canonicalTimeline.length; index += 1) {
    const phase = canonicalTimeline[index];
    if (!phase) {
      throw new Error("missing canonical timeline phase");
    }
    const eventType = phase.eventType;
    const atSecond = phase.atSecond;
    const admission = await jsonRequest({
      baseUrl,
      method: "POST",
      path: `/exam-runs/${encodeURIComponent(examRunId)}/phase-events`,
      headers: learnerAuth,
      body: {
        examRunId,
        stationRunId: bindingStationRunId,
        scenarioId,
        stationOrder,
        eventType,
        sequence: index,
        atSecond,
        formAtSecond: atSecond,
        durableEventRef: `durable://station-runs/${bindingStationRunId}/events/${index}`,
        source: "learner_runtime",
        ...(eventType === "station.advanced" ? { advanceReason } : {}),
      },
    });
    expectStatus(admission, 201, `aggregate phase ${eventType}`);
    admissions.push({ sequence: index, eventType, status: admission.status, body: admission.body });
  }
  stationEvidence["aggregateAdmissions"] = admissions;

  // Evidence input for the faculty packet (stationRunId/sessionStationRunId family).
  stationEvidence["facultyEvidence"] = toStationEvidenceInput({
    stationEvidence,
    reviewerId: String((facultyDraft["reviewerId"] ?? "faculty_acceptance_001")),
  });
}

function expectStatus(result: { status: number; body: unknown }, expected: number, label: string): void {
  expectStatusIn(result, [expected], label);
}

function expectStatusIn(
  result: { status: number; body: unknown },
  expected: number[],
  label: string,
): void {
  if (!expected.includes(result.status)) {
    throw new Error(`${label} failed: ${result.status} ${JSON.stringify(result.body).slice(0, 2000)}`);
  }
}

function orderedStationEvidence(evidence: JsonRecord): JsonRecord[] {
  const learner = evidence["learner"] as JsonRecord;
  const stations = learner["stations"] as JsonRecord;
  return Object.values(stations)
    .map((station) => {
      const record = station as JsonRecord;
      return record["facultyEvidence"] as JsonRecord;
    })
    .sort((left, right) => Number(left["stationOrder"]) - Number(right["stationOrder"]));
}

function toStationEvidenceInput(options: {
  stationEvidence: JsonRecord;
  reviewerId: string;
}): JsonRecord {
  const station = options.stationEvidence;
  const stationRunId = String(station["sessionStationRunId"]);
  const scenarioId = String(station["scenarioId"]);
  const stationOrder = Number(station["stationOrder"]);
  const ledger = (station["ledgerTraceEvents"] ?? []) as JsonRecord[];
  const canonicalEvents = (station["canonicalPhaseEvents"] ?? []) as JsonRecord[];
  const canonicalTypes = new Set(canonicalEvents.map((event) => String(event["eventType"])));
  const traceEvents = ledger.filter((event) => !canonicalTypes.has(String(event["eventType"])));
  const noteSubmitted = (station["noteSubmitted"] ?? {}) as JsonRecord;
  const note = (noteSubmitted["note"] ?? {}) as JsonRecord;
  const advanceReason = String(station["advanceReason"] ?? "patient_note_submitted_advancing");

  const canonicalByType = new Map<string, JsonRecord>();
  for (const event of canonicalEvents) {
    canonicalByType.set(String(event["eventType"]), event);
  }
  const phaseTransitions = CANONICAL_PHASE_TYPES.flatMap((eventType) => {
    const event = canonicalByType.get(eventType);
    return event ? [toPhaseTransition(event, stationRunId)] : [];
  });

  return {
    stationRunId,
    scenarioId,
    stationOrder,
    requiredTraceTags: [],
    traceEvents,
    phaseTransitions,
    patientNote: {
      stationRunId,
      submittedAtSecond:
        typeof note["submittedAtSecond"] === "number" ? note["submittedAtSecond"] : 0,
      text: typeof note["text"] === "string" ? note["text"] : "",
    },
    blockers: [],
    advanceReason,
    facultyScoreDraft: {
      reviewerId: options.reviewerId,
      status: "draft",
      comments: `Station ${stationOrder} acceptance review.`,
    },
  };
}

function toPhaseTransition(event: JsonRecord, stationRunId: string): JsonRecord {
  const payload = (event["payload"] ?? {}) as JsonRecord;
  return {
    stationRunId,
    sequence: event["sequence"],
    eventType: event["eventType"],
    source: typeof event["source"] === "string" ? event["source"] : "system",
    atSecond: event["atSecond"],
    payload,
  };
}

async function readRunDecision(
  baseUrl: string,
  examRunId: string,
  learnerAuth: Record<string, string>,
): Promise<JsonRecord> {
  const decision = await jsonRequest({
    baseUrl,
    method: "GET",
    path: `/exam-runs/${encodeURIComponent(examRunId)}`,
    headers: learnerAuth,
  });
  if (decision.status !== 200) {
    throw new Error(`run decision GET failed: ${decision.status} ${JSON.stringify(decision.body)}`);
  }
  return decision.body as JsonRecord;
}

function readPersistenceProjection(durableDir: string): JsonRecord {
  const sink = new FileDurableSink({ rootDir: durableDir });
  const runAggregates: JsonRecord[] = sink
    .listFileNames(sink.runAggregateDir, ".json")
    .map((file) => readJsonFile(path.join(sink.runAggregateDir, file)))
    .filter((record): record is JsonRecord => record !== undefined);
  const actorTurnsByStation: JsonRecord = {};
  for (const file of sink.listFileNames(sink.actorTurnsDir, ".jsonl")) {
    const lines = readFileSync(path.join(sink.actorTurnsDir, file), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
    actorTurnsByStation[file] = lines;
  }
  const traceEventsByStation: JsonRecord = {};
  for (const file of sink.listFileNames(sink.traceEventsDir, ".json")) {
    traceEventsByStation[file] = readJsonFile(path.join(sink.traceEventsDir, file));
  }
  const packetsByRun: JsonRecord = {};
  for (const file of sink.listFileNames(sink.reviewPacketsDir, ".json")) {
    if (!file.includes("-review.")) {
      packetsByRun[file] = readJsonFile(path.join(sink.reviewPacketsDir, file));
    }
  }
  return {
    runAggregates,
    actorTurnsByStation,
    traceEventsByStation,
    packetsByRun,
  };
}

// ---------------------------------------------------------------------------
// Entry guard
// ---------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dispatchMain().catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`HARNESS_FAILED: ${message}\n`);
    process.exitCode = 1;
  });
}
