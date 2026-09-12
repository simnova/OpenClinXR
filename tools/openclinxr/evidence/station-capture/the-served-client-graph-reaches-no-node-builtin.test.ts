/**
 * OBSERVABLE: the learner client throws before the station shell can publish.
 *
 * MEASURED 2026-09-12 on ed_chest_pain_priority_v2 (render-cause-2026-09-12.md):
 *
 *   Module "node:crypto" has been externalized for browser compatibility.
 *   Cannot access "node:crypto.createHash" in client code.
 *
 * `apps/ui-xr/src/main.ts` value-imports
 * `@openclinxr/asset-registry/encounter-bundle-admission`. That entry's
 * implementation imported `node:crypto` and `scene-plan-freeze-mod` (which
 * also imports `node:crypto` + `node:fs`). Vite externalizes the builtin;
 * the page throws on first real use; the shell wait then burns 180 s.
 *
 * KNOWN-GOOD: `frozen-scene-replay.ts` / `layout-solve.ts` / `case-owned-scene-plan.ts`
 * already refuse `from "node:"` (the-normal-consumer-replays-and-invalidates-the-frozen-scene.test.ts).
 * #715 walks the asset-registry "." entry the same way.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `encounter-bundle-admission-mod` no longer value-imports `node:crypto` or
 * `scene-plan-freeze-mod`. Canonical JSON and SHA-256 live in browser-safe
 * modules. `verifyCommittedScenePlanAgainstDisk` stays a VALUE export of
 * `./encounter-bundle-admission` (PSR keep). The freeze path still hashes
 * with `node:crypto` behind `./scene-plan-freeze`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const CLIENT_ENTRY = resolve(REPO, "apps/ui-xr/src/main.ts");
const ADMISSION_ENTRY = resolve(
  REPO,
  "packages/openclinxr/asset-registry/src/encounter-bundle-admission.ts",
);

const VALUE_FROM =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

type PkgExports = Record<string, string | { browser?: string; default?: string; types?: string }>;

type Reach = { modules: string[]; nodeImporters: Map<string, string[]> };

function isTypeOnlyClause(clause: string): boolean {
  if (!clause.startsWith("{")) return false;
  return clause
    .slice(1, -1)
    .split(",")
    .every((part) => part.trim() === "" || part.trim().startsWith("type "));
}

function distSpecifierToSrc(pkgRoot: string, target: string): string | null {
  const withoutDot = target.replace(/^\.\//u, "");
  const asSrc = withoutDot.replace(/^dist\//u, "src/").replace(/\.js$/u, ".ts");
  const candidate = resolve(pkgRoot, asSrc);
  return existsSync(candidate) ? candidate : null;
}

function resolveOpenclinxr(spec: string): string | null {
  if (!spec.startsWith("@openclinxr/")) return null;
  const rest = spec.slice("@openclinxr/".length);
  const parts = rest.split("/");
  for (let take = parts.length; take >= 1; take -= 1) {
    const pkgRoot = resolve(REPO, "packages/openclinxr", parts.slice(0, take).join("/"));
    const pkgJsonPath = resolve(pkgRoot, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { exports?: PkgExports };
    const sub = take === parts.length ? "." : `./${parts.slice(take).join("/")}`;
    const exp = pkg.exports?.[sub];
    if (exp === undefined) return null;
    const target = typeof exp === "string" ? exp : (exp.browser ?? exp.default);
    if (target === undefined) return null;
    return distSpecifierToSrc(pkgRoot, target);
  }
  return null;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  if (spec.startsWith("node:")) return null;
  if (spec.startsWith("@openclinxr/")) return resolveOpenclinxr(spec);
  if (!spec.startsWith(".")) return null;
  if (spec.endsWith(".css")) return null;
  const asTs = resolve(dirname(fromFile), spec.replace(/\.js$/u, ".ts"));
  if (existsSync(asTs)) return asTs;
  const asIndex = resolve(dirname(fromFile), spec.replace(/\.js$/u, ""), "index.ts");
  return existsSync(asIndex) ? asIndex : null;
}

function valueReachableFrom(entry: string): Reach {
  const seen = new Set<string>();
  const nodeImporters = new Map<string, string[]>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() ?? "";
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(VALUE_FROM)) {
      const clause = match[1]?.trim() ?? "";
      const spec = match[2] ?? "";
      if (spec.startsWith("node:")) {
        const rel = relative(REPO, file);
        nodeImporters.set(rel, [...(nodeImporters.get(rel) ?? []), spec]);
        continue;
      }
      if (isTypeOnlyClause(clause)) continue;
      const next = resolveSpec(file, spec);
      if (next !== null) stack.push(next);
    }
    for (const match of src.matchAll(SIDE_EFFECT_IMPORT)) {
      const spec = match[1] ?? "";
      if (spec.startsWith("node:")) {
        const rel = relative(REPO, file);
        nodeImporters.set(rel, [...(nodeImporters.get(rel) ?? []), spec]);
        continue;
      }
      const next = resolveSpec(file, spec);
      if (next !== null) stack.push(next);
    }
  }
  return { modules: [...seen], nodeImporters };
}

describe("the served client graph reaches no node: builtin", () => {
  it("(1) no module value-reachable from ui-xr main.ts imports a node: builtin", () => {
    const { nodeImporters } = valueReachableFrom(CLIENT_ENTRY);
    const offenders = [...nodeImporters.entries()].map(
      ([mod, specs]) => `${mod} -> ${specs.join(", ")}`,
    );
    // Threshold provenance: ZERO is an external floor — a browser cannot resolve
    // node:crypto.createHash at all (Vite throws the measured page exception).
    expect(offenders).toEqual([]);
  });

  it("(2) known-good: the walk is a real graph, and frozen-scene-replay stays clean", () => {
    const { modules, nodeImporters } = valueReachableFrom(CLIENT_ENTRY);
    expect(modules.length, "traversal collapsed; a tiny graph cannot prove the leak is gone")
      .toBeGreaterThanOrEqual(40);
    const replay = resolve(
      REPO,
      "packages/openclinxr/asset-registry/src/frozen-scene-replay-mod.ts",
    );
    expect(modules, "reopen path dropped out of the served graph").toContain(replay);
    expect(nodeImporters.has(relative(REPO, replay))).toBe(false);
  });

  it("(3) COUNTERWEIGHT: verifyCommittedScenePlanAgainstDisk stays a VALUE on the same entry", () => {
    const src = readFileSync(ADMISSION_ENTRY, "utf8");
    expect(src).toMatch(/export \{[\s\S]*verifyCommittedScenePlanAgainstDisk[\s\S]*\} from/u);
    expect(src).not.toMatch(/export type \{[\s\S]*verifyCommittedScenePlanAgainstDisk/u);
    const impl = readFileSync(
      resolve(REPO, "packages/openclinxr/asset-registry/src/encounter-bundle-admission-mod.ts"),
      "utf8",
    );
    expect(impl).toMatch(/export function verifyCommittedScenePlanAgainstDisk/u);
    expect(impl).not.toMatch(/from ["']node:/u);
  });

  it("(4) COUNTERWEIGHT: the learner client still value-imports the admission entry", () => {
    const main = readFileSync(CLIENT_ENTRY, "utf8");
    expect(main).toContain('"@openclinxr/asset-registry/encounter-bundle-admission"');
    const clause = main.slice(0, main.indexOf('"@openclinxr/asset-registry/encounter-bundle-admission"'));
    const lastImport = clause.lastIndexOf("import ");
    expect(clause.slice(lastImport, lastImport + 12)).not.toContain("type");
  });
});
