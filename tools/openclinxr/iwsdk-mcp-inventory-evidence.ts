import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildIwsdkMcpToolInventory,
  buildIwsdkMcpToolInventoryRequirement,
  buildIwsdkPackageManagedMcpCommand,
  evaluateIwsdkAgentToolingEvidence,
  evaluateIwsdkAgentToolingLocalPreflightEvidence,
  type IwsdkAgentToolingEvidence,
  type IwsdkAgentToolingEvidenceReadiness,
  type IwsdkAgentToolingLocalPreflightReadiness,
  type IwsdkMcpToolCategory,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

type CliOptions = {
  outputPath?: string;
  timeoutMs: number;
};

type JsonRpcResponse = {
  id?: number | string;
  result?: unknown;
  error?: unknown;
};

export type IwsdkMcpInventoryEvidenceReport = {
  generatedAt: string;
  source: "iwsdk_dev_mcp_stdio_tools_list";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    mcpConfigMutated: false;
    optionalReferenceWarmupUsed: false;
    hzdbUsed: false;
    productionUseAllowed: false;
    physicalQuestClaimed: false;
  };
  command: {
    executable: "pnpm";
    args: string[];
    cwd: string;
  };
  package: {
    name: "@iwsdk/vite-plugin-dev";
    version: string | null;
    sidecarManifest: "apps/ui-xr-iwsdk-spike/package.json";
  };
  server: {
    name: string | null;
    version: string | null;
    protocolVersion: string | null;
  };
  inventory: {
    expectedToolCount: 32;
    observedToolCount: number;
    observedToolNames: string[];
    missingExpectedToolNames: string[];
    unknownToolNames: string[];
    coveredCategories: IwsdkMcpToolCategory[];
    requiredCategoriesCovered: boolean;
    matchedExpectedInventory: boolean;
  };
  agentToolingEvidence: IwsdkAgentToolingEvidence;
  agentToolingReadiness: IwsdkAgentToolingEvidenceReadiness;
  localPreflightReadiness: IwsdkAgentToolingLocalPreflightReadiness;
  caveats: string[];
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await captureIwsdkMcpInventoryEvidence({
    timeoutMs: options.timeoutMs,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.inventory.matchedExpectedInventory) {
    process.exitCode = 1;
  }
}

export async function captureIwsdkMcpInventoryEvidence(input: {
  generatedAt?: string;
  timeoutMs?: number;
  cwd?: string;
} = {}): Promise<IwsdkMcpInventoryEvidenceReport> {
  const cwd = input.cwd ?? process.cwd();
  const packageVersion = await readIwsdkDevPluginVersion(cwd);
  const mcpResponse = await requestIwsdkMcpToolInventory({
    cwd,
    timeoutMs: input.timeoutMs ?? 5_000,
  });

  return buildIwsdkMcpInventoryEvidenceReport({
    generatedAt: input.generatedAt,
    cwd,
    packageVersion,
    server: {
      name: stringOrNull(mcpResponse.initializeResult.serverInfo?.name),
      version: stringOrNull(mcpResponse.initializeResult.serverInfo?.version),
      protocolVersion: stringOrNull(mcpResponse.initializeResult.protocolVersion),
    },
    observedToolNames: mcpResponse.toolNames,
  });
}

export function buildIwsdkMcpInventoryEvidenceReport(input: {
  generatedAt?: string;
  cwd?: string;
  packageVersion?: string | null;
  server?: {
    name?: string | null;
    version?: string | null;
    protocolVersion?: string | null;
  };
  observedToolNames: string[];
}): IwsdkMcpInventoryEvidenceReport {
  const command = buildIwsdkPackageManagedMcpCommand();
  const expectedInventory = buildIwsdkMcpToolInventory();
  const requirement = buildIwsdkMcpToolInventoryRequirement();
  const observedToolNames = [...input.observedToolNames].sort();
  const expectedToolNames: string[] = [...requirement.expectedToolNames].sort();
  const missingExpectedToolNames = expectedToolNames.filter((toolName) => !observedToolNames.includes(toolName));
  const unknownToolNames = observedToolNames.filter((toolName) => !expectedToolNames.includes(toolName));
  const coveredCategories = expectedInventory.categories
    .filter((category) => category.tools.every((toolName) => observedToolNames.includes(toolName)))
    .map((category) => category.category);
  const requiredCategoriesCovered = requirement.requiredCategories.every((category) => coveredCategories.includes(category));
  const matchedExpectedInventory = observedToolNames.length === requirement.expectedToolCount
    && missingExpectedToolNames.length === 0
    && unknownToolNames.length === 0
    && requiredCategoriesCovered;
  const agentToolingEvidence: IwsdkAgentToolingEvidence = {
    phase2DevtoolsConfiguredInSidecar: true,
    adapterSyncRecorded: false,
    toolCount: observedToolNames.length,
    coveredCategories,
    validatedSmokeTools: [],
    observedToolNames,
    mcpRuntimeRegistered: false,
    sceneHierarchyContainsRequiredObjects: false,
    ecsRuntimeQueryable: false,
    optionalServerActions: [],
  };

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "iwsdk_dev_mcp_stdio_tools_list",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      mcpConfigMutated: false,
      optionalReferenceWarmupUsed: false,
      hzdbUsed: false,
      productionUseAllowed: false,
      physicalQuestClaimed: false,
    },
    command: {
      executable: command.executable,
      args: command.args,
      cwd: input.cwd ?? process.cwd(),
    },
    package: {
      name: "@iwsdk/vite-plugin-dev",
      version: input.packageVersion ?? null,
      sidecarManifest: "apps/ui-xr-iwsdk-spike/package.json",
    },
    server: {
      name: input.server?.name ?? null,
      version: input.server?.version ?? null,
      protocolVersion: input.server?.protocolVersion ?? null,
    },
    inventory: {
      expectedToolCount: requirement.expectedToolCount,
      observedToolCount: observedToolNames.length,
      observedToolNames,
      missingExpectedToolNames,
      unknownToolNames,
      coveredCategories,
      requiredCategoriesCovered,
      matchedExpectedInventory,
    },
    agentToolingEvidence,
    agentToolingReadiness: evaluateIwsdkAgentToolingEvidence(agentToolingEvidence),
    localPreflightReadiness: evaluateIwsdkAgentToolingLocalPreflightEvidence(agentToolingEvidence),
    caveats: [
      "This report proves only stdio MCP tool inventory from the installed sidecar dev plugin.",
      "Local preflight readiness means only that the sidecar MCP tool inventory is complete and policy-clean.",
      "No adapter sync, MCP config mutation, browser session, scene hierarchy query, ECS query, or physical Quest run is performed.",
      "Agent-tooling readiness remains blocked until the aggregate evaluator accepts managed-browser, smoke-tool, scene, and ECS evidence.",
    ],
  };
}

