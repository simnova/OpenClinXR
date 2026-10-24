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
      "vitest.config.ts lives at package root outside src/; rootDir '.' is correct for mixed-root includes. Source-first config package uses allowImportingTsExtensions + noEmit so Node/Vitest can load @cellix/config-vitest/node as TypeScript.",
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
  "apps/arena/model-vetting-studio/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "Vite app extending @cellix/config-typescript/base (TypeScript native 7.0.2 noEmit inherited); vite.config.ts lives at the app root outside src/ alongside src/**/*.ts(x), so rootDir '.' is correct for mixed-root includes",
  },
  "apps/arena/ui-xr-iwsdk-spike/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "Vite app extending @cellix/config-typescript/base (TypeScript native 7.0.2 noEmit inherited); vite.config.ts lives at the app root outside src/ alongside src/**/*.ts, so rootDir '.' is correct for mixed-root includes",
  },
  "apps/ui-admin/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "Vite app extending @cellix/config-typescript/base (TypeScript native 7.0.2 noEmit inherited); vite.config.ts + vite.config.test.ts live at the app root outside src/ alongside src, so rootDir '.' is correct for mixed-root includes",
  },
  "apps/ui-xr/tsconfig.json": {
    rules: ["rootDir"],
    reason:
      "Vite app extending @cellix/config-typescript/base (TypeScript native 7.0.2 noEmit inherited); vite.config.ts lives at the app root outside src/ alongside src/**/*.ts, so rootDir '.' is correct for mixed-root includes",
  },
};

// -- Config type -------------------------------------------------------------

export type TsconfigConventionConfig = {
  exemptions?: Record<string, { rules: string[]; reason: string }>;
  workspaceRoot?: string;
};

// -- Private helpers ---------------------------------------------------------

const SKIP_DIR = /node_modules$|[/\\](dist|generated|public|scratch)[/\\]/;

/** readdirSync with the failure folded into the return, so the caller needs no annotation. */
function readDirEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

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
    const dir = stack.pop();
    if (dir === undefined) break;
    const entries = readDirEntries(dir);
    if (entries === null) continue;
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

// -- Effective-option resolution (extends-chain aware) ------------------------

const CELLIX_TS_SPECIFIER = "@cellix/config-typescript/";
const CELLIX_TS_LEAVES = new Set(["base", "node", "vitest"]);

/**
 * Resolve an `extends` specifier to an absolute file path, or undefined when it
 * cannot be resolved from this tree. Handles the workspace's
 * `@cellix/config-typescript/<leaf>` specifiers (mapped to
 * packages/cellix/config-typescript/tsconfig.<leaf>.json, with a node_modules
 * fallback for linked installs) and relative specifiers (for example
 * ./tsconfig.base.json inside the config-typescript package itself). Other bare
 * specifiers are not resolved -- the extends allowlist gate already rejects them.
 */
function resolveExtendsFile(
  root: string,
  fromRel: string,
  spec: string,
): string | undefined {
  if (spec.startsWith(CELLIX_TS_SPECIFIER)) {
    const leaf = spec.slice(CELLIX_TS_SPECIFIER.length);
    if (!CELLIX_TS_LEAVES.has(leaf)) return undefined;
    const workspaceCandidate = join(
      root,
      "packages/cellix/config-typescript",
      `tsconfig.${leaf}.json`,
    );
    try {
      readFileSync(workspaceCandidate, "utf8");
      return workspaceCandidate;
    } catch {
      const linked = join(
        root,
        "node_modules/@cellix/config-typescript",
        `tsconfig.${leaf}.json`,
      );
      try {
        readFileSync(linked, "utf8");
        return linked;
      } catch {
        return undefined;
      }
    }
  }
  if (spec.startsWith(".")) {
    return join(dirname(join(root, fromRel)), spec);
  }
  return undefined;
}

function readJsonObject(full: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Effective `noEmit` for a tsconfig, resolved through its `extends` chain. The
 * file's own explicit boolean wins; otherwise the chain is consulted (later
 * `extends` entries override earlier ones), yielding undefined when nothing in
 * the chain states it. An unreadable link ends that branch rather than failing
 * the whole check -- the extends allowlist gate reports unresolvable files.
 */
