import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: `buildEncounterRuntimeHandoffAdapterReport` has no production caller.
 *
 * MEASURED 2026-08-28. Exact-symbol search under apps/, packages/, tools/ finds:
 *   definition  tools/openclinxr/factory/encounter-runtime-handoff-adapter.ts
 *   tests       tools/openclinxr/factory/encounter-runtime-handoff-adapter.test.ts
 *   no other file.
 *
 * GitHub #612 (2026-08-23) recorded the same count. Re-measured; still one non-test occurrence.
 *
 * claimScope: a production (non-test) file imports or calls the symbol.
 * notEvidenceFor: that the report shape matches a learner selector; Quest; clinical validity.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

const REPO = process.cwd();
const DEF = join(REPO, "tools/openclinxr/factory/encounter-runtime-handoff-adapter.ts");
const SYMBOL = "buildEncounterRuntimeHandoffAdapterReport";
const ROOTS = ["apps", "packages", "tools"];

function walk(dir: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(ent.name)) acc.push(p);
  }
}

function productionCallers(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(join(REPO, root), files);
  return files.filter((f) => {
    if (f.endsWith(".test.ts") || f.endsWith(".test.tsx") || f.includes(".test.")) return false;
    if (f.endsWith("encounter-runtime-handoff-adapter.ts")) return false;
    try {
      return readFileSync(f, "utf8").includes(SYMBOL);
    } catch {
      return false;
    }
  });
}

describe("the encounter runtime handoff has a production caller", () => {
  it.fails("(1) a non-test production file imports or calls the handoff adapter", () => {
    expect(
      productionCallers().length,
      "definition-only is the #612 class: the launch chain ends in a function nobody calls",
    ).toBeGreaterThan(0);
  });

  it("(2) COUNTERWEIGHT: the definition still exists", () => {
    expect(existsSync(DEF), "deleting the adapter is not a caller").toBe(true);
    expect(readFileSync(DEF, "utf8")).toContain(`export function ${SYMBOL}`);
  });

  it("(3) COUNTERWEIGHT: its own unit tests do not count as production callers", () => {
    expect(productionCallers().every((f) => !f.includes(".test."))).toBe(true);
  });
});

// NOT TESTED: whether the report shape matches a runtime selector; knip unused status.
