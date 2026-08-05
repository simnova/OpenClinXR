import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TsConfig convention fitness rule (ArchUnit-style; "tsconfig layering").
 *
 * WHY: A stray compiler option (baseUrl, ignoreDeprecations, empty types, odd outDir
 * or rootDir) silently degrades composite / incremental builds. The 42 workspace tsconfig
 * files in this monorepo all extend a common base; enforcing the lowest-common-denominator
 * conventions here catches drift before it costs hours in CI.
 *
 * Layering: This package already asserts `file-size-budgets` (per-file LOC caps + freeze
 * ratchet). This checker follows the same three-file pattern (checks / test-suite / test).
 *
 * Exemptions: Some packages legitimately need `rootDir "."` because includes span
 * outside `src/` (codegen, scripts, vitest configs co-located). These are listed in the
 * TSCONFIG_EXEMPTIONS constant with an explicit reason -- never silently skipped.
 */

// -- Default exemptions -----------------------------------------------------

/**
 * TsConfig exemption allowlist. Each key is a workspace-relative path to a tsconfig.json.
 * The `rules` array names which of the five convention rules this file is exempt from.
 * Every entry MUST include a `reason` explaining why the exemption is legitimate.
 *
 * Adding an entry to dodge a violation without a real reason weakens the gate -- don't.
 */
export const TSCONFIG_EXEMPTIONS: Record<
  string,
  { rules: string[]; reason: string }
> = {
  "packages/cellix/config-vitest/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "vitest.config.ts lives at package root outside src/; rootDir '.' is correct for mixed-root includes",
  },
  "packages/openclinxr/graphql/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "codegen.ts + scripts/*.ts live outside src/; rootDir '.' is correct",
  },
  "apps/arena/physics-clinical-touch/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "Vite-bundled touch demo app; rootDir '.' accommodates vite config + src co-location",
  },
  "apps/api/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "rolldown.config.ts + tsdown.config.ts + scripts/*.ts live outside src/; rootDir '.' is correct",
  },
};

// -- Config type -------------------------------------------------------------

export type TsconfigConventionConfig = {
  exemptions?: Record<string, { rules: string[]; reason: string }>;
  workspaceRoot?: string;
};

// -- Private helpers ---------------------------------------------------------

const SKIP_DIR = /node_modules$|[\/\\](dist|generated|public|scratch)[\/\\]/;

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/**
 * Walk `packages/` and `apps/` for plain `tsconfig.json` files (no `tsconfig.*.json` variants).
 */
function listTsconfigs(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];

  for (const zoneDir of ["packages", "apps"]) {
    stack.push(join(root, zoneDir));
  }

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(full)) stack.push(full);
      } else if (entry.name === "tsconfig.json") {
        out.push(relative(root, full));
      }
    }
  }
  return out.sort();
}

// -- Public check function (pure -- no vitest) -------------------------------

/**
 * Assert TypeScript compiler-option conventions across every workspace tsconfig.json.
 *
 * Rules:
 *  1. `compilerOptions.baseUrl` must not be set (breaks project references / module resolution portability)
 *  2. `compilerOptions.ignoreDeprecations` must not be set
 *  3. if `compilerOptions.types` is present it must NOT be an empty array (TS 7 defaults to [] -- an empty
 *     array disables ALL ambient types, which is almost never intended)
 *  4. if `compilerOptions.outDir` is set it must be "dist" or "./dist"
 *  5. if `compilerOptions.rootDir` is set it must be "src" or "./src"
 *
 * Returns an array of violation strings. Each names the offending file AND the option,
 * so a dev can fix it without re-reading this rule.
 */
export function checkTsconfigConventions(
  config?: TsconfigConventionConfig,
): string[] {
  const root = config?.workspaceRoot ?? findWorkspaceRoot();
  const exemptions = config?.exemptions ?? TSCONFIG_EXEMPTIONS;

  const violations: string[] = [];

  for (const rel of listTsconfigs(root)) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(readFileSync(join(root, rel), "utf8"));
    } catch {
      violations.push(`${rel}: could not parse as JSON`);
      continue;
    }

    const co = (json as Record<string, unknown>)["compilerOptions"] as
      | Record<string, unknown>
      | undefined;
    if (!co || typeof co !== "object") continue;

    const fileExemptions = exemptions[rel];
    const skip = (rule: string): boolean =>
      fileExemptions?.rules.includes(rule) ?? false;

    // Rule 1: baseUrl must not be set
    if (!skip("baseUrl") && "baseUrl" in co) {
      violations.push(
        `${rel}: compilerOptions.baseUrl is set to ${JSON.stringify(co["baseUrl"])} -- baseUrl breaks project references / module resolution portability`,
      );
    }

    // Rule 2: ignoreDeprecations must not be set
    if (
      !skip("ignoreDeprecations") &&
      co["ignoreDeprecations"] !== undefined
    ) {
      violations.push(
        `${rel}: compilerOptions.ignoreDeprecations is set to ${JSON.stringify(co["ignoreDeprecations"])} -- must not be set`,
      );
    }

    // Rule 3: types must not be an empty array
    if (
      !skip("types") &&
      Array.isArray(co["types"]) &&
      (co["types"] as unknown[]).length === 0
    ) {
      violations.push(
        `${rel}: compilerOptions.types is an empty array [] -- disables ALL ambient types; remove the key or populate it`,
      );
    }

    // Rule 4: outDir must be "dist" or "./dist"
    if (
      !skip("outDir") &&
      "outDir" in co &&
      co["outDir"] !== "dist" &&
      co["outDir"] !== "./dist"
    ) {
      violations.push(
        `${rel}: compilerOptions.outDir is ${JSON.stringify(co["outDir"])} -- must be "dist" or "./dist"`,
      );
    }

    // Rule 5: rootDir must be "src" or "./src"
    if (
      !skip("rootDir") &&
      "rootDir" in co &&
      co["rootDir"] !== "src" &&
      co["rootDir"] !== "./src"
    ) {
      violations.push(
        `${rel}: compilerOptions.rootDir is ${JSON.stringify(co["rootDir"])} -- must be "src" or "./src"`,
      );
    }
  }

  return violations;
}
