/**
 * Portless dev entrypoint for the encounter sync server (local dev only).
 *
 * Portless assigns the port (`portless xr-sync-<instance> ...` sets PORT and
 * HOST=127.0.0.1); this server honours PORT exactly and prints the listening
 * line the portless-dev-run harness parses. Never exported from index.ts:
 * the library entrypoint stays the in-process `createEncounterServer` used by
 * tests and the c*-run harnesses.
 *
 * Dev stack (C35): XR_SYNC_SCENARIO selects a shipped scenarioId (default
 * "ed_chest_pain_priority_v1"); XR_SYNC_ENCOUNTER_SECONDS sets the encounter
 * slot length in seconds (default 900).
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevStack } from "./dev-stack.js";
import { createEncounterServer } from "./server.js";
import { bootSidecarRecognizer } from "./sidecar-recognizer.js";

function fail(message: string): never {
  console.error(`xr-sync dev-server: ${message}`);
  process.exit(1);
}

// biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["PORT"] on process.env.
const rawPort = process.env["PORT"];
const port = rawPort !== undefined && /^[1-9][0-9]*$/.test(rawPort) ? Number(rawPort) : Number.NaN;
if (!Number.isInteger(port) || port > 65535) {
  fail(
    `refusing to start: PORT must be an integer 1-65535 (got ${JSON.stringify(rawPort ?? null)}). ` +
      "Portless assigns PORT; a dev server on port 0 defeats portless.",
  );
}

// biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["XR_SYNC_INSTANCE"] on process.env.
const rawInstance = process.env["XR_SYNC_INSTANCE"] ?? process.argv[2] ?? "local";
const instance = rawInstance.startsWith("xr-sync-") ? rawInstance : `xr-sync-${rawInstance}`;

// Signal handlers first: SIGTERM during the (up to 180 s) model probe must still kill the sidecar.
let closeSpeech: () => void = () => undefined;
let server: Awaited<ReturnType<typeof createEncounterServer>> | null = null;
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  try {
    closeSpeech();
    await server?.close();
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

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const { scenarioBank, scenarioDialogueSeedBank } = await import("@openclinxr/scenario-fixtures");
let stack;
try {
  stack = resolveDevStack(process.env, { scenarioBank, scenarioDialogueSeedBank });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
console.log(`xr-sync scenario ready id=${stack.scenarioId} actors=${stack.actorCount}`);

const speech = await bootSidecarRecognizer(
  process.env,
  {
    script: join(repoRoot, "tools/openclinxr/evidence/xr-sync/stt/transcribe.py"),
    python: join(repoRoot, ".openclinxr/stt/venv/bin/python"),
  },
  { onCreated: (close) => { closeSpeech = close; } },
);
if (speech.recognizer !== null) {
  console.log(`xr-sync speech ready model=${speech.reason}`);
} else {
  console.log(`xr-sync speech unavailable: ${speech.reason}`);
}

server = await createEncounterServer(
  speech.recognizer !== null
    ? { port, examBlueprint: stack.examBlueprint, scenarios: stack.scenarios, dialogueSeeds: stack.dialogueSeeds, speechRecognizer: speech.recognizer }
    : { port, examBlueprint: stack.examBlueprint, scenarios: stack.scenarios, dialogueSeeds: stack.dialogueSeeds },
);
console.log(`xr-sync listening ws://127.0.0.1:${server.port} instance=${instance}`);
if (closing) {
  await server.close().catch(() => undefined);
}