function effectiveNoEmit(
  root: string,
  fromRel: string,
  seen: Set<string>,
): boolean | undefined {
  if (seen.has(fromRel)) return undefined;
  seen.add(fromRel);
  const json = readJsonObject(join(root, fromRel));
  if (json === undefined) return undefined;
  const co = json["compilerOptions"] as Record<string, unknown> | undefined;
  if (co !== undefined && typeof co["noEmit"] === "boolean") {
    return co["noEmit"];
  }
  const extendsField = json["extends"];
  const specs =
    typeof extendsField === "string"
      ? [extendsField]
      : Array.isArray(extendsField)
        ? extendsField.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
  for (let index = specs.length - 1; index >= 0; index -= 1) {
    const target = resolveExtendsFile(root, fromRel, specs[index] as string);
    if (target === undefined) continue;
    const targetRel = relative(root, target);
    if (targetRel.startsWith("..")) continue;
    const inherited = effectiveNoEmit(root, targetRel, seen);
    if (inherited !== undefined) return inherited;
  }
  return undefined;
}

/**
 * Narrow Vite-app exception for Rule 5 (rootDir).
 *
 * WHY: Vite apps co-locate vite.config.ts at the app root outside src/ while
 * extending the shared noEmit base (TypeScript native 7.0.2: base sets
 * noEmit:true; nothing is emitted, so rootDir "." cannot corrupt an output
 * tree). For those apps rootDir "." is correct for mixed-root includes.
 *
 * ALL of these must hold; each rejected unit case breaks exactly one:
 *  - workspace path under apps/ (packages stay src-rooted even when noEmit)
 *  - local rootDir is "." (or "./")
 *  - include covers the root vite config (vite.config.ts at the app root)
 *  - effective noEmit through the extends chain is true (a local emitting
 *    override or an emitting Node base rejects)
 */
function isViteNoEmitAppException(
  root: string,
  rel: string,
  json: Record<string, unknown>,
  co: Record<string, unknown>,
): boolean {
  if (!rel.startsWith("apps/")) return false;
  const rootDir = co["rootDir"];
  if (rootDir !== "." && rootDir !== "./") return false;
  const include = json["include"];
  if (!Array.isArray(include)) return false;
  const coversViteConfig = (include as unknown[]).some(
    (entry) => entry === "vite.config.ts" || entry === "./vite.config.ts",
  );
  if (!coversViteConfig) return false;
  return effectiveNoEmit(root, rel, new Set()) === true;
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
 *  5. if `compilerOptions.rootDir` is set it must be "src" or "./src" (narrow
 *     Vite-app noEmit exception: apps/ + rootDir "." + root vite.config.ts
 *     include + effective inherited noEmit true)
 *  6. `extends` must be `@cellix/config-typescript/node` | `base` | `vitest`
 *     (CellixJS apps/packages compose this way; never extend the repo-root stub tsconfig.json)
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
    const fileExemptions = exemptions[rel];
    const skip = (rule: string): boolean =>
      fileExemptions?.rules.includes(rule) ?? false;

    const allowedExtends = new Set([
      "@cellix/config-typescript/node",
      "@cellix/config-typescript/base",
      "@cellix/config-typescript/vitest",
    ]);
    const extendsField = (json as Record<string, unknown>)["extends"];
    if (!skip("extends")) {
      if (typeof extendsField !== "string" || !allowedExtends.has(extendsField)) {
        violations.push(
          `${rel}: extends is ${JSON.stringify(extendsField)} -- CellixJS apps/packages extend @cellix/config-typescript/node|base|vitest (never the repo-root tsconfig stub)`,
        );
      }
    }

    if (!co || typeof co !== "object") continue;

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

    // Rule 5: rootDir must be "src" or "./src" (or the Vite-app noEmit exception)
    if (
      !skip("rootDir") &&
      "rootDir" in co &&
      co["rootDir"] !== "src" &&
      co["rootDir"] !== "./src" &&
      !isViteNoEmitAppException(root, rel, json, co)
    ) {
      violations.push(
        `${rel}: compilerOptions.rootDir is ${JSON.stringify(co["rootDir"])} -- must be "src" or "./src"`,
      );
    }
  }

  return violations;
}
