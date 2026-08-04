/**
 * Composition root: env-selected API persistence boot (memory | mongodb).
 *
 * Wires the existing `createMongoApiPersistenceSink` into `createOpenClinXrApiStartup`
 * via injected `options.persistence`. apps/api stays persistence-agnostic.
 *
 * claimScope: durable boot wiring only — NOT evidence for clinical_validity,
 * exam_equivalence, scoring, or learner_readiness.
 */
// MongoClient via data-mongodb re-export: bare `mongodb` is not resolvable from tools/ under pnpm.
import {
  MongoClient,
  createMongoApiPersistenceSink,
} from "../../packages/openclinxr/data-mongodb/src/index.js";
import {
  createOpenClinXrApiStartup,
  type ApiPersistenceSink,
  type OpenClinXrApiStartupOptions,
  type StartedOpenClinXrApi,
} from "../../apps/api/src/index.js";

export const apiMongoBootClaimScope = {
  notEvidenceFor: [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ] as const,
};

export type ApiPersistenceMode = "memory" | "mongodb";

export type ApiMongoBootEnv = {
  OPENCLINXR_PERSISTENCE?: string;
  MONGODB_URI?: string;
  OPENCLINXR_MONGODB_DB?: string;
};

export type BootedApiPersistence = {
  mode: ApiPersistenceMode;
  /** undefined => caller lets createOpenClinXrApiStartup apply its default in-memory sink */
  persistence?: ApiPersistenceSink;
  mongoUri?: string;
  /** set when mongodb was requested but we fell back to memory */
  fallbackReason?: string;
  /** closes MongoClient if opened; noop for memory */
  close: () => Promise<void>;
};

/**
 * Select and open API persistence from env. Never throws — falls back to memory.
 */
export async function bootApiPersistence(
  env: ApiMongoBootEnv = process.env as ApiMongoBootEnv,
): Promise<BootedApiPersistence> {
  if (env.OPENCLINXR_PERSISTENCE !== "mongodb") {
    return { mode: "memory", close: async () => {} };
  }

  const uri = env.MONGODB_URI;
  if (!uri) {
    return {
      mode: "memory",
      fallbackReason: "mongodb_selected_but_MONGODB_URI_missing",
      close: async () => {},
    };
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(env.OPENCLINXR_MONGODB_DB ?? "openclinxr");
    const sink = createMongoApiPersistenceSink(db);
    await sink.ensureIndexes();
    // MongoApiPersistenceSink is structurally compatible with ApiPersistenceSink methods used at boot;
    // cast covers snapshot/queue param type aliases that differ by package without widening the sink.
    const persistence = sink as unknown as ApiPersistenceSink;
    return {
      mode: "mongodb",
      persistence,
      mongoUri: uri,
      close: async () => {
        await client.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    return {
      mode: "memory",
      fallbackReason: `mongodb_connect_failed:${message}`,
      close: async () => {},
    };
  }
}

/**
 * Boot persistence (if selected) and start the API with injected sink.
 */
export async function createBootedOpenClinXrApiStartup(
  env: ApiMongoBootEnv = process.env as ApiMongoBootEnv,
  extraOptions: Omit<OpenClinXrApiStartupOptions, "persistence"> = {},
): Promise<{ startup: StartedOpenClinXrApi; boot: BootedApiPersistence }> {
  const boot = await bootApiPersistence(env);
  const startup = createOpenClinXrApiStartup({
    ...extraOptions,
    ...(boot.persistence ? { persistence: boot.persistence } : {}),
  }).startUp();
  return { startup, boot };
}