async function requestIwsdkMcpToolInventory(input: {
  cwd: string;
  timeoutMs: number;
}): Promise<{
  initializeResult: {
    protocolVersion?: unknown;
    serverInfo?: {
      name?: unknown;
      version?: unknown;
    };
  };
  toolNames: string[];
}> {
  const command = buildIwsdkPackageManagedMcpCommand();
  const child = spawn(command.executable, command.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const responses = new Map<string, JsonRpcResponse>();
  let bufferedStdout = "";
  let stderr = "";
  let stdoutWaiter: (() => void) | null = null;

  child.stdout.on("data", (chunk) => {
    bufferedStdout += String(chunk);
    let newlineIndex = bufferedStdout.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = bufferedStdout.slice(0, newlineIndex).trim();
      bufferedStdout = bufferedStdout.slice(newlineIndex + 1);
      if (line.length > 0) {
        const response = JSON.parse(line) as JsonRpcResponse;
        if (response.id !== undefined) {
          responses.set(String(response.id), response);
        }
      }
      newlineIndex = bufferedStdout.indexOf("\n");
    }
    stdoutWaiter?.();
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    sendJsonRpc(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "openclinxr-iwsdk-mcp-inventory-evidence",
          version: "0.1.0",
        },
      },
    });
    const initialize = await waitForResponse("1");
    sendJsonRpc(child, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    sendJsonRpc(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const toolList = await waitForResponse("2");
    const initializeResult = responseResultRecord(initialize);
    const toolsResult = responseResultRecord(toolList);
    const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : [];
    return {
      initializeResult: {
        protocolVersion: initializeResult.protocolVersion,
        serverInfo: isRecord(initializeResult.serverInfo) ? initializeResult.serverInfo : undefined,
      },
      toolNames: tools
        .map((tool) => (isRecord(tool) ? tool.name : undefined))
        .filter((name): name is string => typeof name === "string")
        .sort(),
    };
  } finally {
    child.kill("SIGTERM");
  }

  async function waitForResponse(id: string): Promise<JsonRpcResponse> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < input.timeoutMs) {
      const response = responses.get(id);
      if (response) {
        if (response.error) {
          throw new Error(`IWSDK MCP response ${id} failed: ${JSON.stringify(response.error)}`);
        }
        return response;
      }
      await new Promise<void>((resolve) => {
        stdoutWaiter = resolve;
        setTimeout(resolve, 25);
      });
      stdoutWaiter = null;
    }
    throw new Error(`Timed out waiting for IWSDK MCP response ${id}${stderr ? `: ${stderr.trim()}` : ""}`);
  }
}

async function readIwsdkDevPluginVersion(cwd: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(cwd, "apps/ui-xr-iwsdk-spike/package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    return manifest.devDependencies?.["@iwsdk/vite-plugin-dev"]
      ?? manifest.dependencies?.["@iwsdk/vite-plugin-dev"]
      ?? null;
  } catch {
    return null;
  }
}

function responseResultRecord(response: JsonRpcResponse): Record<string, unknown> {
  if (!isRecord(response.result)) {
    throw new Error(`Expected JSON-RPC result object for response ${String(response.id)}`);
  }
  return response.result;
}

function sendJsonRpc(child: ReturnType<typeof spawn>, message: Record<string, unknown>): void {
  if (!child.stdin) {
    throw new Error("IWSDK MCP process stdin is unavailable");
  }
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    timeoutMs: 5_000,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function numberValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a numeric value`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
