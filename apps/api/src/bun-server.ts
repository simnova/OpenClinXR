import { createBunServerConfig, createOpenClinXrApiStartup } from "./index.js";

type BunRuntime = {
  serve: (options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }) => { url?: URL; port?: number };
};

const bun = (globalThis as { Bun?: BunRuntime }).Bun;
if (!bun) {
  throw new Error("Bun runtime is required for apps/api/src/bun-server.ts. Use pnpm --filter @openclinxr/api dev:node as the local fallback until Bun is installed.");
}

const startup = createOpenClinXrApiStartup().startUp();
const config = createBunServerConfig(startup, {
  port: Number(process.env.PORT ?? 3000),
});
const server = bun.serve({
  port: config.port,
  fetch: config.fetch,
});

console.log(`OpenClinXR Bun/Hono API listening on ${server.url?.toString() ?? `http://localhost:${config.port}`}`);
console.log(`Realtime WebSocket route contract: ${config.websocketPath}`);
