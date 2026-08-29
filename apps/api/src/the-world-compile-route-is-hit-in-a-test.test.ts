import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: no apps/api test POSTs /internal/world-compile. The landed plant
 * only greps source for the path string (tsk_c525 / 7802faea). Delete the
 * await compileEncounterMaterialization call and that plant stays green.
 *
 * MEASURED 2026-08-29 after 37a87f13 grade (cmt_16e24dbec4ac973c):
 *   grep of apps/api/src/*.test.ts for /internal/world-compile finds only
 *   the mention-plant file, which never calls app.request.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (#0)
 * 2026-08-29. the-world-compile-route-rejects-empty-body.test.ts POSTs
 * /internal/world-compile via app.request. Empty body is 400 or 403, never 404.
 *
 * claimScope: an API test hits the route.
 * notEvidenceFor: live Blender; Quest; that compileVersion is clinically meaningful.
 */

const API_SRC = dirname(fileURLToPath(import.meta.url));

function apiTestSources(): { name: string; src: string }[] {
  return readdirSync(API_SRC)
    .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
    .map((name) => ({ name, src: readFileSync(join(API_SRC, name), "utf8") }));
}

describe("the world-compile route is hit in a test", () => {
  it("(1) some apps/api test both mentions /internal/world-compile and calls request(", () => {
    const hits = apiTestSources().filter(
      (file) =>
        file.name !== "the-world-compile-route-is-hit-in-a-test.test.ts" &&
        file.src.includes("/internal/world-compile") &&
        /request\s*\(/.test(file.src),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("(2) COUNTERWEIGHT: the mention-plant still exists and does not count as a hit", () => {
    const mention = apiTestSources().find(
      (file) => file.name === "the-world-compile-route-invokes-compileEncounterMaterialization.test.ts",
    );
    expect(mention).toBeDefined();
    expect(mention!.src.includes("/internal/world-compile")).toBe(true);
    expect(/request\s*\(/.test(mention!.src)).toBe(false);
  });
});
