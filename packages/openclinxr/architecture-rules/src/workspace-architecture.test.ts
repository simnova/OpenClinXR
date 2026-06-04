import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { buildOpenClinXrCapabilityRoutingMatrix, evaluateCapabilityRoutingMatrix } from "@openclinxr/capability-gateway";
import { findUnsafeClaimLanguage } from "@openclinxr/domain";
import { projectFiles } from "archunit";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const archTsconfig = "../../../tsconfig.archunit.json";
const workspaceRoot = findWorkspaceRoot();
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const paidCloudProviderDependencies = [
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/groq",
  "@ai-sdk/openai",
  "@ai-sdk/xai",
  "@anthropic-ai/sdk",
  "@aws-sdk/client-bedrock-runtime",
  "@azure/openai",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
  "groq-sdk",
  "mistralai",
  "openai",
  "xai-sdk",
] as const;
const paidCloudProviderEnvKeys = [
  "ANTHROPIC_API_KEY",
  "AWS_BEDROCK_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "COHERE_API_KEY",
  "GOOGLE_API_KEY",
  "GROK_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
] as const;
const apiConcretePersistenceDependencies = [
  "@openclinxr/data-mongodb",
  "@openclinxr/data-sources-mongoose-models",
] as const;
const productionAppRoots = ["apps/api/", "apps/ui-admin/", "apps/ui-xr/"] as const;
const capabilityArenaAppRoots = [
  "apps/arena/api-python-backend/",
  "apps/arena/mock-realtime-voice-server/",
  "apps/arena/ui-quest-voice-godot/",
  "apps/arena/ui-xr-iwsdk-spike/",
] as const;
const packageBackedCapabilityArenaAppRoots = [
  "apps/arena/api-python-backend/",
  "apps/arena/mock-realtime-voice-server/",
  "apps/arena/ui-xr-iwsdk-spike/",
] as const;
const capabilityArenaPackageRoots = [
  "packages/openclinxr/arena/iwsdk-spike/",
  "packages/openclinxr/arena/multi-actor-state-spike/",
] as const;
const capabilityArenaPackages = [
  "@openclinxr/iwsdk-spike",
  "@openclinxr/multi-actor-state-spike",
] as const;
const nonProductionSupportPackages = [
  "@openclinxr/test-harness",
] as const;
const forbiddenProductionAppDependencies = [
  ...capabilityArenaPackages,
  ...nonProductionSupportPackages,
] as const;

type DependencyField = typeof dependencyFields[number];

type WorkspaceDependencyReference = {
  manifestPath: string;
  field: DependencyField;
  dependency: string;
};

type SourceImportReference = {
  filePath: string;
  specifier: string;
};

type SourceTextReference = {
  filePath: string;
  sourceText: string;
};

type MongoMemoryServerBoundaryInput = {
  manifestDependencies: WorkspaceDependencyReference[];
  sourceReferences: SourceImportReference[];
};

type DataMongoMongooseBoundaryInput = {
  manifestDependencies: WorkspaceDependencyReference[];
  sourceReferences: SourceImportReference[];
};

type PaidProviderBoundaryInput = {
  manifestDependencies: WorkspaceDependencyReference[];
  sourceReferences: SourceImportReference[];
  envKeyReferences: Array<{ filePath: string; envKey: string }>;
};

