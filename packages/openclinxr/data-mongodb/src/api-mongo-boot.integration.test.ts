import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMongoMemoryTestContext, type MongoMemoryTestContext } from "./mongo-memory-context.js";

/**
 * Boot module lives in tools/ (composition root). Load via absolute file URL so:
 * - vitest resolves the tools file (variable relative import breaks under Vite)
 * - package composite typecheck (rootDir: src) stays free of tools/ + apps/api graph
 */
const bootModuleHref = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../tools/openclinxr/api-mongo-boot.ts"),
).href;

type BootApiPersistence = (env?: {
  OPENCLINXR_PERSISTENCE?: string;
  MONGODB_URI?: string;
  OPENCLINXR_MONGODB_DB?: string;
}) => Promise<{
  mode: string;
  persistence?: unknown;
  fallbackReason?: string;
  close: () => Promise<void>;
}>;

type CreateBootedOpenClinXrApiStartup = (env?: {
  OPENCLINXR_PERSISTENCE?: string;
  MONGODB_URI?: string;
  OPENCLINXR_MONGODB_DB?: string;
}) => Promise<{
  startup: { fetch: (req: Request) => Response | Promise<Response> };
  boot: {
    mode: string;
    persistence?: unknown;
    fallbackReason?: string;
    close: () => Promise<void>;
  };
}>;

async function loadBootModule(): Promise<{
  bootApiPersistence: BootApiPersistence;
  createBootedOpenClinXrApiStartup: CreateBootedOpenClinXrApiStartup;
}> {
  return (await import(bootModuleHref)) as {
    bootApiPersistence: BootApiPersistence;
    createBootedOpenClinXrApiStartup: CreateBootedOpenClinXrApiStartup;
  };
}

describe("API Mongo boot cross-restart persistence", () => {
  let context: MongoMemoryTestContext;
  let uri: string;
  let dbName: string;
  let bootApiPersistence: BootApiPersistence;
  let createBootedOpenClinXrApiStartup: CreateBootedOpenClinXrApiStartup;

  beforeAll(async () => {
    context = await createMongoMemoryTestContext();
    uri = context.server.getUri();
    // MUST match mongo-memory-context.ts: client.db("openclinxr_test")
    dbName = "openclinxr_test";
    const bootModule = await loadBootModule();
    bootApiPersistence = bootModule.bootApiPersistence;
    createBootedOpenClinXrApiStartup = bootModule.createBootedOpenClinXrApiStartup;
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  async function fetchJson(
    startup: { fetch: (req: Request) => Response | Promise<Response> },
    method: string,
    path: string,
    body?: unknown,
  ) {
    const res = await startup.fetch(
      new Request(`http://localhost${path}`, {
        method,
        ...(body !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      }),
    );
    const json = await res.json().catch(() => undefined);
    return { status: res.status, json };
  }

  it(
    "persists a driven session run to Mongo and replays it after a simulated restart",
    async () => {
      const env = {
        OPENCLINXR_PERSISTENCE: "mongodb",
        MONGODB_URI: uri,
        OPENCLINXR_MONGODB_DB: dbName,
      };
      const first = await createBootedOpenClinXrApiStartup(env);
      expect(first.boot.mode).toBe("mongodb");

      const start = await fetchJson(first.startup, "POST", "/sessions", {
        learnerId: "boot_learner_001",
        consentAccepted: true,
      });
      expect(start.status).toBe(201);
      const stationRunId = (start.json as { stationRunId: string }).stationRunId;
      expect(stationRunId).toBeTruthy();

      await fetchJson(first.startup, "POST", `/sessions/${stationRunId}/start-encounter`, {
        atSecond: 60,
      });

      const actor = await fetchJson(first.startup, "POST", `/sessions/${stationRunId}/actor-response`, {
        actorId: "patient_robert_hayes_v1",
        learnerUtterance: "When did the chest pressure start?",
        atSecond: 120,
        traceContextTags: ["history_opqrst"],
      });
      expect(actor.status).toBe(201);

      await fetchJson(first.startup, "POST", `/sessions/${stationRunId}/note`, {
        atSecond: 1260,
        text: "Boot integration note: ACS concern; ECG requested; history elicited.",
      });

      const rp = await fetchJson(first.startup, "GET", `/sessions/${stationRunId}/review-packet`);
      expect(rp.status).toBe(200);

      expect(await context.db.collection("review_packets").findOne({ stationRunId })).not.toBeNull();
      expect(await context.db.collection("trace_events").countDocuments({ stationRunId })).toBeGreaterThan(0);
      expect(
        await context.db.collection("durable_conversation_turns").countDocuments({ stationRunId }),
      ).toBeGreaterThanOrEqual(1);

      // Simulate RESTART: fresh MongoClient + fresh sink, same db.
      const second = await createBootedOpenClinXrApiStartup(env);
      expect(second.boot.mode).toBe("mongodb");

      // ScenarioRuntimeDurableStore is write-only (no rehydrate/loadSession); a fresh runtime after
      // restart holds no in-memory session, so we assert persisted Mongo state via a fresh sink +
      // direct collection reads, not the in-memory GET routes. Runtime rehydration is a separate
      // slice owned by the app.ts route lane. This proves the durability gap is closed at the
      // persistence layer.
      const restartedSink = second.boot.persistence as unknown as {
        listConversationTurns: (id: string) => Promise<Array<{ stationRunId: string }>>;
      };
      const turns = await restartedSink.listConversationTurns(stationRunId);
      expect(turns.length).toBeGreaterThanOrEqual(1);
      expect(await context.db.collection("review_packets").findOne({ stationRunId })).not.toBeNull();

      await first.boot.close();
      await second.boot.close();
    },
    60_000,
  );

  it("defaults to in-memory persistence when OPENCLINXR_PERSISTENCE is not mongodb", async () => {
    const boot = await bootApiPersistence({ OPENCLINXR_PERSISTENCE: "memory" });
    expect(boot.mode).toBe("memory");
    expect(boot.persistence).toBeUndefined();
    await boot.close();
  });

  it(
    "falls back to memory gracefully when Mongo is unreachable",
    async () => {
      const boot = await bootApiPersistence({
        OPENCLINXR_PERSISTENCE: "mongodb",
        MONGODB_URI: "mongodb://127.0.0.1:1/x?serverSelectionTimeoutMS=300&connectTimeoutMS=300",
      });
      expect(boot.mode).toBe("memory");
      expect(typeof boot.fallbackReason).toBe("string");
      await boot.close();
    },
    20_000,
  );
});
