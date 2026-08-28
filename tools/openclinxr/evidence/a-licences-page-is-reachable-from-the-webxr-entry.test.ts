import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: no licences page is reachable from the WebXR entry HTML.
 *
 * MEASURED 2026-08-28. GitHub #645. apps/ui-xr/index.html has no href to a licences
 * document. apps/ui-xr/public/ has no licences.html (or licenses.html).
 *
 * claimScope: a learner-reachable HTML page lists third-party asset licences.
 * notEvidenceFor: clinical validity; Quest; that any listed licence is the right one.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

const REPO = process.cwd();
const ENTRY = join(REPO, "apps/ui-xr/index.html");
const PUBLIC_LICENCES = join(REPO, "apps/ui-xr/public/licences.html");

describe("a licences page is reachable from the WebXR entry", () => {
  it.fails("(1) a licences.html exists under the ui-xr public tree", () => {
    expect(existsSync(PUBLIC_LICENCES), "GitHub #645: CC-BY approval depends on this page").toBe(true);
  });

  it.fails("(2) the WebXR entry HTML links to that page", () => {
    expect(existsSync(ENTRY)).toBe(true);
    const html = readFileSync(ENTRY, "utf8");
    expect(
      /href=["'][^"']*licen[cs]es?\.html["']/i.test(html),
      "a page nobody can click from the entry is not reachable",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the WebXR entry HTML still exists", () => {
    expect(existsSync(ENTRY)).toBe(true);
    expect(readFileSync(ENTRY, "utf8")).toMatch(/<html/i);
  });
});

// NOT TESTED: that listed licence strings match the ledger; website marketing copy.
