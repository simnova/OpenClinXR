import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";

/**
 * OBSERVABLE: faculty compileEncounterWorld POSTs /internal/world-compile but
 * apps/api has no handler that calls compileEncounterMaterialization.
 *
 * MEASURED 2026-08-29 on main feef25e5: grep of apps/api/src has zero matches
 * for world-compile or compileEncounterMaterialization. ui-admin
 * compile-encounter-world.ts is request-only.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * claimScope: the HTTP handler faculty uses to compile.
 * notEvidenceFor: live Blender; baker lock-skip; Quest; clinical validity.
 *
 * ## FIXED (#0)
 * 2026-08-29. apps/api/src/world-compile-routes.ts registers
 * POST /internal/world-compile (faculty-guarded) and invokes
 * compileEncounterMaterialization (tools/openclinxr/factory WCG compile runner,
 * loaded through a non-static specifier like the Mongo boot) against the newest
 * dated encounter-materialization-evidence JSON for the scenarioId under
 * docs/openclinxr/, writing the compiled report under the gitignored
 * .openclinxr/evidence/world-compile/. No baker spawn, no packet promote.
 */

const API_SRC = dirname(fileURLToPath(import.meta.url));

const REST_WORLD_COMPILE_ROUTE = join(
  API_SRC,
  "../../../packages/openclinxr/rest/src/routes/world-compile-routes.ts",
);

function _apiTsSources(): string[] {
  return readdirSync(API_SRC)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
    .map((name) => readFileSync(join(API_SRC, name), "utf8"))
    .concat([readFileSync(REST_WORLD_COMPILE_ROUTE, "utf8")]);
}

describe("the world-compile route invokes compileEncounterMaterialization", () => {
  it("(1) the registered route handles /internal/world-compile", async () => {
    const app = createApiApp();
    const response = await app.request("/internal/world-compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).not.toBe(404);
  });

  it("(2) the moved route module invokes compileEncounterMaterialization", () => {
    expect(readFileSync(REST_WORLD_COMPILE_ROUTE, "utf8").includes("compileEncounterMaterialization")).toBe(true);
  });

  it("(3) COUNTERWEIGHT: faculty client still POSTs that path", () => {
    const client = readFileSync(
      join(API_SRC, "../../../packages/openclinxr/ui-route-shared/src/compile-encounter-world.ts"),
      "utf8",
    );
    expect(client.includes("/internal/world-compile")).toBe(true);
  });
});
