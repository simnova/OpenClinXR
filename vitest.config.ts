import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * Root tools runner. CellixJS: every package mergeConfig(nodeConfig, …).
 * Worktree exclude lives in nodeConfig — Vitest does not read .gitignore
 * (measured 2026-08-30: nested .claude/.grok worktrees doubled test files).
 */
export default mergeConfig(nodeConfig, defineConfig({
  resolve: { alias: {
    "@openclinxr/xr-dialogue/actor-audio-runtime": createRequire(new URL("./apps/ui-xr/package.json", import.meta.url)).resolve("@openclinxr/xr-dialogue/actor-audio-runtime"),
    "../../../../apps/ui-xr/src/prepared-actor-audio.ts": fileURLToPath(new URL("./apps/ui-xr/tests/actor-audio-compat.ts", import.meta.url)),
    "../../../../apps/ui-xr/src/prepared-actor-audio.js": fileURLToPath(new URL("./apps/ui-xr/tests/actor-audio-compat.ts", import.meta.url)),
    "../../../../apps/ui-xr/src/ordinary-actor-turn-speech.ts": fileURLToPath(new URL("./apps/ui-xr/tests/actor-audio-compat.ts", import.meta.url)),
    "../../../../apps/ui-xr/src/ordinary-actor-turn-speech.js": fileURLToPath(new URL("./apps/ui-xr/tests/actor-audio-compat.ts", import.meta.url)),
  } },
  test: { exclude: [...nodeConfig["test"]!.exclude!, "**/audible-lip-sync-proof/capture.test.mjs", "**/audible-lip-sync-proof/source-wiring.test.mjs", "**/actor-audio-package-subpath-integration/historical-test-compatibility.test.ts"] },
}));
