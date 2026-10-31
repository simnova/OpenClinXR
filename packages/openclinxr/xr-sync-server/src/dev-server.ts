/**
 * Portless dev entrypoint for the encounter sync server (local dev only).
 *
 * Portless assigns the port (`portless xr-sync-<instance> ...` sets PORT and
 * HOST=127.0.0.1); this server honours PORT exactly and prints the listening
 * line the portless-dev-run harness parses. Never exported from index.ts:
 * the library entrypoint stays the in-process `createEncounterServer` used by
 * tests and the c*-run harnesses.
 */

import { createEncounterServer } from "./server.js";

function fail(message: string): never {
  console.error(`xr-sync dev-server: ${message}`);
  process.exit(1);
}

const rawPort = process.env["PORT"];
const port = rawPort === undefined ? Number.NaN : Number(rawPort);
if (rawPort === undefined || rawPort.trim() === "" || !Number.isInteger(port) || port <= 0) {
  fail(
    `refusing to start: PORT must be a positive integer (got ${JSON.stringify(rawPort ?? null)}). ` +
      "Portless assigns PORT; a dev server on port 0 defeats portless.",
  );
}

const rawInstance = process.env["XR_SYNC_INSTANCE"] ?? process.argv[2] ?? "local";
const instance = rawInstance.startsWith("xr-sync-") ? rawInstance : `xr-sync-${rawInstance}`;

const server = await createEncounterServer({ port });
console.log(`xr-sync listening ws://127.0.0.1:${server.port} instance=${instance}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  try {
    await server.close();
  } catch (error) {
    console.error(`xr-sync dev-server: close failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
