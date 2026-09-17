import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const root = new URL("../../../../", import.meta.url);
it("the root runner retains only the two named historical source/report exclusions", () => {
  const config = readFileSync(new URL("vitest.config.ts", root), "utf8");
  expect(config).toContain("audible-lip-sync-proof/capture.test.mjs");
  expect(config).toContain("audible-lip-sync-proof/source-wiring.test.mjs");
  expect(config).not.toMatch(/audible-lip-sync-proof\/(?:\*|\*\*)/);
  expect(config).toContain("prepared-actor-audio-compat");
  expect(config).toContain("nodeConfig");
});
it("old importer aliases delegate to actual admitted factory and real private clock/data helpers", () => {
  const facade = readFileSync(new URL("tools/openclinxr/factory/actor-audio-package-integration/prepared-actor-audio-compat.ts", root), "utf8");
  expect(facade).toMatch(/import\s*\{\s*createActorAudioRuntime\s*\}\s*from\s*["']@openclinxr\/xr-dialogue["']/);
  expect(facade).toContain("actor-audio-playback-clock");
  expect(facade).toContain("actor-audio-prepared-data");
  expect(facade).not.toMatch(/new\s+Map\s*\(|createBufferSource\s*\(|Object\.defineProperty\s*\(/);
});
