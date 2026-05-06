import { createBunServerConfig, createOpenClinXrApiStartup } from "./index.js";

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

const pythonBackendWebSocketUrl = process.env.OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL;
const startup = createOpenClinXrApiStartup({
  realtimeVoiceGatewayPosture: {
    bunAvailable: true,
    pythonBackendWebSocketUrlConfigured: Boolean(pythonBackendWebSocketUrl),
    pythonBackendDependenciesInstalled: false,
    pythonInferenceRuntimeInstalled: false,
  },
}).startUp();
const config = createBunServerConfig(startup, {
  port: Number(process.env.PORT ?? 3000),
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