describe("workspace architecture rules", () => {
  it("keeps root package quality gates delegated through Turborepo package tasks", () => {
    const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const packageScriptNames = [
      "packages:typecheck",
      "packages:test",
      "packages:build",
      "packages:typecheck:affected",
      "packages:test:affected",
      "packages:build:affected",
    ];

    expect(rootPackage.scripts?.["packages:typecheck"]).toContain("turbo run typecheck");
    expect(rootPackage.scripts?.["packages:test"]).toContain("turbo run test");
    expect(rootPackage.scripts?.["packages:build"]).toContain("turbo run build");
    expect(rootPackage.scripts?.["packages:typecheck:affected"]).toContain("turbo run typecheck --affected");
    expect(rootPackage.scripts?.["packages:test:affected"]).toContain("turbo run test --affected");
    expect(rootPackage.scripts?.["packages:build:affected"]).toContain("turbo run build --affected");
    expect(rootPackage.scripts?.["architecture"]).toContain("turbo run architecture");
    expect(rootPackage.scripts?.["architecture"]).toContain("--filter '@openclinxr/architecture-rules'");
    for (const scriptName of packageScriptNames) {
      expect(rootPackage.scripts?.[scriptName]).toContain("TURBO_TELEMETRY_DISABLED=1");
      expect(rootPackage.scripts?.[scriptName]).toContain("DO_NOT_TRACK=1");
      expect(rootPackage.scripts?.[scriptName]).not.toMatch(/\bturbo\s+(?!run\b)(?:build|test|typecheck|dev)\b/);
    }
    expect(rootPackage.scripts?.["architecture"]).toContain("TURBO_TELEMETRY_DISABLED=1");
    expect(rootPackage.scripts?.["architecture"]).toContain("DO_NOT_TRACK=1");
    expect(rootPackage.scripts?.["architecture"]).not.toMatch(/\bturbo\s+(?!run\b)architecture\b/);
    expect(rootPackage.scripts?.["typecheck"]).toContain("pnpm packages:typecheck");
    expect(rootPackage.scripts?.["test"]).toContain("pnpm packages:test");
    expect(rootPackage.scripts?.["typecheck"]).not.toContain("pnpm -r");
    expect(rootPackage.scripts?.["test"]).not.toContain("pnpm -r");
  });

  it("keeps Git hooks routed through the agent-friendly OpenClaw hook runner", () => {
    const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const preCommitHook = readFileSync(join(workspaceRoot, ".githooks/pre-commit"), "utf8");
    const prePushHook = readFileSync(join(workspaceRoot, ".githooks/pre-push"), "utf8");

    expect(rootPackage.scripts?.["hooks:pre-commit"]).toBe("tsx tools/openclinxr/openclaw/agentic-hook-runner.ts --profile pre-commit");
    expect(rootPackage.scripts?.["hooks:pre-push"]).toBe("tsx tools/openclinxr/openclaw/agentic-hook-runner.ts --profile pre-push");
    expect(rootPackage.scripts?.["hooks:strict"]).toBe("tsx tools/openclinxr/openclaw/agentic-hook-runner.ts --profile strict");
    expect(rootPackage.scripts?.["hooks:local-exam"]).toBe("tsx tools/openclinxr/openclaw/agentic-hook-runner.ts --profile local-exam");
    expect(rootPackage.scripts?.["local:exam:smoke"]).toContain("@openclinxr/test-harness");
    expect(rootPackage.scripts?.["local:exam:smoke"]).toContain("station-simulation.test.ts");
    expect(preCommitHook).toContain("pnpm hooks:pre-commit");
    expect(prePushHook).toContain("pnpm hooks:pre-push");
  });

  it("keeps the asset-registry browser barrel free of Node-only object-store runtime exports", () => {
    const barrel = readFileSync(join(workspaceRoot, "packages/openclinxr/asset-registry/src/index.ts"), "utf8");
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, "packages/openclinxr/asset-registry/package.json"), "utf8")) as {
      exports?: Record<string, string>;
    };

    expect(barrel).not.toContain('export * from "./object-store.js"');
    expect(barrel).toContain("export type {");
    expect(barrel).toContain('} from "./object-store.js"');
    expect(manifest.exports?.["./object-store"]).toBe("./src/object-store.ts");
    expect(manifest.exports?.["./asset-writer"]).toBe("./src/asset-writer.ts");
  });

  it("exposes IWSDK spike verification as an explicit opt-in lane outside the default verify gate", () => {
    const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/iwsdk-spike typecheck");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/iwsdk-spike test");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:contract:tests");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:preinstall");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:workspace:posture");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:evidence:validate");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/architecture-rules typecheck");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/architecture-rules test");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm agent:sources");
    expect(rootPackage.scripts?.["verify"]).not.toContain("iwsdk:verify");
  });

  it("keeps pnpm audit and license governance in the default verification gate", () => {
    const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["security:audit"]).toBe("pnpm audit --audit-level=high");
    expect(rootPackage.scripts?.["security:audit:prod"]).toBe("pnpm audit --prod --audit-level=high");
    expect(rootPackage.scripts?.["security:audit:dev"]).toBe("pnpm audit --dev --audit-level=high");
    expect(rootPackage.scripts?.["security:audit-policy"]).toBe(
      "tsx tools/openclinxr/evidence/check-security-audit-policy.ts",
    );
    expect(rootPackage.scripts?.["security:licenses"]).toBe("tsx tools/openclinxr/evidence/check-license-policy.ts");
    expect(rootPackage.scripts?.["verify"]).toContain("pnpm security:audit && pnpm security:audit-policy && pnpm security:licenses");
    expect(rootPackage.scripts?.["security:audit"]).not.toMatch(/\becho\b|\|\|\s*true|--ignore|--audit-level\s*=\s*moderate/);
  });

  it("keeps the implementation plan explicit about the IWSDK sidecar policy", () => {
    const implementationPlan = readFileSync(join(workspaceRoot, "docs/openclinxr/code-implementation-plan.md"), "utf8");

    expect(implementationPlan).toContain("IWSDK Sidecar Policy");
    expect(implementationPlan).toContain("apps/arena/ui-xr-iwsdk-spike");
    expect(implementationPlan).toContain("pnpm iwsdk:verify");
    expect(implementationPlan).toContain("@iwsdk/core");
    expect(implementationPlan).toContain("@iwsdk/xr-input");
    expect(implementationPlan).toContain("@iwsdk/reference");
    expect(implementationPlan).toContain("@meta-quest/hzdb");
    expect(implementationPlan).toContain("apps/ui-xr");
  });

  it("keeps Python and native executable capability workers behind the main API facade", () => {
    const matrix = buildOpenClinXrCapabilityRoutingMatrix();
    const readiness = evaluateCapabilityRoutingMatrix(matrix);
    const executableBindings = matrix.bindings.filter((binding) => binding.executableDependencies.length > 0);
    const productionAssetPipelineBindings = matrix.bindings.filter((binding) =>
      binding.profile === "production" && binding.plane === "asset-pipeline"
    );
    const productionExecutableAssetPipelineBindings = productionAssetPipelineBindings.filter((binding) =>
      ["python-worker", "native-executable-worker"].includes(binding.providerKind)
    );
    const productionInteractiveBindings = matrix.bindings.filter((binding) =>
      binding.profile === "production" && binding.plane === "interactive-runtime"
    );

    expect(readiness.blockers).toEqual([]);
    expect(executableBindings.length).toBeGreaterThan(0);
    expect(executableBindings.every((binding) => binding.networkExposure !== "direct-public")).toBe(true);
    expect(executableBindings.every((binding) =>
      binding.transport === "local-executable-worker" || binding.endpointPath?.startsWith("/internal/capabilities/")
    )).toBe(true);
    expect(executableBindings.every((binding) =>
      ["main-api-tunnel", "internal-sidecar-http", "local-executable-worker"].includes(binding.transport)
    )).toBe(true);
    expect([...new Set(productionExecutableAssetPipelineBindings.map((binding) => binding.capabilityId))]).toEqual([
      "character-generation",
      "voice-asset-generation",
      "medical-equipment-generation",
      "animation-generation",
      "asset-bake",
    ]);
    expect(productionExecutableAssetPipelineBindings.every((binding) =>
      binding.facadePackage === "@openclinxr/capability-gateway"
    )).toBe(true);
    expect(productionInteractiveBindings.map((binding) => binding.facadePackage)).toEqual([
      "@openclinxr/model-gateway",
      "@openclinxr/model-gateway",
      "@openclinxr/voice-gateway",
      "@openclinxr/voice-gateway",
    ]);
  });

  it("keeps Turborepo cache artifacts out of tracked workspace files", () => {
    const violations = trackedWorkspaceFiles()
      .filter((filePath) => filePath.includes("/.turbo/") || filePath.startsWith(".turbo/"));

    expect(violations).toEqual([]);
  });

  it("keeps generated local runtime artifacts out of tracked workspace files", () => {
    expect(trackedLocalArtifactViolations()).toEqual([]);
  });

  it("keeps the API deploy bundle on the smoke-tested tsdown path with a Rolldown fallback", () => {
    const apiPackage = JSON.parse(readFileSync(join(workspaceRoot, "apps/api/package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsdownConfig = readFileSync(join(workspaceRoot, "apps/api/tsdown.config.ts"), "utf8");

    expect(apiPackage.scripts?.["build"]).toBe("pnpm run package:azure");
    expect(apiPackage.scripts?.["build:azure"]).toContain("tsdown -c tsdown.config.ts");
    expect(apiPackage.scripts?.["build:azure:rolldown"]).toContain("rolldown -c rolldown.config.ts");
    expect(apiPackage.scripts?.["smoke:azure"]).toContain("pnpm run package:azure");
    expect(apiPackage.devDependencies?.["tsdown"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(tsdownConfig).toContain("onlyBundle");
    expect(tsdownConfig).toContain("neverBundle: [\"@azure/functions-core\"]");
    expect(tsdownConfig).toContain("alwaysBundle: [/^@openclinxr\\//, \"hono\", \"graphql\"]");
  });

  it("keeps the API runtime posture Bun and Hono primary with an explicit Node fallback", () => {
    const apiPackage = JSON.parse(readFileSync(join(workspaceRoot, "apps/api/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const protocolSupport = readFileSync(join(workspaceRoot, "apps/api/src/protocol-support.ts"), "utf8");
    const bunServer = readFileSync(join(workspaceRoot, "apps/api/src/bun-server.ts"), "utf8");
    const nodeServer = readFileSync(join(workspaceRoot, "apps/api/src/server.ts"), "utf8");

    expect(apiPackage.dependencies?.["hono"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(apiPackage.dependencies?.["@hono/node-server"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(apiPackage.scripts?.["dev"]).toBe("tsx src/server.ts");
    expect(apiPackage.scripts?.["dev:node"]).toBe("tsx src/server.ts");
    expect(apiPackage.scripts?.["dev:bun"]).toBe("bun src/bun-server.ts");
    expect(protocolSupport).toContain('primaryRuntimeTarget: "bun-hono"');
    expect(protocolSupport).toContain('localFallbackRuntimeTarget: "node-hono"');
    expect(protocolSupport).toContain('azureRuntimeTarget: "azure-functions-node"');
    expect(bunServer).toContain("globalThis as { Bun?: BunRuntime }");
    expect(bunServer).toContain("bun.serve");
    expect(bunServer).toContain("pnpm --filter @openclinxr/api dev:node");
    expect(nodeServer).toContain('@hono/node-server');
  });

  it("keeps WebTransport, QUIC, and Web3 signaling evidence-gated behind protocol posture", () => {
    const protocolSupport = readFileSync(join(workspaceRoot, "apps/api/src/protocol-support.ts"), "utf8");
    const speculativeProtocolDependencies = [
      "@fails-components/webtransport",
      "@walletconnect/modal",
      "@walletconnect/sign-client",
      "@web3modal/wagmi",
      "@solana/web3.js",
      "webtransport",
      "webtransport-polyfill",
      "quic",
      "aioquic",
      "ethers",
      "siwe",
      "viem",
      "wagmi",
      "web3",
    ];
    const dependencyViolations = workspacePackageDependencyFindings(speculativeProtocolDependencies);
    const sourceViolations = speculativeProtocolDependencies.flatMap((dependency) =>
      sourceImportReferences(dependency, [...sourceFilesUnder("apps/api"), ...sourceFilesUnder("apps/arena/mock-realtime-voice-server")])
        .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`)
    );

    expect(protocolSupport).toContain('protocolId: "webtransport"');
    expect(protocolSupport).toContain("OpenClinXrApiProtocolClaimScope");
    expect(protocolSupport).toContain('claimScope: webTransportReady ? "runtime_ready" : "evidence_gated_future_lane"');
    expect(protocolSupport).toContain("input.bunHttp3WebTransportVerified");
    expect(protocolSupport).toContain("input.questWebTransportVerified");
    expect(protocolSupport).toContain("input.azureWebTransportIngressVerified");
    expect(protocolSupport).toContain("bun_http3_webtransport_not_verified");
    expect(protocolSupport).toContain("quest_webtransport_path_not_verified");
    expect(protocolSupport).toContain("azureWebTransportIngressVerified");
    expect(protocolSupport).toContain("azure_webtransport_ingress_not_verified");
    expect(protocolSupport).toContain('protocolId: "quic"');
    expect(protocolSupport).toContain('claimScope: quicReady ? "runtime_ready" : "evidence_gated_future_lane"');
    expect(protocolSupport).toContain("operator_quic_gateway_proposal_missing");
    expect(protocolSupport).toContain("quic_gateway_not_implemented");
    expect(protocolSupport).toContain("azure_quic_ingress_not_verified");
    expect(protocolSupport).toContain('protocolId: "web3-signaling"');
    expect(protocolSupport).toContain('claimScope: "identity_signaling_audit_only"');
    expect(protocolSupport).toContain("operator_web3_signaling_proposal_missing");
    expect(protocolSupport).toContain("web3_identity_and_signaling_protocol_not_selected");
    expect(protocolSupport).toContain("web3 support stays scoped to identity/signaling");
    expect([...dependencyViolations, ...sourceViolations]).toEqual([]);
  });

  it("keeps the realtime Python backend as an internal opt-in sidecar instead of a public app surface", () => {
    const backendPackage = JSON.parse(readFileSync(join(workspaceRoot, "apps/arena/api-python-backend/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      private?: boolean;
      scripts?: Record<string, string>;
    };
    const backendSource = readFileSync(join(workspaceRoot, "apps/arena/api-python-backend/src/api_python_backend/main.py"), "utf8");
    const pyproject = readFileSync(join(workspaceRoot, "apps/arena/api-python-backend/pyproject.toml"), "utf8");
    const publicRestRoutes = readFileSync(join(workspaceRoot, "packages/openclinxr/rest/src/index.ts"), "utf8");
    const uiBackendReferences = filesWithContentMatching("apps", /api-python-backend|uvicorn|FastAPI/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(backendPackage.private).toBe(true);
    expect(backendPackage.dependencies).toBeUndefined();
    expect(backendPackage.devDependencies).toBeUndefined();
    expect(Object.keys(backendPackage.scripts ?? {}).sort()).toEqual([
      "dev",
      "test",
      "typecheck",
      "voice:evidence",
      "voice:install-local",
    ]);
    expect(backendPackage.scripts?.["dev"]).toContain("uvicorn api_python_backend.main:app");
    expect(backendPackage.scripts?.["test"]).toBe("python3 scripts/verify_backend.py");
    expect(backendPackage.scripts?.["typecheck"]).toBe("python3 scripts/verify_backend.py");
    expect(backendPackage.scripts?.["voice:evidence"]).toBe("python3 scripts/check_local_voice_evidence.py");
    expect(backendPackage.scripts?.["voice:install-local"]).toBe("python3 scripts/install_local_voice_models.py");
    expect(backendSource).toContain('@app.get("/health")');
    expect(backendSource).toContain('@app.websocket("/voice/realtime/ws")');
    expect(pyproject).toContain("fastapi>=");
    expect(pyproject).toContain("uvicorn[standard]>=");
    expect(pyproject).toContain("websockets>=");
    expect(pyproject).toContain("mlx-moshi-qwen-notes = []");
    expect(pyproject).not.toMatch(/^\s*"(?:mlx|moshi|qwen)[^"]*>=/im);
    expect(publicRestRoutes).not.toContain("/voice/realtime/ws");
    expect(uiBackendReferences).toEqual([]);
  });

  it("keeps realtime transport harness dependencies out of the production API manifest", () => {
    const apiPackage = JSON.parse(readFileSync(join(workspaceRoot, "apps/api/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const mockPackage = JSON.parse(readFileSync(join(workspaceRoot, "apps/arena/mock-realtime-voice-server/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const apiSourceViolations = sourceImportReferences("ws", sourceFilesUnder("apps/api")).map(({ filePath, specifier }) =>
      `${filePath}:${specifier}`
    );

    expect({ ...apiPackage.dependencies, ...apiPackage.devDependencies }).not.toHaveProperty("ws");
    expect(mockPackage.dependencies).toMatchObject({
      hono: apiPackage.dependencies?.["hono"],
      ws: "8.20.1",
    });
    expect(apiSourceViolations).toEqual([]);
  });

  it("keeps the Quest Godot voice client as a dependency-free sidecar until headset codec evidence exists", () => {
    const godotRoot = join(workspaceRoot, "apps/arena/ui-quest-voice-godot");
    const project = readFileSync(join(godotRoot, "project.godot"), "utf8");
    const client = readFileSync(join(godotRoot, "src/RealtimeVoiceClient.gd"), "utf8");
    const readme = readFileSync(join(godotRoot, "README.md"), "utf8");

    expect(existsSync(godotRoot)).toBe(true);
    expect(existsSync(join(godotRoot, "package.json"))).toBe(false);
    expect(project).toContain('run/main_scene="res://scenes/realtime_voice_spike.tscn"');
    expect(project).toContain('renderer/rendering_method="mobile"');
    expect(client).toContain("WebSocketPeer.new()");
    expect(client).toContain("/voice/realtime/ws");
    expect(client).toContain('const CODEC := "opus"');
    expect(readme).toContain("does not yet prove Quest microphone capture");
    expect(readme).toContain("native Opus encode/decode");
  });

  it("keeps project-specific packages under packages/openclinxr", () => {
    const violations = sourceFilesUnder("packages").filter(
      (filePath) => !filePath.startsWith("packages/openclinxr/") && !filePath.startsWith("packages/cellix/"),
    );

    expect(violations).toEqual([]);
  });

  it("keeps production apps free of capability arena package dependencies", () => {
    const manifestViolations = workspacePackageDependencyReferences([...forbiddenProductionAppDependencies])
      .filter(({ manifestPath }) => productionAppRoots.some((root) => manifestPath.startsWith(root)))
      .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`);
    const sourceViolations = forbiddenProductionAppDependencies.flatMap((dependency) =>
      sourceImportReferences(dependency, productionAppSourceFiles())
        .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`)
    );

    expect([...manifestViolations, ...sourceViolations].sort()).toEqual([]);
  });

  it("keeps production app source out of evidence and sidecar implementation paths", () => {
    const forbiddenPathImports = [
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*tools\/openclinxr\/evidence\//,
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*apps\/arena\/ui-xr-iwsdk-spike\//,
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*apps\/arena\/ui-quest-voice-godot\//,
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*apps\/arena\/api-python-backend\//,
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*apps\/arena\/mock-realtime-voice-server\//,
    ];
    const violations = productionAppSourceFiles().filter((filePath) => {
      const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
      return forbiddenPathImports.some((pattern) => pattern.test(sourceText));
    });

    expect(violations).toEqual([]);
  });

  it("keeps gateway packages independent from UI shells and capability arena packages", () => {
    const gatewaySourceFiles = [
      ...sourceFilesUnder("packages/openclinxr/capability-gateway"),
      ...sourceFilesUnder("packages/openclinxr/model-gateway"),
      ...sourceFilesUnder("packages/openclinxr/voice-gateway"),
    ].filter((filePath) => !filePath.endsWith(".test.ts"));
    const forbiddenDependencies = [
      "@openclinxr/ui-admin",
      "@openclinxr/ui-xr",
      "@openclinxr/ui-shared",
      ...capabilityArenaPackages,
    ];
    const sourceViolations = forbiddenDependencies.flatMap((dependency) =>
      sourceImportReferences(dependency, gatewaySourceFiles)
        .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`)
    );
    const relativeUiViolations = gatewaySourceFiles.filter((filePath) =>
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*(?:apps\/ui-|packages\/openclinxr\/ui-)/.test(
        readFileSync(join(workspaceRoot, filePath), "utf8"),
      )
    );

    expect([...sourceViolations, ...relativeUiViolations].sort()).toEqual([]);
  });

  it("keeps the encounter factory from importing production UI shells", async () => {
    const sourceViolations = factorySourceFiles()
      .filter((filePath) => !filePath.endsWith(".test.ts"))
      .filter((filePath) =>
        /(?:from\s+["']|import\s*\(\s*["'])[^"']*(?:apps\/ui-|@openclinxr\/ui-(?:admin|xr|shared))/.test(
          readFileSync(join(workspaceRoot, filePath), "utf8"),
        )
      );

    expect(factorySourceFiles().length).toBeGreaterThan(0);
    expect(sourceViolations).toEqual([]);
  });

  it("keeps the asset commons package authoritative and independent from apps, gateways, and arena sidecars", () => {
    const assetRegistrySourceFiles = sourceFilesUnder("packages/openclinxr/asset-registry")
      .filter((filePath) => !filePath.endsWith(".test.ts"));
    const forbiddenDependencies = [
      "@openclinxr/api",
      "@openclinxr/capability-gateway",
      "@openclinxr/model-gateway",
      "@openclinxr/voice-gateway",
      "@openclinxr/scenario-runtime",
      ...capabilityArenaPackages,
    ];
    const sourceViolations = forbiddenDependencies.flatMap((dependency) =>
      sourceImportReferences(dependency, assetRegistrySourceFiles)
        .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`)
    );
    const relativeBoundaryViolations = assetRegistrySourceFiles.filter((filePath) =>
      /(?:from\s+["']|import\s*\(\s*["'])[^"']*(?:apps\/|tools\/openclinxr\/(?:factory|evidence|asset-pipeline)\/)/.test(
        readFileSync(join(workspaceRoot, filePath), "utf8"),
      )
    );

    expect([...sourceViolations, ...relativeBoundaryViolations].sort()).toEqual([]);
  });

  it("keeps capability arena apps from being production runtime roots", () => {
    const productionManifestPaths = productionAppRoots.map((root) => `${root}package.json`);
    const arenaAppPaths = capabilityArenaAppRoots.filter((root) => existsSync(join(workspaceRoot, root)));
    const arenaManifestPaths = packageBackedCapabilityArenaAppRoots
      .filter((root) => existsSync(join(workspaceRoot, `${root}package.json`)))
      .map((root) => `${root}package.json`);

    expect(productionManifestPaths.sort()).toEqual([
      "apps/api/package.json",
      "apps/ui-admin/package.json",
      "apps/ui-xr/package.json",
    ]);
    expect(arenaAppPaths.sort()).toEqual([
      "apps/arena/api-python-backend/",
      "apps/arena/mock-realtime-voice-server/",
      "apps/arena/ui-quest-voice-godot/",
      "apps/arena/ui-xr-iwsdk-spike/",
    ]);
    expect(arenaManifestPaths.sort()).toEqual([
      "apps/arena/api-python-backend/package.json",
      "apps/arena/mock-realtime-voice-server/package.json",
      "apps/arena/ui-xr-iwsdk-spike/package.json",
    ]);
  });

  it("keeps capability arena packages under the arena package directory", () => {
    const arenaPackageManifestPaths = capabilityArenaPackageRoots
      .filter((root) => existsSync(join(workspaceRoot, `${root}package.json`)))
      .map((root) => `${root}package.json`);
    const misplacedSpikeManifestPaths = packageManifestFiles()
      .filter((manifestPath) => manifestPath.startsWith("packages/openclinxr/"))
      .filter((manifestPath) => /(?:spike|arena|cage|bakeoff)/.test(manifestPath))
      .filter((manifestPath) => !capabilityArenaPackageRoots.some((root) => manifestPath.startsWith(root)))
      .filter((manifestPath) => !manifestPath.startsWith("packages/openclinxr/architecture-rules/"));

    expect(arenaPackageManifestPaths.sort()).toEqual([
      "packages/openclinxr/arena/iwsdk-spike/package.json",
      "packages/openclinxr/arena/multi-actor-state-spike/package.json",
    ]);
    expect(misplacedSpikeManifestPaths).toEqual([]);
  });

  it("keeps capability arena directories linked to governing MADRs", () => {
    const expectedArenaMadrLinks = [
      {
        readmePath: "apps/arena/README.md",
        decisions: [
          "0017-websocket-first-realtime-transport.md",
          "0019-provider-adapter-model-and-voice-routing.md",
          "0021-local-first-no-cloud-implementation-spikes.md",
          "0022-local-llm-runtime-and-model-tiering.md",
          "0023-vibevoice-as-local-voice-candidate.md",
          "0024-pnpm-node-first-bun-deployment-gate.md",
          "0027-quest3-usb-webxr-smoke-gate.md",
          "0028-iwsdk-sidecar-spike.md",
        ],
      },
      {
        readmePath: "apps/arena/api-python-backend/README.md",
        decisions: [
          "0019-provider-adapter-model-and-voice-routing.md",
          "0021-local-first-no-cloud-implementation-spikes.md",
          "0022-local-llm-runtime-and-model-tiering.md",
          "0023-vibevoice-as-local-voice-candidate.md",
        ],
      },
      {
        readmePath: "apps/arena/mock-realtime-voice-server/README.md",
        decisions: [
          "0017-websocket-first-realtime-transport.md",
          "0019-provider-adapter-model-and-voice-routing.md",
          "0021-local-first-no-cloud-implementation-spikes.md",
          "0024-pnpm-node-first-bun-deployment-gate.md",
        ],
      },
      {
        readmePath: "apps/arena/ui-xr-iwsdk-spike/README.md",
        decisions: [
          "0027-quest3-usb-webxr-smoke-gate.md",
          "0028-iwsdk-sidecar-spike.md",
        ],
      },
      {
        readmePath: "apps/arena/ui-quest-voice-godot/README.md",
        decisions: [
          "0017-websocket-first-realtime-transport.md",
          "0019-provider-adapter-model-and-voice-routing.md",
          "0021-local-first-no-cloud-implementation-spikes.md",
          "0027-quest3-usb-webxr-smoke-gate.md",
        ],
      },
      {
        readmePath: "packages/openclinxr/arena/README.md",
        decisions: [
          "0014-cellixjs-inspired-domain-contexts.md",
          "0018-first-class-communication-style-layer.md",
          "0027-quest3-usb-webxr-smoke-gate.md",
          "0028-iwsdk-sidecar-spike.md",
        ],
      },
      {
        readmePath: "packages/openclinxr/arena/iwsdk-spike/README.md",
        decisions: [
          "0027-quest3-usb-webxr-smoke-gate.md",
          "0028-iwsdk-sidecar-spike.md",
        ],
      },
      {
        readmePath: "packages/openclinxr/arena/multi-actor-state-spike/README.md",
        decisions: [
          "0014-cellixjs-inspired-domain-contexts.md",
          "0018-first-class-communication-style-layer.md",
        ],
      },
    ];
    const madrIndex = readFileSync(join(workspaceRoot, "docs/madr/README.md"), "utf8");

    for (const { readmePath, decisions } of expectedArenaMadrLinks) {
      const readme = readFileSync(join(workspaceRoot, readmePath), "utf8");

      expect(madrIndex).toContain(readmePath);
      for (const decision of decisions) {
        expect(readme).toContain(decision);
        expect(madrIndex).toContain(decision);
      }
    }
    expect(readFileSync(join(workspaceRoot, "README.md"), "utf8")).toContain("docs/madr/README.md");
  });

  it("keeps Cellix package copies free of OpenClinXR product semantics", () => {
    const violations = filesWithContentMatching("packages/cellix", /@openclinxr\/|OpenClinXR|openclinxr/);

    expect(violations).toEqual([]);
  });

  it("requires changelogs for evolved Cellix package copies", () => {
    const cellixPackageDirs = workspacePackageDirs("packages/cellix");
    const missingChangelogs = cellixPackageDirs.filter((packageDir) => !existsSync(join(packageDir, "CHANGELOG.md")));

    expect(missingChangelogs).toEqual([]);
  });

  it("keeps source folders inside approved app naming conventions", () => {
    const violations = sourceFilesUnder("apps").filter(
      (filePath) =>
        !filePath.startsWith("apps/api/src/")
        && !filePath.startsWith("apps/arena/api-python-backend/src/")
        && !/^apps\/arena\/[^/]+\/src\//.test(filePath)
        && !/^apps\/ui-[^/]+\/src\//.test(filePath)
        && !/^apps\/mock-[^/]+-server\/src\//.test(filePath),
    );

    expect(violations).toEqual([]);
  });

  it("prevents UI app shells from importing backend persistence packages", () => {
    const forbiddenImports = /@openclinxr\/(?:data-|data-sources-|trace-ledger|scenario-runtime)/;
    const violations = filesWithContentMatching("apps", forbiddenImports)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI app server, gateway, and persistence imports behind app-local API clients", () => {
    const forbiddenImports = /@openclinxr\/(?:model-gateway|voice-gateway|capability-gateway|scenario-runtime|trace-ledger|data-|data-sources-)/;
    const violations = filesWithContentMatching("apps", forbiddenImports)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath))
      .filter((filePath) => !/\/api-client(?:\.test)?\.ts$/.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI app domain imports on the claim-language subpath", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/domain(?!\/claim-language\b)/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps the domain package independent of runtime, persistence, and UI layers", () => {
    const domainPackage = JSON.parse(readFileSync(join(workspaceRoot, "packages/openclinxr/domain/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const blockedManifestDependencies = [
      "@openclinxr/data-mongodb",
      "@openclinxr/data-sources-mongoose-models",
      "@openclinxr/model-gateway",
      "@openclinxr/voice-gateway",
      "@openclinxr/rest",
      "mongodb",
      "mongoose",
      "react",
      "@types/react",
    ];
    const manifestDependencies = {
      ...domainPackage.dependencies,
      ...domainPackage.optionalDependencies,
      ...domainPackage.peerDependencies,
    };

    expect(Object.keys(manifestDependencies).filter((dependency) => blockedManifestDependencies.includes(dependency))).toEqual([]);
    expect(domainPackage.dependencies).toEqual({
      "@openclinxr/shared-schemas": "workspace:*",
    });

    const forbiddenImports =
      /\bfrom\s+["'](?:@openclinxr\/(?:data-mongodb|data-sources-mongoose-models|model-gateway|voice-gateway|rest)|mongodb|mongoose|react|apps\/)/;
    expect(filesWithContentMatching("packages/openclinxr/domain/src", forbiddenImports)).toEqual([]);
  });

  it("keeps UI REST route catalog usage behind app-local API clients", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/rest/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath))
      .filter((filePath) => !/\/api-client(?:\.test)?\.ts$/.test(filePath));

    expect(violations).toEqual([]);
  });

  it("allows API source to import capability-gateway while keeping UI apps from importing it", () => {
    const apiImportReferences = sourceImportReferences("@openclinxr/capability-gateway", sourceFilesUnder("apps/api"))
      .filter(({ filePath }) => filePath.startsWith("apps/api/src/"));
    const uiViolations = sourceImportReferences("@openclinxr/capability-gateway", sourceFilesUnder("apps"))
      .filter(({ filePath }) => /^apps\/ui-[^/]+\/src\//.test(filePath))
      .map(({ filePath, specifier }) => `${filePath}:${specifier}`);

    expect(apiImportReferences.length).toBeGreaterThan(0);
    expect(uiViolations).toEqual([]);
  });

  it("keeps internal capability endpoint paths out of UI app source files", () => {
    const violations = filesWithContentMatching("apps", /\/internal\/capabilities\//)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps internal capability job route ids present in the REST route catalog", () => {
    const restRouteCatalog = readFileSync(join(workspaceRoot, "packages/openclinxr/rest/src/index.ts"), "utf8");

    expect(restRouteCatalog).toContain(
      'route("submit-internal-capability-job", "POST", "/internal/capabilities/:capabilityId/jobs", "control-plane")',
    );
    expect(restRouteCatalog).toContain(
      'route("read-internal-capability-job", "GET", "/internal/capabilities/:capabilityId/jobs/:jobId", "control-plane")',
    );
  });

  it("keeps UI app GraphQL imports on generated document subpaths instead of the executable server surface", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/graphql(?!\/(?:documents|client)\b)/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps the API app persistence-injected instead of importing concrete Mongo packages", () => {
    const forbiddenImports = /@openclinxr\/(?:data-mongodb|data-sources-mongoose-models)/;
    const violations = filesWithContentMatching("apps/api/src", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("reports concrete Mongo package declarations in the API app manifest", () => {
    const violations = findApiConcretePersistenceManifestViolations([
      {
        manifestPath: "apps/api/package.json",
        field: "dependencies",
        dependency: "@openclinxr/data-mongodb",
      },
      {
        manifestPath: "apps/api/package.json",
        field: "devDependencies",
        dependency: "@openclinxr/data-sources-mongoose-models",
      },
      {
        manifestPath: "packages/openclinxr/data-mongodb/package.json",
        field: "dependencies",
        dependency: "@openclinxr/data-sources-mongoose-models",
      },
    ]);

    expect(violations).toEqual([
      "manifest:apps/api/package.json:dependencies.@openclinxr/data-mongodb",
      "manifest:apps/api/package.json:devDependencies.@openclinxr/data-sources-mongoose-models",
    ]);
  });

  it("keeps the API app manifest free of concrete Mongo persistence packages", () => {
    expect(findApiConcretePersistenceManifestViolations()).toEqual([]);
  });

  it("reports Mongoose dependencies when they leak into the raw MongoDB repository package", () => {
    const violations = findDataMongoMongooseBoundaryViolations({
      manifestDependencies: [
        {
          manifestPath: "packages/openclinxr/data-mongodb/package.json",
          field: "dependencies",
          dependency: "mongoose",
        },
        {
          manifestPath: "packages/openclinxr/data-mongodb/package.json",
          field: "devDependencies",
          dependency: "@openclinxr/data-sources-mongoose-models",
        },
        {
          manifestPath: "packages/openclinxr/data-sources-mongoose-models/package.json",
          field: "dependencies",
          dependency: "mongoose",
        },
      ],
      sourceReferences: [
        {
          filePath: "packages/openclinxr/data-mongodb/src/repositories.ts",
          specifier: "@openclinxr/data-sources-mongoose-models",
        },
        {
          filePath: "packages/openclinxr/data-mongodb/src/repositories.ts",
          specifier: "mongoose",
        },
        {
          filePath: "packages/openclinxr/data-sources-mongoose-models/src/scenario-bank-model.ts",
          specifier: "mongoose",
        },
      ],
    });

    expect(violations).toEqual([
      "manifest:packages/openclinxr/data-mongodb/package.json:dependencies.mongoose",
      "manifest:packages/openclinxr/data-mongodb/package.json:devDependencies.@openclinxr/data-sources-mongoose-models",
      "source:packages/openclinxr/data-mongodb/src/repositories.ts:@openclinxr/data-sources-mongoose-models",
      "source:packages/openclinxr/data-mongodb/src/repositories.ts:mongoose",
    ]);
  });

  it("keeps the raw MongoDB repository package separate from Mongoose models", () => {
    expect(findDataMongoMongooseBoundaryViolations(scanDataMongoMongooseBoundary())).toEqual([]);
  });

  it("keeps telemetry contracts independent from application and runtime packages", () => {
    const forbiddenImports = /@openclinxr\//;
    const violations = filesWithContentMatching("packages/openclinxr/telemetry", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("reports route telemetry attributes that include station-run identity", () => {
    const violations = findRouteTelemetryIdentityViolations([
      {
        filePath: "packages/openclinxr/test-harness/src/benchmark-report.ts",
        sourceText: `
          telemetryRouteAttributes({
            routeId: "actor-response",
            stationRunId: routeMatch.params.stationRunId,
          });
        `,
      },
    ]);

    expect(violations).toEqual(["packages/openclinxr/test-harness/src/benchmark-report.ts:telemetryRouteAttributes.stationRunId"]);
  });

  it("keeps runtime route telemetry low-cardinality and free of station-run identity", () => {
    expect(findRouteTelemetryIdentityViolations(routeTelemetryPolicySourceFiles())).toEqual([]);
  }, 10_000);

  it("keeps Mongoose data sources out of station runtime and trace-ledger dependencies", () => {
    const forbiddenImports = /@openclinxr\/(?:scenario-runtime|trace-ledger|model-gateway|voice-gateway)|apps\//;
    const violations = filesWithContentMatching("packages/openclinxr/data-sources-mongoose-models", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("reports mongodb-memory-server when it leaks outside dev-only data package test infrastructure", () => {
    const violations = findMongoMemoryServerBoundaryViolations({
      manifestDependencies: [
        {
          manifestPath: "apps/api/package.json",
          field: "dependencies",
          dependency: "mongodb-memory-server",
        },
        {
          manifestPath: "packages/openclinxr/data-mongodb/package.json",
          field: "dependencies",
          dependency: "mongodb-memory-server",
        },
        {
          manifestPath: "packages/openclinxr/data-mongodb/package.json",
          field: "devDependencies",
          dependency: "mongodb-memory-server",
        },
      ],
      sourceReferences: [
        {
          filePath: "apps/api/src/app.ts",
          specifier: "mongodb-memory-server",
        },
        {
          filePath: "packages/openclinxr/data-mongodb/src/mongo-memory-context.ts",
          specifier: "mongodb-memory-server",
        },
      ],
    });

    expect(violations).toEqual([
      "manifest:apps/api/package.json:dependencies.mongodb-memory-server",
      "manifest:packages/openclinxr/data-mongodb/package.json:dependencies.mongodb-memory-server",
      "source:apps/api/src/app.ts:mongodb-memory-server",
    ]);
  });

  it("keeps mongodb-memory-server confined to dev-only data package test infrastructure", () => {
    expect(findMongoMemoryServerBoundaryViolations(scanMongoMemoryServerBoundary())).toEqual([]);
  });

  it("keeps the data-mongodb public barrel free of Mongo memory test helpers", () => {
    const publicBarrel = readFileSync(join(workspaceRoot, "packages/openclinxr/data-mongodb/src/index.ts"), "utf8");

    expect(publicBarrel).not.toContain("mongo-memory-context");
  });

  it("keeps durable actor-turn Mongo repositories database-only and separate from realtime/cache lanes", () => {
    const manifestPath = "packages/openclinxr/data-mongodb/package.json";
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, manifestPath), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const repositorySource = readFileSync(join(workspaceRoot, "packages/openclinxr/data-mongodb/src/repositories.ts"), "utf8");
    const forbiddenRuntimeDependencies = [
      "@colyseus/schema",
      "@openclinxr/rest",
      "@openclinxr/scenario-runtime",
      "@openclinxr/voice-gateway",
      "bitecs",
      "colyseus",
      "ioredis",
      "redka",
      "redis",
      "ws",
    ];
    const productionSourceFiles = sourceFilesUnder("packages/openclinxr/data-mongodb")
      .filter((filePath) => !filePath.endsWith(".test.ts"));
    const manifestViolations = workspacePackageDependencyReferences(forbiddenRuntimeDependencies)
      .filter((reference) => reference.manifestPath === manifestPath)
      .map(({ field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`);
    const sourceViolations = forbiddenRuntimeDependencies.flatMap((dependency) =>
      sourceImportReferences(dependency, productionSourceFiles)
        .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`)
    );

    expect(manifest.dependencies).toMatchObject({
      "@openclinxr/session-state": "workspace:*",
      mongodb: "7.2.0",
    });
    expect(manifest.devDependencies).toMatchObject({
      "mongodb-memory-server": "11.1.0",
    });
    expect(repositorySource).toContain("conversation_turns_and_emotional_state_timeline_only");
    expect(repositorySource).toContain("clinicalActionsIncluded: false");
    expect(repositorySource).toContain("redisRedkaIncluded: false");
    expect(repositorySource).toContain("databaseOnly: true");
    expect([...manifestViolations, ...sourceViolations]).toEqual([]);
  });

  it("keeps durable clinical-event Mongo repositories database-only and separate from actor-turn and realtime lanes", () => {
    const repositorySource = readFileSync(join(workspaceRoot, "packages/openclinxr/data-mongodb/src/repositories.ts"), "utf8");

    expect(repositorySource).toContain("proposals/approved/proposal-durable-clinical-event-persistence.md");
    expect(repositorySource).toContain("clinical_actions_orders_findings_checklists_rubric_and_case_progress");
    expect(repositorySource).toContain("actorTurnScopeChanged: false");
    expect(repositorySource).toContain("redisRedkaIncluded: false");
    expect(repositorySource).toContain("databaseOnly: true");
    expect(repositorySource).toContain("durable_clinical_events");
    expect(repositorySource).not.toMatch(/clinicalEvent[\s\S]{0,120}(?:redis|redka|colyseus|bitecs|websocket|webtransport|quic|web3)/i);
  });

  it("prevents production code from importing the superseded multi-actor state spike", () => {
    const spikePackage = "@openclinxr/multi-actor-state-spike";
    const allowedSpikeRoots = ["packages/openclinxr/arena/multi-actor-state-spike/"];
    const manifestViolations = workspacePackageDependencyFindings([spikePackage])
      .filter((finding) => !finding.startsWith("packages/openclinxr/arena/multi-actor-state-spike/package.json:"));
    const sourceViolations = sourceImportReferences(spikePackage)
      .filter(({ filePath }) => !allowedSpikeRoots.some((root) => filePath.startsWith(root)))
      .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`);

    expect([...manifestViolations, ...sourceViolations].sort()).toEqual([]);
  });

  it("keeps promoted session-state free of realtime framework and persistence dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(workspaceRoot, "packages/openclinxr/session-state/package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const forbiddenDependencies = [
      "@colyseus/schema",
      "@fails-components/webtransport",
      "@openclinxr/api",
      "@openclinxr/api-python-backend",
      "@openclinxr/data-mongodb",
      "@openclinxr/data-sources-mongoose-models",
      "@openclinxr/graphql",
      "@openclinxr/rest",
      "@openclinxr/scenario-runtime",
      "@solana/web3.js",
      "@walletconnect/modal",
      "@walletconnect/sign-client",
      "@web3modal/wagmi",
      "aioquic",
      "bitecs",
      "colyseus",
      "ethers",
      "hono",
      "ioredis",
      "ioredis-mock",
      "mongodb",
      "mongodb-memory-server",
      "quic",
      "redka",
      "redis",
      "siwe",
      "viem",
      "wagmi",
      "web3",
      "webtransport",
      "webtransport-polyfill",
      "ws",
    ];
    const sourceViolations = forbiddenDependencies.flatMap((dependency) =>
      sourceImportReferences(
        dependency,
        sourceFilesUnder("packages/openclinxr/session-state").filter((filePath) => !filePath.endsWith(".test.ts")),
      ).map(({ filePath, specifier }) => `source:${filePath}:${specifier}`)
    );

    expect(manifest.dependencies).toEqual({
      "@openclinxr/shared-schemas": "workspace:*",
    });
    expect(manifest.devDependencies).toMatchObject({
      "@openclinxr/scenario-fixtures": "workspace:*",
      typescript: "6.0.3",
      vitest: "4.1.5",
    });
    expect(sourceViolations).toEqual([]);
  });

  it("keeps session-state WebSocket message contracts design-only", () => {
    const source = readFileSync(join(workspaceRoot, "packages/openclinxr/session-state/src/index.ts"), "utf8");
    const docs = readFileSync(join(workspaceRoot, "docs/openclinxr/session-state-websocket-message-design.md"), "utf8");
    const runtimeSignalPattern = /new WebSocket|Bun\.serve|server\.upgrade|from ["']ws["']|from ["']hono|from ["']redis|from ["']redka|from ["']colyseus|from ["']@colyseus\/schema|from ["']bitecs/;

    expect(source).toContain("websocket_design_contract");
    expect(source).toContain("transportPosture: \"websocket_design_contract_only\"");
    expect(source).toContain("runtimeImplemented: false");
    expect(source).toContain("apiWiringIncluded: false");
    expect(source).toContain("redisRedkaIncluded: false");
    expect(source).toContain("databasePersistenceIncluded: false");
    expect(source).toContain("clinical_event_messages_use_review_projection_redaction");
    expect(source).not.toMatch(runtimeSignalPattern);
    expect(docs).toContain("type-level contracts");
    expect(docs).toContain("does not implement realtime synchronization");
  });

  it("keeps the agent-loop orchestration package independent from app and station runtime code", () => {
    const forbiddenImports = /@openclinxr\/(?:scenario-runtime|data-|data-sources-|model-gateway|voice-gateway|trace-ledger)|apps\//;
    const violations = filesWithContentMatching("packages/openclinxr/agent-loop", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("reports paid cloud provider SDKs and credentials when they leak into default runtime paths", () => {
    const violations = findPaidProviderBoundaryViolations({
      manifestDependencies: [
        {
          manifestPath: "packages/openclinxr/model-gateway/package.json",
          field: "dependencies",
          dependency: "openai",
        },
      ],
      sourceReferences: [
        {
          filePath: "packages/openclinxr/model-gateway/src/openai-adapter.ts",
          specifier: "openai",
        },
      ],
      envKeyReferences: [
        {
          filePath: "apps/api/src/cloud-adapter.ts",
          envKey: "OPENAI_API_KEY",
        },
      ],
    });

    expect(violations).toEqual([
      "env:apps/api/src/cloud-adapter.ts:OPENAI_API_KEY",
      "manifest:packages/openclinxr/model-gateway/package.json:dependencies.openai",
      "source:packages/openclinxr/model-gateway/src/openai-adapter.ts:openai",
    ]);
  });

  it("keeps paid cloud model and voice SDKs out of default local runtime manifests and source", () => {
    expect(findPaidProviderBoundaryViolations(scanPaidProviderBoundary())).toEqual([]);
  }, 10_000);

  it("scans package scripts, config files, env templates, and tools for paid provider credentials", () => {
    expect(paidProviderPolicyTextFiles()).toEqual(expect.arrayContaining([
      ".env.openclinxr.local.example",
      "package.json",
      "turbo.json",
      "vitest.config.ts",
      "apps/api/tsdown.config.ts",
      "apps/ui-xr/vite.config.ts",
      "tools/openclinxr/evidence/local-provider-benchmark.ts",
    ]));
  });

  it("keeps shared UI packages free of circular imports", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("packages/openclinxr/ui-*/src/**")
      .should()
      .haveNoCycles()
      .check();

    expect(violations).toEqual([]);
  }, 60_000);

  it("keeps the XR headset runtime on scenario fixture subpaths instead of the barrel", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-xr/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath("packages/openclinxr/scenario-fixtures/src/index.ts")
      .check();

    expect(violations).toEqual([]);
  }, 20_000);

  it("keeps Meta Immersive Web SDK dependencies isolated from production runtime paths", () => {
    const allowedSpikeRoots = ["apps/arena/ui-xr-iwsdk-spike/", "packages/openclinxr/arena/iwsdk-spike/"];
    const iwsdkImportPattern = /(?:from\s+["']|import\s*\(\s*["'])@iwsdk\//;
    const sourceViolations = [...sourceFilesUnder("apps"), ...sourceFilesUnder("packages")]
      .filter((filePath) => iwsdkImportPattern.test(readFileSync(join(workspaceRoot, filePath), "utf8")))
      .filter((filePath) => !allowedSpikeRoots.some((root) => filePath.startsWith(root)));
    const manifestViolations = packageManifestFiles()
      .filter((filePath) => /"@iwsdk\//.test(readFileSync(join(workspaceRoot, filePath), "utf8")))
      .filter((filePath) => !allowedSpikeRoots.some((root) => filePath.startsWith(root)));

    expect([...sourceViolations, ...manifestViolations]).toEqual([]);
  });

  it("keeps blocked IWSDK optional packages out of package manifests and the lockfile", () => {
    const blockedDependencies = ["@iwsdk/create", "@iwsdk/reference", "@iwsdk/starter-assets", "@meta-quest/hzdb"];
    const manifestViolations = workspacePackageDependencyFindings(blockedDependencies);
    const lockfileText = readFileSync(join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
    const lockfileViolations = blockedDependencies.filter((dependency) => lockfileContainsDependency(lockfileText, dependency));

    expect([...manifestViolations, ...lockfileViolations.map((dependency) => `pnpm-lock.yaml:${dependency}`)]).toEqual([]);
  });

  it("keeps the approved IWSDK sidecar limited to approved runtime packages and approved sidecar devtools", () => {
    const sidecarManifestPath = join(workspaceRoot, "apps/arena/ui-xr-iwsdk-spike/package.json");
    expect(existsSync(sidecarManifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(sidecarManifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toMatchObject({
      "@iwsdk/core": "0.3.1",
      "@iwsdk/xr-input": "0.3.1",
      "three": "0.184.0",
    });
    expect(manifest.devDependencies).toMatchObject({
      "@iwsdk/vite-plugin-dev": "0.3.1",
      "@iwsdk/vite-plugin-uikitml": "0.3.1",
      "@types/three": "0.184.0",
      "typescript": "6.0.3",
      "vite": "8.0.10",
      "vitest": "4.1.5",
    });
    expect(manifest.dependencies?.["@iwsdk/vite-plugin-dev"]).toBeUndefined();
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((dependency) =>
      dependency.startsWith("@iwsdk/")
      && !["@iwsdk/core", "@iwsdk/xr-input", "@iwsdk/vite-plugin-dev", "@iwsdk/vite-plugin-uikitml"].includes(dependency)
    )).toEqual([]);
  });

  it("keeps a future IWSDK sidecar from importing production ui-xr app internals", async () => {
    const sidecarRoot = join(workspaceRoot, "apps/arena/ui-xr-iwsdk-spike");
    if (!existsSync(sidecarRoot)) {
      return;
    }

    const sourceImportViolations = findSidecarProductionUiCouplings();
    const archUnitViolations = await projectFiles(archTsconfig)
      .inFolder("apps/arena/ui-xr-iwsdk-spike/src/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("apps/ui-xr/src/**")
      .check();

    expect([...sourceImportViolations, ...archUnitViolations]).toEqual([]);
  }, 20_000);

  it("keeps IWSDK lockfile packages absent while the sidecar app is absent", () => {
    if (existsSync(join(workspaceRoot, "apps/arena/ui-xr-iwsdk-spike"))) {
      return;
    }

    const lockfileText = readFileSync(join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
    const lockfileViolations = findIwsdkLockfilePackages(lockfileText).map((dependency) => `pnpm-lock.yaml:${dependency}`);

    expect(lockfileViolations).toEqual([]);
  });

  it("keeps UI app source from depending on Mongo persistence source files", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-*/src/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("packages/openclinxr/data-*/src/**")
      .check();

    expect(violations).toEqual([]);
  }, 20_000);

  it("keeps production UI source free of unsafe user-facing assessment claims", () => {
    const productionUiSource = [
      ...sourceFilesUnder("apps").filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath)),
      ...sourceFilesUnder("packages/openclinxr").filter((filePath) => /^packages\/openclinxr\/ui-[^/]+\/src\//.test(filePath)),
    ]
      .filter((filePath) => !filePath.includes(".test."))
      .filter((filePath) => filePath.endsWith(".tsx") || /^packages\/openclinxr\/ui-route-[^/]+\/src\/index\.ts$/.test(filePath));
    const violations = productionUiSource.flatMap((filePath) =>
      userFacingTextFragments(filePath).flatMap((fragment) =>
        findUnsafeClaimLanguage(fragment).map((finding) => ({
          filePath,
          ruleId: finding.ruleId,
          match: finding.match,
        })),
      ),
    );

    expect(violations).toEqual([]);
  });
});

function workspacePackageDirs(root: string): string[] {
  root = join(workspaceRoot, root);

  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((packageDir) => existsSync(join(packageDir, "package.json")));
}

function productionAppSourceFiles(): string[] {
  return productionAppRoots.flatMap((root) => sourceFilesUnder(root));
}

function factorySourceFiles(): string[] {
  return typescriptFilesUnder("tools/openclinxr/factory");
}

function sourceFilesUnder(root: string): string[] {
  root = join(workspaceRoot, root);

  if (!existsSync(root)) {
    return [];
  }

  return walk(root)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => /\/src\/.*\.tsx?$/.test(filePath));
}

function filesWithContentMatching(root: string, pattern: RegExp): string[] {
  return sourceFilesUnder(root).filter((filePath) => pattern.test(readFileSync(join(workspaceRoot, filePath), "utf8")));
}

function routeTelemetryPolicySourceFiles(): SourceTextReference[] {
  return [...typescriptFilesUnder("apps"), ...typescriptFilesUnder("packages"), ...typescriptFilesUnder("tools")]
    .filter((filePath) => !/\.test\.tsx?$/.test(filePath))
    .filter((filePath) => !filePath.includes("/generated/"))
    .map((filePath) => ({
    filePath,
    sourceText: readFileSync(join(workspaceRoot, filePath), "utf8"),
  }));
}

function findRouteTelemetryIdentityViolations(files: SourceTextReference[]): string[] {
  return files.flatMap(({ filePath, sourceText }) => {
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations: string[] = [];

    function visit(node: ts.Node): void {
      if (isTelemetryRouteAttributesCall(node) && callIncludesStationRunIdAttribute(node)) {
        violations.push(`${filePath}:telemetryRouteAttributes.stationRunId`);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return violations;
  }).sort();
}

function isTelemetryRouteAttributesCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "telemetryRouteAttributes";
}

function callIncludesStationRunIdAttribute(node: ts.CallExpression): boolean {
  const firstArgument = node.arguments[0];
  if (!firstArgument || !ts.isObjectLiteralExpression(firstArgument)) {
    return false;
  }

  return firstArgument.properties.some((property) =>
    ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === "stationRunId"
  );
}

function packageManifestFiles(): string[] {
  return walk(workspaceRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => filePath.endsWith("package.json"))
    .filter((filePath) => !filePath.includes("/node_modules/") && !filePath.includes("/dist/"));
}

function trackedWorkspaceFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: workspaceRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function trackedLocalArtifactViolations(files = trackedWorkspaceFiles()): string[] {
  const approvedGeneratedRoots = ["packages/openclinxr/graphql/src/generated/"];

  return files
    .filter((filePath) => !approvedGeneratedRoots.some((root) => filePath.startsWith(root)))
    .filter((filePath) =>
      /(^|\/)(?:dist|coverage|node_modules|\.turbo|\.venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(?:\/|$)/.test(filePath)
      || /(^|\/)\.env\.openclinxr\.local$/.test(filePath)
      || /(^|\/)\.DS_Store$/.test(filePath)
      || /\.(?:pyc|pyo|log|tmp)$/.test(filePath)
    );
}

function workspacePackageDependencyReferences(dependencies: string[]): WorkspaceDependencyReference[] {
  return packageManifestFiles().flatMap((filePath) => {
    const packageJson = JSON.parse(readFileSync(join(workspaceRoot, filePath), "utf8")) as Record<string, Record<string, string>>;

    return dependencyFields.flatMap((field) =>
      dependencies
        .filter((dependency) => packageJson[field]?.[dependency])
        .map((dependency) => ({ manifestPath: filePath, field, dependency })),
    );
  });
}

function workspacePackageDependencyFindings(blockedDependencies: string[]): string[] {
  return workspacePackageDependencyReferences(blockedDependencies).map(({ manifestPath, field, dependency }) =>
    `${manifestPath}:${field}.${dependency}`
  );
}

function scanMongoMemoryServerBoundary(): MongoMemoryServerBoundaryInput {
  return {
    manifestDependencies: workspacePackageDependencyReferences(["mongodb-memory-server"]),
    sourceReferences: sourceImportReferences("mongodb-memory-server"),
  };
}

function scanDataMongoMongooseBoundary(): DataMongoMongooseBoundaryInput {
  const forbiddenDependencies = ["@openclinxr/data-sources-mongoose-models", "mongoose"];

  return {
    manifestDependencies: workspacePackageDependencyReferences(forbiddenDependencies),
    sourceReferences: forbiddenDependencies.flatMap((dependency) =>
      sourceImportReferences(dependency, sourceFilesUnder("packages/openclinxr/data-mongodb"))
    ),
  };
}

function findApiConcretePersistenceManifestViolations(
  manifestDependencies = workspacePackageDependencyReferences([...apiConcretePersistenceDependencies]),
): string[] {
  return manifestDependencies
    .filter(({ manifestPath, dependency }) =>
      manifestPath === "apps/api/package.json"
      && (apiConcretePersistenceDependencies as readonly string[]).includes(dependency)
    )
    .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`)
    .sort();
}

function findDataMongoMongooseBoundaryViolations(input: DataMongoMongooseBoundaryInput): string[] {
  return [
    ...input.manifestDependencies
      .filter(({ manifestPath, dependency }) =>
        manifestPath === "packages/openclinxr/data-mongodb/package.json"
        && (dependency === "@openclinxr/data-sources-mongoose-models" || dependency === "mongoose")
      )
      .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`),
    ...input.sourceReferences
      .filter(({ filePath }) => filePath.startsWith("packages/openclinxr/data-mongodb/src/"))
      .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`),
  ].sort();
}

function scanPaidProviderBoundary(): PaidProviderBoundaryInput {
  const policyTextFiles = paidProviderPolicyTextFiles();

  return {
    manifestDependencies: workspacePackageDependencyReferences([...paidCloudProviderDependencies]),
    sourceReferences: paidCloudProviderDependencies.flatMap((dependency) => sourceImportReferences(dependency, policyTextFiles)),
    envKeyReferences: findEnvKeyReferences(policyTextFiles, [...paidCloudProviderEnvKeys]),
  };
}

function findPaidProviderBoundaryViolations(input: PaidProviderBoundaryInput): string[] {
  return [
    ...input.envKeyReferences.map(({ filePath, envKey }) => `env:${filePath}:${envKey}`),
    ...input.manifestDependencies.map(({ manifestPath, field, dependency }) =>
      `manifest:${manifestPath}:${field}.${dependency}`
    ),
    ...input.sourceReferences.map(({ filePath, specifier }) => `source:${filePath}:${specifier}`),
  ].sort();
}

function findMongoMemoryServerBoundaryViolations(input: MongoMemoryServerBoundaryInput): string[] {
  return [
    ...input.manifestDependencies
      .filter(({ dependency }) => dependency === "mongodb-memory-server")
      .filter(({ manifestPath, field }) =>
        field !== "devDependencies"
        || ![
          "packages/openclinxr/data-mongodb/package.json",
          "packages/openclinxr/data-sources-mongoose-models/package.json",
        ].includes(manifestPath)
      )
      .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`),
    ...input.sourceReferences
      .filter(({ specifier }) => specifier === "mongodb-memory-server" || specifier.startsWith("mongodb-memory-server/"))
      .filter(({ filePath }) => !isAllowedMongoMemoryServerSource(filePath))
      .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`),
  ].sort();
}

function isAllowedMongoMemoryServerSource(filePath: string): boolean {
  return [
    /^packages\/openclinxr\/data-mongodb\/src\/(?:.*\.test\.ts|mongo-memory-context\.ts)$/,
    /^packages\/openclinxr\/data-sources-mongoose-models\/src\/(?:.*\.test\.ts|mongoose-memory-context\.ts)$/,
  ].some((pattern) => pattern.test(filePath));
}

function sourceImportReferences(specifier: string, files = [...sourceFilesUnder("apps"), ...sourceFilesUnder("packages")]): SourceImportReference[] {
  const importPattern = new RegExp(
    `(?:from\\s+["'](${escapeRegExp(specifier)}(?:/[^"']*)?)["']|import\\s*\\(\\s*["'](${escapeRegExp(specifier)}(?:/[^"']*)?)["']\\s*\\))`,
    "g",
  );

  return files.flatMap((filePath) => {
    const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
    return [...sourceText.matchAll(importPattern)].map((match) => ({
      filePath,
      specifier: match[1] ?? match[2] ?? specifier,
    }));
  });
}

function runtimePolicySourceFiles(): string[] {
  return [...typescriptFilesUnder("apps"), ...typescriptFilesUnder("packages"), ...typescriptFilesUnder("tools")]
    .filter((filePath) => !/\.test\.tsx?$/.test(filePath))
    .filter((filePath) => !filePath.includes("/generated/"));
}

function paidProviderPolicyTextFiles(): string[] {
  return [...new Set([
    ...runtimePolicySourceFiles(),
    ...packageManifestFiles(),
    ...workspaceConfigAndEnvFiles(),
  ])].sort();
}

function workspaceConfigAndEnvFiles(): string[] {
  return walk(workspaceRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) =>
      filePath.startsWith(".env")
      || filePath === "turbo.json"
      || filePath === "pnpm-workspace.yaml"
      || /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(filePath)
      || /(^|\/)(?:vite|vitest|tsdown|rolldown|biome|eslint|storybook|codegen|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(filePath)
    );
}

function typescriptFilesUnder(root: string): string[] {
  const absoluteRoot = join(workspaceRoot, root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  return walk(absoluteRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => /\.tsx?$/.test(filePath));
}

function findEnvKeyReferences(files: string[], envKeys: string[]): Array<{ filePath: string; envKey: string }> {
  return files.flatMap((filePath) => {
    const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
    return envKeys
      .filter((envKey) => new RegExp(`\\b${escapeRegExp(envKey)}\\b`).test(sourceText))
      .map((envKey) => ({ filePath, envKey }));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lockfileContainsDependency(lockfileText: string, dependency: string): boolean {
  const escapedDependency = dependency.replaceAll("/", "\\/").replaceAll("@", "\\@");
  return new RegExp(`(?:^|\\n)\\s*(?:${escapedDependency}:|/${escapedDependency}@)`).test(lockfileText);
}

function findIwsdkLockfilePackages(lockfileText: string): string[] {
  return [...new Set([...lockfileText.matchAll(/(?:^|\n)\s*\/?(@iwsdk\/[^@\s:]+|@meta-quest\/hzdb)@/g)]
    .map((match) => match[1])
    .filter((dependency): dependency is string => Boolean(dependency)))];
}

function findSidecarProductionUiCouplings(): string[] {
  const sidecarSourceFiles = sourceFilesUnder("apps/arena/ui-xr-iwsdk-spike");
  const sourceImportPattern =
    /(?:from\s*["']|import\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])([^"']+)/g;
  const sourceViolations = sidecarSourceFiles.flatMap((filePath) => {
    const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
    return [...sourceText.matchAll(sourceImportPattern)]
      .map((match) => match[1])
      .filter((specifier): specifier is string => Boolean(specifier))
      .filter((specifier) => sidecarImportTargetsProductionUi(filePath, specifier))
      .map((specifier) => `source:${filePath}:${specifier}`);
  });
  const manifestViolations = workspacePackageDependencyReferences(["@openclinxr/ui-xr"])
    .filter(({ manifestPath }) => manifestPath === "apps/arena/ui-xr-iwsdk-spike/package.json")
    .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`);

  return [...manifestViolations, ...sourceViolations].sort();
}

function sidecarImportTargetsProductionUi(importerFilePath: string, specifier: string): boolean {
  if (specifier === "@openclinxr/ui-xr" || specifier.startsWith("@openclinxr/ui-xr/")) {
    return true;
  }
  if (specifier.includes("apps/ui-xr/src")) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolvedPath = join(workspaceRoot, dirname(importerFilePath), specifier);
  return relative(join(workspaceRoot, "apps/ui-xr/src"), resolvedPath).split(sep).join("/").startsWith("..") === false;
}

function userFacingTextFragments(filePath: string): string[] {
  const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fragments: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      fragments.push(node.text);
    } else if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).trim();
      if (text.length > 0) {
        fragments.push(text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return fragments;
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".git") {
        return [];
      }
      return walk(childPath);
    }
    return entry.isFile() ? [childPath] : [];
  });
}

function findWorkspaceRoot(): string {
  let candidate = process.cwd();

  while (true) {
    if (existsSync(join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error("Could not find workspace root containing pnpm-workspace.yaml");
    }
    candidate = parent;
  }
}
