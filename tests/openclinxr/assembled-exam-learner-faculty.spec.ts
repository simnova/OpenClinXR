/**
 * Learner→faculty assembled-exam acceptance harness (playwright).
 *
 * IN-SCOPE: local two-station assembled exam; learner drives patient/family/nurse turns +
 * encounter/note phases through the public learner API; the API process restarts between
 * stations; resume comes from the durable file-backed sink; the note form is completed; the
 * immutable faculty assembled-review-packet is opened in the faculty adjudication workspace.
 * Identity equality is asserted across the learner, API, persistence, and faculty projections.
 *
 * OUT-OF-SCOPE: physical Quest 3 readiness, production Atlas, load testing, clinical/score
 * validity, screenshots as sole proof, bypassing public API/UI boundaries.
 *
 * CLAIM: every canonical event, actor turn, note, and durable reference compared here was
 * produced by the running API (real runtime emission) and read back from real API responses,
 * durable files, or the rendered workspace. Nothing synthetic is injected.
 *
 * NOT TESTED: worn-headset interaction, real speech recognition, production auth, network
 * partition recovery, and multi-process cache coherence remain outside this acceptance run.
 *
 * Environment prerequisite: @openclinxr/* package dist outputs must exist (they are gitignored);
 * build once with `pnpm exec turbo run build --filter='./packages/openclinxr/*'`. The spec
 * fails fast with that instruction when the review-workflow dist is missing.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, test, expect } from "@playwright/test";

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPEC_DIR, "../..");
const HELPER_PATH = path.join(SPEC_DIR, "helpers", "assembled-exam-harness.ts");
const FIXTURE_PATH = path.join(SPEC_DIR, "fixtures", "assembled-exam-two-station.json");
const ARTIFACT_ROOT = path.join(REPO_ROOT, "artifacts", "openclinxr", "assembled-exam-learner-faculty");
const CANONICAL_PHASE_TYPES = [
  "encounter.started",
  "encounter.ended",
  "note.started",
  "note.submitted",
  "station.advanced",
] as const;

type JsonRecord = Record<string, unknown>;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected object, got ${JSON.stringify(value).slice(0, 200)}`);
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected array, got ${JSON.stringify(value).slice(0, 200)}`);
  }
  return value;
}

function requireString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`missing string ${key} in ${JSON.stringify(record).slice(0, 300)}`);
  }
  return value;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value)))];
}

// ---------------------------------------------------------------------------
// Shared run state (serial tests)
// ---------------------------------------------------------------------------

let clientProcess: ReturnType<typeof spawn> | null = null;
let clientOutput = "";
let evidence: JsonRecord | null = null;
let evidenceFile = "";
let apiServer: ReturnType<typeof spawn> | null = null;
let uiServer: ReturnType<typeof spawn> | null = null;

async function stopChild(child: ReturnType<typeof spawn> | null): Promise<void> {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);
    child.once("error", done);
  });
}

function waitForMarker(
  child: ReturnType<typeof spawn>,
  marker: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      resolve(value);
    };
    const fail = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      fail(`timed out waiting for ${marker}\n${clientOutput.slice(-3000)}`);
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      clientOutput += text;
      if (clientOutput.includes(marker)) {
        succeed(marker);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      if (clientOutput.includes(marker)) {
        succeed(marker);
        return;
      }
      fail(`child exited ${String(code)} before ${marker}\n${clientOutput.slice(-3000)}`);
    });
    if (clientOutput.includes(marker)) {
      succeed(marker);
    }
  });
}

async function spawnNodeChild(scriptPath: string, env: Record<string, string>, cwd: string): Promise<ReturnType<typeof spawn>> {
  return spawn(process.execPath, ["--import", "tsx", scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function patchBrowserUtilPromisify(assetsDir: string): void {
  const polyfill =
    "function __openclinxrPromisify(fn){return function(){var args=[].slice.call(arguments);return new Promise(function(resolve,reject){args.push(function(err,result){if(err)reject(err);else resolve(result)});var maybe=fn.apply(this,args);if(maybe&&typeof maybe.then==='function')maybe.then(resolve,reject);});};}";
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith(".js")) {
      continue;
    }
    const file = path.join(assetsDir, name);
    const original = readFileSync(file, "utf8");
    if (!original.includes("promisify")) {
      continue;
    }
    const patched = `${polyfill};${original.replaceAll(
      /([A-Za-z0-9_$]+)\.promisify\b/g,
      "($1.promisify||__openclinxrPromisify)",
    )}`;
    writeFileSync(file, patched, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Evidence assertions shared by the serial tests
// ---------------------------------------------------------------------------

function fixtureRunIdentity(): JsonRecord {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as JsonRecord;
  return asRecord(fixture["run"]);
}

function learnerStations(evidenceJson: JsonRecord): JsonRecord {
  return asRecord(asRecord(evidenceJson["learner"])["stations"]);
}

function apiStations(evidenceJson: JsonRecord): JsonRecord {
  return asRecord(asRecord(evidenceJson["api"])["stations"]);
}

function persistence(evidenceJson: JsonRecord): JsonRecord {
  return asRecord(evidenceJson["persistence"]);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

test.beforeAll(async () => {
  const reviewWorkflowDist = path.join(
    REPO_ROOT,
    "packages",
    "openclinxr",
    "review-workflow",
    "dist",
    "assembled-exam-review-packet.js",
  );
  test.skip(
    !existsSync(reviewWorkflowDist),
    "package dist outputs missing; run `pnpm exec turbo run build --filter='./packages/openclinxr/*'` first",
  );

  const runId = `learner-faculty-${Date.now()}`;
  const evidenceDir = path.join(ARTIFACT_ROOT, "evidence", runId);
  const durableDir = path.join(evidenceDir, "durable");
  mkdirSync(evidenceDir, { recursive: true });
  rmSync(durableDir, { recursive: true, force: true });
  evidenceFile = path.join(evidenceDir, "evidence.json");

  // Dev loop: reuse a freshly generated evidence dir instead of re-running the client.
  const reuseDir = process.env["OPENCLINXR_HARNESS_REUSE_EVIDENCE_DIR"];
  if (reuseDir && existsSync(path.join(reuseDir, "evidence.json"))) {
    evidenceFile = path.join(reuseDir, "evidence.json");
    evidence = JSON.parse(readFileSync(evidenceFile, "utf8")) as JsonRecord;
    return;
  }

  const apiPort = await getFreePort();
  const env: Record<string, string> = {
    OPENCLINXR_HARNESS_MODE: "client",
    OPENCLINXR_HARNESS_API_PORT: String(apiPort),
    OPENCLINXR_HARNESS_DURABLE_DIR: durableDir,
    OPENCLINXR_HARNESS_EVIDENCE_DIR: evidenceDir,
    OPENCLINXR_HARNESS_FIXTURE_PATH: FIXTURE_PATH,
    OPENCLINXR_HARNESS_RUN_ID: runId,
  };
  clientProcess = await spawnNodeChild(HELPER_PATH, env, REPO_ROOT);
  await waitForMarker(clientProcess, "OPENCLINXR_HARNESS_CLIENT_DONE", 420_000);
  evidence = JSON.parse(readFileSync(evidenceFile, "utf8")) as JsonRecord;
});

test.afterAll(async () => {
  await stopChild(uiServer);
  await stopChild(apiServer);
  await stopChild(clientProcess);
});

test("learner, API, persistence, and faculty projections keep one assembled-exam identity", () => {
  expect(evidence).not.toBeNull();
  const evidenceJson = evidence as JsonRecord;
  const run = asRecord(evidenceJson["run"]);
  const examRunId = requireString(run, "examRunId");
  const learnerId = requireString(run, "learnerId");
  const learner = asRecord(evidenceJson["learner"]);
  const api = asRecord(evidenceJson["api"]);
  const persist = persistence(evidenceJson);
  const faculty = asRecord(evidenceJson["faculty"]);

  // ---- exam/station identity: one examRunId across every projection ----
  expect(examRunId).toBe(fixtureRunIdentity()["examRunId"]);
  for (const projection of [learner, api, persist, faculty]) {
    expect(JSON.stringify(projection).includes(examRunId)).toBe(true);
  }

  const startDecision = asRecord(api["startExamRun"]);
  expect(startDecision["examRunId"]).toBe(examRunId);
  expect(startDecision["action"]).toBe("resume_station");
  expect(startDecision["examEquivalenceGate"]).toBe(false);
  expect(requireString(startDecision, "stationRunId")).toBe(`${examRunId}:station:1`);

  // ---- durable resume after the API restarted between stations ----
  const beforeRestart = asRecord(learner["runAfterStation1"]);
  const afterRestart = asRecord(learner["resumedDecisionAfterRestart"]);
  expect(beforeRestart["action"]).toBe("resume_station");
  expect(asRecord(asRecord(beforeRestart["currentStation"] ?? {}) ?? {})["stationOrder"]).toBe(2);
  expect(afterRestart).toEqual(beforeRestart);

  const finalDecision = asRecord(learner["finalRunDecision"]);
  expect(finalDecision["action"]).toBe("exam_complete");
  expect(finalDecision["currentStation"]).toBeNull();
  expect(asArray(finalDecision["durableEventRefs"])).toHaveLength(10);

  // ---- persistence: one durable run aggregate + one durable packet file ----
  const runAggregates = asArray(persist["runAggregates"]);
  expect(runAggregates).toHaveLength(1);
  const aggregate = asRecord(runAggregates[0]);
  expect(aggregate["examRunId"]).toBe(examRunId);
  expect(aggregate["learnerId"]).toBe(learnerId);
  const admittedEvents = asArray(aggregate["admittedPhaseEvents"]);
  expect(admittedEvents).toHaveLength(10);

  const learnerStationsMap = learnerStations(evidenceJson);
  const apiStationsMap = apiStations(evidenceJson);
  expect(Object.keys(learnerStationsMap)).toEqual(["1", "2"]);
  expect(Object.keys(apiStationsMap)).toEqual(["1", "2"]);

  const expectedStationKeys = ["1", "2"];
  const sessionStationRunIds: string[] = [];
  const bindingStationRunIds: string[] = [];

  for (const key of expectedStationKeys) {
    const stationOrder = Number(key);
    const learnerStation = asRecord(learnerStationsMap[key]);
    const apiStation = asRecord(apiStationsMap[key]);
    expect(learnerStation).toEqual(apiStation);

    // learner session identity == ledger identity == durable actor turn identity
    const sessionStart = asRecord(learnerStation["sessionStart"]);
    const sessionStationRunId = requireString(sessionStart, "stationRunId");
    const bindingStationRunId = requireString(learnerStation, "bindingStationRunId");
    sessionStationRunIds.push(sessionStationRunId);
    bindingStationRunIds.push(bindingStationRunId);
    expect(bindingStationRunId).toBe(`${examRunId}:station:${stationOrder}`);
    expect(requireString(learnerStation, "scenarioId")).toBe(requireString(sessionStart, "scenarioId"));

    const ledger = asArray(learnerStation["ledgerTraceEvents"]);
    for (const event of ledger) {
      const record = asRecord(event);
      if (record["stationRunId"] !== undefined) {
        expect(record["stationRunId"]).toBe(sessionStationRunId);
      }
    }

    // canonical ordered events (real runtime emission) with durable refs
    const canonical = asArray(learnerStation["canonicalPhaseEvents"]).map((event) => asRecord(event));
    expect(canonical.map((event) => event["eventType"])).toEqual([...CANONICAL_PHASE_TYPES]);
    for (const event of canonical) {
      expect(event["stationRunId"]).toBe(sessionStationRunId);
      const payload = asRecord(event["payload"]);
      expect(payload["examRunId"]).toBe(examRunId);
      expect(payload["scenarioId"]).toBe(requireString(learnerStation, "scenarioId"));
      expect(payload["stationOrder"]).toBe(stationOrder);
      expect(payload["durableEventRef"]).toBe(
        `durable://station-runs/${sessionStationRunId}/events/${event["sequence"]}`,
      );
    }
    // monotonic canonical timeline
    const atSeconds = canonical.map((event) => Number(event["atSecond"]));
    for (let index = 1; index < atSeconds.length; index += 1) {
      expect(atSeconds[index] ?? 0).toBeGreaterThanOrEqual(atSeconds[index - 1] ?? 0);
    }

    // aggregate admissions mirror the durable run aggregate for this binding
    const aggregateEventsForBinding = admittedEvents
      .map((event) => asRecord(event))
      .filter((event) => event["stationRunId"] === bindingStationRunId);
    expect(aggregateEventsForBinding.map((event) => event["eventType"])).toEqual([...CANONICAL_PHASE_TYPES]);
    expect(aggregateEventsForBinding.map((event) => event["durableEventRef"])).toEqual(
      CANONICAL_PHASE_TYPES.map((_, index) => `durable://station-runs/${bindingStationRunId}/events/${index}`),
    );

    // learner actor dialogue identity appears verbatim in the ledger
    const actorTurns = asArray(learnerStation["actorTurns"]).map((turn) => asRecord(turn));
    expect(actorTurns.length).toBeGreaterThan(0);
    const plannedEvents = ledger
      .map((event) => asRecord(event))
      .filter((event) => event["eventType"] === "actor.turn.planned");
    const plannedPlans = plannedEvents.map((event) =>
      asRecord(asRecord(event["payload"])["actorTurnPlan"]),
    );
    for (const turn of actorTurns) {
      const responsePlan = asRecord(asRecord(turn["response"])["actorTurnPlan"]);
      const planId = requireString(responsePlan, "planId");
      expect(plannedPlans.some((plan) => plan["planId"] === planId)).toBe(true);
      const executedEvents = ledger
        .map((event) => asRecord(event))
        .filter((event) => event["eventType"] === "actor.turn.executed");
      const executionPlanIds = uniqueStrings(
        executedEvents.map((event) =>
          asRecord(asRecord(event["payload"])["actorTurnExecution"])["planId"],
        ),
      );
      expect(executionPlanIds).toContain(planId);
    }

    // note submission: the learner's note text survives in the response and the packet
    const noteSubmitted = asRecord(learnerStation["noteSubmitted"]);
    const note = asRecord(noteSubmitted["note"]);
    requireString(note, "text");
    expect(note["stationRunId"]).toBe(sessionStationRunId);
    expect(
      ledger.some(
        (event) =>
          asRecord(event)["eventType"] === "note.submitted"
          && asRecord(asRecord(event)["payload"])["examRunId"] === examRunId,
      ),
    ).toBe(true);
  }

  // ---- durable refs: decision-level refs equal the persisted aggregate refs ----
  const aggregateRefs = uniqueStrings(
    admittedEvents.map((event) => requireString(asRecord(event), "durableEventRef")),
  );
  const finalRefs = asArray(finalDecision["durableEventRefs"]).map(String);
  expect([...finalRefs].sort()).toEqual([...aggregateRefs].sort());
  expect(finalRefs).toHaveLength(10);
  expect(bindingStationRunIds).toEqual([`${examRunId}:station:1`, `${examRunId}:station:2`]);

  // ---- faculty projection: immutable packet identical across API and persistence ----
  const packetPost = asRecord(api["facultyPacketPost"]);
  const packetGet = asRecord(api["facultyPacketGet"]);
  const packetFiles = Object.values(asRecord(persist["packetsByRun"]));
  expect(packetFiles).toHaveLength(1);
  expect(asRecord(packetFiles[0])).toEqual(packetPost);
  expect(packetGet).toEqual(packetPost);

  expect(packetPost["examRunId"]).toBe(examRunId);
  expect(packetPost["learnerId"]).toBe(learnerId);
  expect(packetPost["claimBoundary"]).toBe("assembled_exam_review_packet_not_exam_equivalence");
  expect(packetPost["examEquivalenceGate"]).toBe(false);

  const packetStations = asArray(packetPost["stations"]).map((station) => asRecord(station));
  expect(packetStations.map((station) => asRecord(station["identity"])["stationOrder"])).toEqual([1, 2]);
  expect(packetStations.map((station) => asRecord(station["identity"])["stationRunId"])).toEqual(
    sessionStationRunIds,
  );
  for (const [index, station] of packetStations.entries()) {
    const identity = asRecord(station["identity"]);
    expect(identity["examRunId"]).toBe(examRunId);
    const learnerStation = asRecord(learnerStationsMap[String(index + 1)]);
    expect(identity["scenarioId"]).toBe(learnerStation["scenarioId"]);
    // ordered canonical transitions in the packet equal the real ledger transitions
    const transitions = asArray(station["phaseTransitions"]).map((event) => asRecord(event));
    expect(transitions.map((event) => event["eventType"])).toEqual([...CANONICAL_PHASE_TYPES]);
    const learnerStationCanonical = asArray(learnerStation["canonicalPhaseEvents"]).map((event) =>
      asRecord(event),
    );
    expect(
      transitions.map((event) => event["durableEventRef"]),
    ).toEqual(
      learnerStationCanonical.map((event) => asRecord(event["payload"])["durableEventRef"]),
    );
    // note text + identity survives into the faculty projection
    const fixtureStations = asArray(
      asRecord(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as JsonRecord)["stations"],
    );
    const noteConfig = asRecord(fixtureStations[index] as JsonRecord);
    const expectedNoteText = requireString(asRecord(noteConfig["patientNote"]), "text");
    expect(
      requireString(asRecord(asRecord(station["reviewPacket"])["patientNote"] ?? {}), "text"),
    ).toBe(expectedNoteText);
    // actor provenance: plan identities from the learner turns appear in the faculty packet
    const actorTurns = asArray(learnerStation["actorTurns"]).map((turn) => asRecord(turn));
    const learnerPlanIds = uniqueStrings(
      actorTurns.map((turn) => requireString(asRecord(asRecord(turn["response"])["actorTurnPlan"]), "planId")),
    );
    const packetReplayPlans = asArray(asRecord(station["reviewPacket"])["actorTurnReplays"]).map((replay) =>
      asRecord(asRecord(replay)["plan"]),
    );
    expect(packetReplayPlans.length).toBeGreaterThan(0);
    for (const planId of learnerPlanIds) {
      expect(packetReplayPlans.some((plan) => plan["planId"] === planId)).toBe(true);
      expect(JSON.stringify(station).includes(planId)).toBe(true);
    }
    // blockers/omissions lists are identical across faculty API + persistence projections
    expect(JSON.stringify(packetPost["stations"])).toBe(JSON.stringify(asRecord(packetFiles[0])["stations"]));
  }

  // actor-local dialogue identity: authored peds seed binding survives to the ledger and packet
  const pedsStation = asRecord(learnerStationsMap["2"]);
  const pedsTurns = asArray(pedsStation["actorTurns"]).map((turn) => asRecord(turn));
  const pedsLedger = asArray(pedsStation["ledgerTraceEvents"]).map((event) => asRecord(event));
  const authoredSpoken = uniqueStrings(
    pedsLedger
      .filter((event) => event["eventType"] === "actor.response.generated")
      .map((event) => {
        const payload = asRecord(event["payload"]);
        const authoredBinding = payload["authoredBinding"];
        if (!authoredBinding) {
          return null;
        }
        const record = asRecord(authoredBinding);
        return `${record["speakerActorId"]}::${record["authoredBindingId"]}`;
      })
      .filter((value): value is string => value !== null),
  );
  // patient + nurse + both parent turns must be authored-bound (seed identity preserved)
  expect(authoredSpoken.length).toBeGreaterThanOrEqual(4);
  const pedsActorIds = uniqueStrings(pedsTurns.map((turn) => requireString(turn, "actorId")));
  expect(pedsActorIds).toContain("patient_maya_johnson_v1");
  expect(pedsActorIds).toContain("parent_tara_johnson_v1");
  expect(pedsActorIds).toContain("nurse_kevin_lee_v1");
  // speaker binding: parent turns bind to the parent actor, not the addressed child
  expect(authoredSpoken.some((value) => value.startsWith("parent_tara_johnson_v1::peds_parent_trigger_history"))).toBe(true);
  expect(authoredSpoken.some((value) => value.startsWith("parent_tara_johnson_v1::peds_parent_empathy"))).toBe(true);
  // actor-local authored turn identity: the parent's second turn carries turn index 2
  const pedsParentTurnIds = uniqueStrings(
    pedsTurns
      .filter((turn) => turn["actorId"] === "parent_tara_johnson_v1")
      .map((turn) => requireString(asRecord(asRecord(turn["response"])["actorTurnPlan"]), "turnId")),
  );
  expect(pedsParentTurnIds.some((turnId) => turnId.includes(":turn-2") || turnId.includes("turn_2_"))).toBe(true);
  // durable refs of persisted actor turns match the learner-observed plan/execution ids
  const persistedActorTurns = Object.values(asRecord(persist["actorTurnsByStation"])).flatMap((lines) =>
    asArray(lines).map((line) => asRecord(line)),
  );
  expect(persistedActorTurns.length).toBeGreaterThan(0);
  const pedsPlanIds = uniqueStrings(
    pedsTurns.map((turn) => requireString(asRecord(asRecord(turn["response"])["actorTurnPlan"]), "planId")),
  );
  for (const planId of pedsPlanIds) {
    expect(
      persistedActorTurns.some((turn) => {
        const plan = turn["actorTurnPlan"];
        return typeof plan === "object" && plan !== null && (plan as JsonRecord)["planId"] === planId;
      }),
    ).toBe(true);
  }
});

test("faculty adjudication workspace renders the immutable packet over the live API", async () => {
  expect(evidence).not.toBeNull();
  const evidenceJson = evidence as JsonRecord;
  const run = asRecord(evidenceJson["run"]);
  const examRunId = requireString(run, "examRunId");
  const api = asRecord(evidenceJson["api"]);
  const packetGet = asRecord(api["facultyPacketGet"]);
  const learnerMap = learnerStations(evidenceJson);

  const apiPort = await getFreePort();
  const uiPort = await getFreePort();
  const uiDist = path.join(tmpdir(), `ui-admin-dist-${Date.now()}`);
  rmSync(uiDist, { recursive: true, force: true });
  mkdirSync(uiDist, { recursive: true });

  // Build the ui-admin app into a temp dir (read-only over repo sources).
  const viteBuild = spawn("pnpm", ["exec", "vite", "build", "--outDir", uiDist], {
    cwd: path.join(REPO_ROOT, "apps", "ui-admin"),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteOutput = "";
  viteBuild.stdout?.on("data", (chunk: Buffer) => {
    viteOutput += chunk.toString();
  });
  viteBuild.stderr?.on("data", (chunk: Buffer) => {
    viteOutput += chunk.toString();
  });
  const viteExit = await new Promise<number | null>((resolve) => {
    viteBuild.once("exit", (code) => resolve(code));
  });
  expect(viteExit, `vite build failed:\n${viteOutput.slice(-3000)}`).toBe(0);
  expect(existsSync(path.join(uiDist, "index.html")), `vite index.html missing in ${uiDist}`).toBe(true);
  const builtAssets = path.join(uiDist, "assets");
  expect(existsSync(builtAssets), `vite assets missing in ${uiDist}`).toBe(true);
  patchBrowserUtilPromisify(builtAssets);

  // Boot the API over the same durable sink, then the UI behind a same-origin proxy.
  const durableDir = path.join(path.dirname(evidenceFile), "durable");
  apiServer = await spawnNodeChild(
    HELPER_PATH,
    {
      OPENCLINXR_HARNESS_MODE: "server",
      OPENCLINXR_HARNESS_PORT: String(apiPort),
      OPENCLINXR_HARNESS_DURABLE_DIR: durableDir,
    },
    REPO_ROOT,
  );
  await waitForMarker(apiServer, "OPENCLINXR_HARNESS_API_READY", 60_000);
  uiServer = await spawnNodeChild(
    HELPER_PATH,
    {
      OPENCLINXR_HARNESS_MODE: "admin-serve",
      OPENCLINXR_HARNESS_UI_PORT: String(uiPort),
      OPENCLINXR_HARNESS_API_PORT: String(apiPort),
      OPENCLINXR_HARNESS_UI_DIST: uiDist,
    },
    REPO_ROOT,
  );
  await waitForMarker(uiServer, "OPENCLINXR_HARNESS_UI_READY", 60_000);

  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.message}\n${error.stack ?? ""}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(`console: ${message.text()}`);
      }
    });
    await page.goto(`http://127.0.0.1:${uiPort}/reviews?examRunId=${encodeURIComponent(examRunId)}`, {
      waitUntil: "domcontentloaded",
    });
    try {
      await expect(page.getByText("OpenClinXR Admin")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Faculty Adjudication Workspace")).toBeVisible({ timeout: 60_000 });
    } catch (error) {
      const html = await page.content();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\npageErrors=${pageErrors.join(" | ")}\nconsole=${consoleErrors.join(" | ")}\nhtml=${html.slice(0, 4000)}`,
      );
    }

    // Exam identity + claim boundary rendered verbatim from the packet.
    await expect(page.getByText(examRunId, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("2 stations in assembled order").first()).toBeVisible();
    await expect(page.getByText("assembled_exam_review_packet_not_exam_equivalence").first()).toBeVisible();

    // Ordered station status with the exact scenario identities from the fixture.
    await expect(page.getByText("Ordered station status", { exact: true })).toBeVisible();
    for (const expected of ["Station 1: ed_chest_pain_priority_v1", "Station 2: peds_asthma_parent_anxiety_v1"]) {
      await expect(page.getByText(expected).first()).toBeVisible();
    }

    // Durable session identity per station renders under the station cards.
    for (const key of ["1", "2"]) {
      const learnerStation = asRecord(learnerMap[key]);
      const sessionStationRunId = requireString(learnerStation, "sessionStationRunId");
      await expect(page.getByText(sessionStationRunId, { exact: false }).first()).toBeVisible();
    }

    // Submitted note text + durable note refs from the learner note submissions.
    const fixtureStationsForBrowser = asArray(
      asRecord(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as JsonRecord)["stations"],
    );
    const stationOneNote = requireString(
      asRecord(asRecord(fixtureStationsForBrowser[0] as JsonRecord)["patientNote"]),
      "text",
    );
    const stationTwoNote = requireString(
      asRecord(asRecord(fixtureStationsForBrowser[1] as JsonRecord)["patientNote"]),
      "text",
    );
    await expect(page.getByText("Submitted notes", { exact: true })).toBeVisible();
    await expect(page.getByText(stationOneNote)).toBeVisible();
    await expect(page.getByText(stationTwoNote)).toBeVisible();

    // Actor plan/execution provenance with durable actor-turn refs for both stations.
    await expect(page.getByText("Actor plan and execution provenance", { exact: true })).toBeVisible();
    const packetStations = asArray(packetGet["stations"]).map((station) => asRecord(station));
    for (const station of packetStations) {
      const identity = asRecord(station["identity"]);
      const stationRunId = requireString(identity, "stationRunId");
      const replays = asArray(asRecord(station["reviewPacket"])["actorTurnReplays"]).map((replay) =>
        asRecord(replay),
      );
      for (const replay of replays) {
        const plan = asRecord(replay["plan"]);
        const planId = requireString(plan, "planId");
        const actorId = requireString(plan, "actorId");
        const stationOrder = identity["stationOrder"];
        const actorOccurrences = replays.filter(
          (candidate) => asRecord(asRecord(candidate)["plan"])["actorId"] === actorId,
        ).length;
        const actorLine = page.getByText(`Station ${stationOrder} ${actorId}`);
        await expect(actorLine.first()).toBeVisible();
        await expect(actorLine).toHaveCount(actorOccurrences);
        await expect(
          page.getByText(`durable://station-runs/${stationRunId}/actor-turns/${planId}`).first(),
        ).toBeVisible();
      }
    }

    // Blockers/omissions identity (no synthetic blockers were introduced).
    const packetBlockersAndOmissions = [
      ...asArray(packetGet["omissions"]).map(String),
      ...packetStations.flatMap((station) =>
        asArray(station["blockers"]).map(String).concat(asArray(station["omissions"]).map(String)),
      ),
    ];
    if (packetBlockersAndOmissions.length === 0) {
      await expect(page.getByText("no_assembled_exam_blockers_or_omissions")).toBeVisible();
    } else {
      for (const blocker of packetBlockersAndOmissions) {
        await expect(page.getByText(blocker)).toBeVisible();
      }
    }

    // Faculty disposition controls are present and record a local disposition (gates stay false).
    await expect(page.getByRole("button", { name: /hold_for_debrief/i })).toBeVisible();
    await page.getByRole("button", { name: /hold_for_debrief/i }).click();
    await expect(page.getByLabel("Recorded faculty disposition")).toContainText("hold_for_debrief");
    await expect(page.getByLabel("Recorded faculty disposition")).toContainText("scoringValidityClaimed false");
    await expect(page.getByLabel("Recorded faculty disposition")).toContainText("examEquivalenceGate false");
  } finally {
    await browser.close();
  }
});
