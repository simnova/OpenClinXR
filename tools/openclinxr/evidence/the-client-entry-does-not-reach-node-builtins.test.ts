/**
 * #713 — the asset-registry CLIENT entry must not value-reach a node: builtin.
 *
 * THE DEFECT, MEASURED (treeStamp 11312ac012, 2026-08-27) — do not re-derive this.
 * These are measurements. The inference that follows them is labelled as an inference.
 *
 *   packages/openclinxr/asset-registry/src/index.ts:44-48 VALUE-exports
 *   `findStaleMeasuredGeometry` and `freshMeasuredTriangleCounts` from
 *   ./measured-station-geometry-freshness.js, which imports node:crypto (:17),
 *   node:fs (:18) and node:path (:19).
 *
 *   apps/ui-xr/src/encounter-actor-framing.ts:17 imports DEFAULT_PATIENT_CHAIR_POSITION
 *   from "@openclinxr/asset-registry" — the "." entry — so the browser bundle pulls
 *   that module graph.
 *
 *   Value-reachable module graph from the "." entry: 18 modules. Exactly 1 imports a
 *   node: builtin. The other 17 are the known-good column: the ambient count is ZERO,
 *   so this is an outlier and not a house style.
 *
 * INFERRED, not measured here: that this is why apps/ui-xr fails to boot in dev on a
 * fresh dist. The #712 worker reported that boot failure independently and said its own
 * 2026-08-27 05:00Z capture only succeeded against a stale Aug 23 dist. It is also the
 * leading candidate for the "WebXR unavailable" error surface that made #526's pixel
 * grade unobtainable in three separate environments. DO NOT treat either as established
 * — trace the boot yourself.
 *
 * The export landed in 60a8bbc7 (#711). The fix is a node-only subpath entry beside the
 * nine that already exist in package.json, NOT deletion: apps/api/src/api-route-support.ts
 * calls freshMeasuredTriangleCounts at :726 and must keep working.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#713)` block
 * below. Do not rewrite the paths or numbers above.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const REGISTRY_SRC = resolve(REPO, "packages/openclinxr/asset-registry/src");
const CLIENT_ENTRY = resolve(REGISTRY_SRC, "index.ts");

/**
 * Value imports/exports only. `import type` / `export type` and clauses whose every
 * specifier is `type X` are erased at compile time and cannot pull a runtime builtin,
 * so they are correctly excluded — a browser never resolves them.
 */
const VALUE_FROM = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;

type Reach = { modules: string[]; nodeImporters: Map<string, string[]> };

function valueReachableFrom(entry: string): Reach {
  const seen = new Set<string>();
  const nodeImporters = new Map<string, string[]>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(VALUE_FROM)) {
      const clause = match[1]?.trim() ?? "";
      const spec = match[2] ?? "";
      if (spec.startsWith("node:")) {
        const rel = file.replace(`${REGISTRY_SRC}/`, "");
        nodeImporters.set(rel, [...(nodeImporters.get(rel) ?? []), spec]);
        continue;
      }
      if (!spec.startsWith(".")) continue;
      if (
        clause.startsWith("{") &&
        clause
          .slice(1, -1)
          .split(",")
          .every((s) => s.trim() === "" || s.trim().startsWith("type "))
      ) {
        continue;
      }
      const candidate = resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
      if (existsSync(candidate)) stack.push(candidate);
    }
  }
  return { modules: [...seen], nodeImporters };
}

describe("#713 the asset-registry client entry does not value-reach a node: builtin", () => {
  it.fails(
    "(1) RED: no module value-reachable from the '.' entry imports a node: builtin",
    () => {
      const { nodeImporters } = valueReachableFrom(CLIENT_ENTRY);
      const offenders = [...nodeImporters.entries()].map(
        ([mod, specs]) => `${mod} -> ${specs.join(", ")}`,
      );
      // Threshold provenance: ZERO is an external floor, not a fitted number — a browser
      // cannot resolve node:crypto/node:fs/node:path at all, so one is already fatal.
      expect(offenders).toEqual([]);
    },
  );

  it("(2) the known-good column: the ambient node-import count in this graph is zero", () => {
    const { modules, nodeImporters } = valueReachableFrom(CLIENT_ENTRY);
    // Guards against a lucky small graph: if traversal silently collapsed to a couple of
    // files, "one offender out of 18" would be meaningless.
    expect(modules.length).toBeGreaterThanOrEqual(15);
    const clean = modules.length - nodeImporters.size;
    expect(clean).toBeGreaterThanOrEqual(modules.length - 1);
  });

  it("(3) COUNTERWEIGHT: freshMeasuredTriangleCounts survives as a VALUE for its node caller", () => {
    // Refuses the cheapest fix — deleting the export, or converting it to `export type`.
    const consumer = resolve(REPO, "apps/api/src/api-route-support.ts");
    const src = readFileSync(consumer, "utf8");
    expect(src).toContain("freshMeasuredTriangleCounts");
    const importBlock = src.slice(0, src.indexOf("freshMeasuredTriangleCounts"));
    const lastImport = importBlock.lastIndexOf("import ");
    expect(importBlock.slice(lastImport, lastImport + 12)).not.toContain("type");
    const impl = readFileSync(
      resolve(REGISTRY_SRC, "measured-station-geometry-freshness.ts"),
      "utf8",
    );
    expect(impl).toMatch(/export function freshMeasuredTriangleCounts|export const freshMeasuredTriangleCounts/);
  });

  it("(4) COUNTERWEIGHT: ui-xr keeps its '.' import rather than the app being cut loose", () => {
    // Refuses "make apps/ui-xr stop importing the registry", which would clear clause (1)
    // while removing a real consumer relationship.
    const framing = readFileSync(
      resolve(REPO, "apps/ui-xr/src/encounter-actor-framing.ts"),
      "utf8",
    );
    expect(framing).toContain("DEFAULT_PATIENT_CHAIR_POSITION");
    expect(framing).toContain('"@openclinxr/asset-registry"');
  });

  it("(5) COUNTERWEIGHT: the '.' entry is not deleted from package.json to pass clause (1)", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(REPO, "packages/openclinxr/asset-registry/package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };
    expect(pkg.exports?.["."]).toBeTruthy();
    // Ambient today: 9 entry keys (the "." client entry plus 8 subpaths), measured
    // 2026-08-27. Pinning the ambient refuses "delete an entry to clear clause (1)".
    // The expected fix ADDS a node-only tenth; this clause deliberately does not
    // require that shape, so a different correct fix is not pre-refused.
    expect(Object.keys(pkg.exports ?? {}).length).toBeGreaterThanOrEqual(9);
  });
});
