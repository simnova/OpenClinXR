import type {
  CapabilityTransport,
  ImplementationLanguage,
  ProviderKind,
  RuntimeProfile,
} from "./index.js";

export type AssetGenerationCapabilityId =
  | "character-generation"
  | "medical-equipment-generation"
  | "asset-bake";

export type AssetGenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type AssetGenerationArtifactKind = "manifest" | "source" | "mesh" | "texture" | "preview" | "log";

export type AssetGenerationArtifact = {
  kind: AssetGenerationArtifactKind;
  path: string;
  mediaType: string;
};

export type AssetGenerationManifest = {
  schemaVersion: "asset-generation-manifest.v1";
  capabilityId: AssetGenerationCapabilityId;
  outputs?: string[];
  [key: string]: unknown;
};

export type AssetGenerationProvenance = {
  generator?: string;
  license: string;
  spendCents: number;
  externalNetworkUsed: boolean;
  [key: string]: unknown;
};

export type AssetGenerationRuntimePolicy = {
  providerKind: ProviderKind;
  implementationLanguage: ImplementationLanguage;
  transport: CapabilityTransport;
  executable?: string;
  args?: string[];
  environment?: Record<string, string>;
};

export type AssetGenerationJobPolicy = {
  timeoutMs: number;
  sandboxWorkdir: string;
  requireArtifactManifest: boolean;
  requireLicenseProvenance: boolean;
  allowExternalNetwork: boolean;
  spendLimitCents: number;
  runtime: AssetGenerationRuntimePolicy;
};

export type AssetGenerationJobPolicyInput = Partial<Omit<AssetGenerationJobPolicy, "runtime">> & {
  runtime?: Partial<AssetGenerationRuntimePolicy>;
};

export type AssetGenerationJobRequest<TPayload = unknown> = {
  profile: RuntimeProfile;
  capabilityId: AssetGenerationCapabilityId;
  payload: TPayload;
  policy?: AssetGenerationJobPolicyInput;
};

export type AssetGenerationJobHistoryEvent = {
  status: AssetGenerationJobStatus;
  at: string;
  message?: string;
};

export type AssetGenerationWorkerDescriptor = {
  providerId: string;
  providerKind: ProviderKind;
  implementationLanguage: ImplementationLanguage;
  transport: CapabilityTransport;
};

export type AssetGenerationJobError = {
  message: string;
};

export type AssetGenerationJobRecord<TPayload = unknown> = {
  id: string;
  request: AssetGenerationJobRequest<TPayload>;
  status: AssetGenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  policy: AssetGenerationJobPolicy;
  worker: AssetGenerationWorkerDescriptor;
  artifacts: AssetGenerationArtifact[];
  manifest?: AssetGenerationManifest;
  provenance?: AssetGenerationProvenance;
  error?: AssetGenerationJobError;
  history: AssetGenerationJobHistoryEvent[];
};

export type AssetGenerationWorkerResult = {
  artifacts: AssetGenerationArtifact[];
  manifest: AssetGenerationManifest;
  provenance: AssetGenerationProvenance;
};

export type CommandRunnerInvocation = {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
  input?: string;
};

export type CommandRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface CommandRunner {
  run(invocation: CommandRunnerInvocation): Promise<CommandRunnerResult>;
}

export type AssetGenerationWorkerContext = {
  jobId: string;
  commandRunner: CommandRunner;
};

export interface AssetGenerationWorkerAdapter {
  readonly capabilityId: AssetGenerationCapabilityId;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly implementationLanguage: ImplementationLanguage;
  readonly transport: CapabilityTransport;
  run(
    request: AssetGenerationJobRequest,
    policy: AssetGenerationJobPolicy,
    context: AssetGenerationWorkerContext,
  ): Promise<AssetGenerationWorkerResult>;
}

export interface AssetGenerationJobStore {
  save<TPayload>(record: AssetGenerationJobRecord<TPayload>): Promise<AssetGenerationJobRecord<TPayload>>;
  get(id: string): Promise<AssetGenerationJobRecord | undefined>;
  list(): Promise<AssetGenerationJobRecord[]>;
}

export type AssetGenerationCapabilityFacadeOptions = {
  adapters?: AssetGenerationWorkerAdapter[];
  store?: AssetGenerationJobStore;
  commandRunner?: CommandRunner;
  idFactory?: () => string;
  now?: () => string;
};

