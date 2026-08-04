import {
  createBunRealtimeVoiceGatewayPostureInputFromEnvironment,
  createBunServerConfig,
  createOpenClinXrApiStartup,
  type StartedOpenClinXrApi,
} from "./index.js";

type BunRuntime = {
  serve: (options: {
    port: number;
    fetch: (request: Request, server: BunServer) => Response | Promise<Response> | undefined;
    websocket: ReturnType<typeof createBunServerConfig>["websocket"];
  }) => { url?: URL; port?: number };
};

type BunServer = {
  upgrade(request: Request): boolean;
};

const bun = (globalThis as { Bun?: BunRuntime }).Bun;
if (!bun) {
  throw new Error("Bun runtime is required for apps/api/src/bun-server.ts. Use pnpm --filter @openclinxr/api dev:node as the local fallback until Bun is installed.");
}

async function resolveBunStartup(): Promise<StartedOpenClinXrApi> {
  const realtimeVoiceGatewayPosture = createBunRealtimeVoiceGatewayPostureInputFromEnvironment(process.env);
  if (process.env["OPENCLINXR_PERSISTENCE"] !== "mongodb") {
    return createOpenClinXrApiStartup({ realtimeVoiceGatewayPosture }).startUp();
  }
  // Composition root: load Mongo boot from tools/ via a non-static specifier so apps/api
  // stays persistence-agnostic (architecture rule) and the default build graph is Mongo-free.
  const bootSpecifier = "../../../tools/openclinxr/api-mongo-boot.js";
  const bootModule = (await import(bootSpecifier)) as {
    createBootedOpenClinXrApiStartup: (
      env?: NodeJS.ProcessEnv,
      extraOptions?: { realtimeVoiceGatewayPosture?: unknown },
    ) => Promise<{ startup: StartedOpenClinXrApi; boot: { mode: string; fallbackReason?: string } }>;
  };
  const { startup, boot } = await bootModule.createBootedOpenClinXrApiStartup(process.env, {
    realtimeVoiceGatewayPosture,
  });
  console.log(
    `OpenClinXR Bun API persistence mode: ${boot.mode}${boot.fallbackReason ? ` (fallback: ${boot.fallbackReason})` : ""}`,
  );
  return startup;
}

const pythonBackendWebSocketUrl = process.env["OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL"];
const startup = await resolveBunStartup();
const config = createBunServerConfig(startup, {
  port: Number(process.env["PORT"] ?? 3000),
  ...(pythonBackendWebSocketUrl ? { pythonBackendWebSocketUrl } : {}),
});
const server = bun.serve({
  port: config.port,
  fetch: (request, server) => {
    if (config.canUpgradeWebSocketRequest(request)) {
      if (server.upgrade(request)) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return config.fetch(request);
  },
  websocket: config.websocket,
});

console.log(`OpenClinXR Bun/Hono API listening on ${server.url?.toString() ?? `http://localhost:${config.port}`}`);
console.log(`Realtime WebSocket route contract: ${config.websocketPath}`);