const defaultSandboxWorkdir = ".openclinxr/asset-generation";
const defaultTimeoutMs = 120_000;

const defaultRuntime: AssetGenerationRuntimePolicy = {
  providerKind: "deterministic-mock",
  implementationLanguage: "typescript",
  transport: "in-process",
};

export class InMemoryAssetGenerationJobStore implements AssetGenerationJobStore {
  private readonly records = new Map<string, AssetGenerationJobRecord>();

  async save<TPayload>(record: AssetGenerationJobRecord<TPayload>): Promise<AssetGenerationJobRecord<TPayload>> {
    this.records.set(record.id, record as AssetGenerationJobRecord);
    return record;
  }

  async get(id: string): Promise<AssetGenerationJobRecord | undefined> {
    return this.records.get(id);
  }

  async list(): Promise<AssetGenerationJobRecord[]> {
    return [...this.records.values()];
  }
}

export class AssetGenerationCapabilityFacade {
  private readonly adapters: AssetGenerationWorkerAdapter[];
  private readonly store: AssetGenerationJobStore;
  private readonly commandRunner: CommandRunner;
  private readonly idFactory: () => string;
  private readonly now: () => string;

  constructor(options: AssetGenerationCapabilityFacadeOptions = {}) {
    this.adapters = options.adapters ?? [
      createDeterministicAssetGenerationAdapter("character-generation"),
      createDeterministicAssetGenerationAdapter("medical-equipment-generation"),
      createDeterministicAssetGenerationAdapter("asset-bake"),
    ];
    this.store = options.store ?? new InMemoryAssetGenerationJobStore();
    this.commandRunner = options.commandRunner ?? noNativeWorkerCommandRunner;
    this.idFactory = options.idFactory ?? createDefaultId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async submit<TPayload>(
    request: AssetGenerationJobRequest<TPayload>,
  ): Promise<AssetGenerationJobRecord<TPayload>> {
    const adapter = this.adapterFor(request.capabilityId);
    const policy = normalizePolicy(request.policy, adapter);
    validatePolicy(policy);
    const id = this.idFactory();
    const createdAt = this.now();
    let record: AssetGenerationJobRecord<TPayload> = {
      id,
      request,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      policy,
      worker: describeAdapter(adapter),
      artifacts: [],
      history: [{ status: "queued", at: createdAt }],
    };
    await this.store.save(record);

    const startedAt = this.now();
    record = {
      ...record,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      history: [...record.history, { status: "running", at: startedAt }],
    };
    await this.store.save(record);

    try {
      const result = await adapter.run(request, policy, {
        jobId: id,
        commandRunner: this.commandRunner,
      });
      validateWorkerResult(result, policy);
      const completedAt = this.now();
      record = {
        ...record,
        status: "succeeded",
        updatedAt: completedAt,
        completedAt,
        artifacts: result.artifacts,
        manifest: result.manifest,
        provenance: result.provenance,
        history: [...record.history, { status: "succeeded", at: completedAt }],
      };
      await this.store.save(record);
      return record;
    } catch (error) {
      const completedAt = this.now();
      record = {
        ...record,
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        error: { message: errorMessage(error) },
        history: [...record.history, { status: "failed", at: completedAt, message: errorMessage(error) }],
      };
      await this.store.save(record);
      return record;
    }
  }

  async get(id: string): Promise<AssetGenerationJobRecord | undefined> {
    return this.store.get(id);
  }

  async list(): Promise<AssetGenerationJobRecord[]> {
    return this.store.list();
  }

  private adapterFor(capabilityId: AssetGenerationCapabilityId): AssetGenerationWorkerAdapter {
    const adapter = this.adapters.find((candidate) => candidate.capabilityId === capabilityId);
    if (!adapter) {
      throw new Error(`No asset generation adapter configured for ${capabilityId}`);
    }
    return adapter;
  }
}

export function createDeterministicAssetGenerationAdapter(
  capabilityId: AssetGenerationCapabilityId,
): AssetGenerationWorkerAdapter {
  return {
    capabilityId,
    providerId: `deterministic-${capabilityId}`,
    providerKind: "deterministic-mock",
    implementationLanguage: "typescript",
    transport: "in-process",
    async run(_request, policy, context) {
      const basePath = `${policy.sandboxWorkdir}/${context.jobId}`;
      return {
        artifacts: [
          {
            kind: "manifest",
            path: `${basePath}/${capabilityId}-manifest.json`,
            mediaType: "application/json",
          },
          {
            kind: "source",
            path: `${basePath}/${capabilityId}-source.asset.json`,
            mediaType: "application/json",
          },
        ],
        manifest: {
          schemaVersion: "asset-generation-manifest.v1",
          capabilityId,
          outputs: [
            `${capabilityId}-manifest.json`,
            `${capabilityId}-source.asset.json`,
          ],
        },
        provenance: {
          generator: `deterministic-${capabilityId}`,
          license: "openclinxr-deterministic-test-fixture",
          spendCents: 0,
          externalNetworkUsed: false,
        },
      };
    },
  };
}

function normalizePolicy(
  policy: AssetGenerationJobPolicyInput | undefined,
  adapter: AssetGenerationWorkerAdapter,
): AssetGenerationJobPolicy {
  const runtime: AssetGenerationRuntimePolicy = {
    providerKind: policy?.runtime?.providerKind ?? adapter.providerKind ?? defaultRuntime.providerKind,
    implementationLanguage: policy?.runtime?.implementationLanguage
      ?? adapter.implementationLanguage
      ?? defaultRuntime.implementationLanguage,
    transport: policy?.runtime?.transport ?? adapter.transport ?? defaultRuntime.transport,
    ...(policy?.runtime?.executable ? { executable: policy.runtime.executable } : {}),
    ...(policy?.runtime?.args ? { args: policy.runtime.args } : {}),
    ...(policy?.runtime?.environment ? { environment: policy.runtime.environment } : {}),
  };

  return {
    timeoutMs: policy?.timeoutMs ?? defaultTimeoutMs,
    sandboxWorkdir: policy?.sandboxWorkdir ?? defaultSandboxWorkdir,
    requireArtifactManifest: policy?.requireArtifactManifest ?? true,
    requireLicenseProvenance: policy?.requireLicenseProvenance ?? true,
    allowExternalNetwork: policy?.allowExternalNetwork ?? false,
    spendLimitCents: policy?.spendLimitCents ?? 0,
    runtime,
  };
}

function validatePolicy(policy: AssetGenerationJobPolicy): void {
  if (policy.timeoutMs <= 0) {
    throw new Error("Asset generation jobs require a positive timeout");
  }
  if (policy.sandboxWorkdir.trim().length === 0) {
    throw new Error("Asset generation jobs require a sandbox workdir");
  }
  if (policy.allowExternalNetwork) {
    throw new Error("Asset generation jobs must disable external network access");
  }
  if (policy.spendLimitCents !== 0) {
    throw new Error("Asset generation jobs must be configured for zero spend");
  }
  if (policy.runtime.providerKind === "paid-cloud-provider") {
    throw new Error("Asset generation runtime swaps cannot use paid cloud providers");
  }
  if (policy.runtime.transport === "outbound-provider-api") {
    throw new Error("Asset generation runtime swaps cannot call outbound provider APIs");
  }
}

function validateWorkerResult(
  result: AssetGenerationWorkerResult,
  policy: AssetGenerationJobPolicy,
): void {
  if (policy.requireArtifactManifest && !result.manifest) {
    throw new Error("Asset generation worker did not return a manifest");
  }
  if (policy.requireLicenseProvenance && !result.provenance?.license) {
    throw new Error("Asset generation worker did not return license provenance");
  }
  if (result.provenance.externalNetworkUsed) {
    throw new Error("Asset generation worker reported external network use");
  }
  if (result.provenance.spendCents !== 0) {
    throw new Error("Asset generation worker reported non-zero spend");
  }
}

function describeAdapter(adapter: AssetGenerationWorkerAdapter): AssetGenerationWorkerDescriptor {
  return {
    providerId: adapter.providerId,
    providerKind: adapter.providerKind,
    implementationLanguage: adapter.implementationLanguage,
    transport: adapter.transport,
  };
}

function createDefaultId(): string {
  return `asset-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const noNativeWorkerCommandRunner: CommandRunner = {
  async run() {
    throw new Error("No command runner configured for native asset generation worker");
  },
};
