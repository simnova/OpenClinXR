import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Decision invariants — architecture rules that lock in DECISIONS, not just shapes.
 *
 * Each violation message states WHY the decision was made and points at the record, because the
 * person who trips a rule is usually not the person who made the call. A rule that only says
 * "this is wrong" gets worked around or exempted to make CI green; a rule that explains itself
 * gets respected, or deliberately revisited.
 *
 * Sources: MADR 0033 (build-emitting packages) and findings from the 2026-08-05 migration.
 */

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 12; index += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const workspaceRoot = findWorkspaceRoot();

type PackageManifest = {
  name?: string;
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
};

function workspacePackageDirs(): string[] {
  const dirs: string[] = [];
  const walk = (relative: string, depth: number): void => {
    if (depth > 4) return;
    const absolute = join(workspaceRoot, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = `${relative}/${entry.name}`;
      if (existsSync(join(workspaceRoot, child, "package.json"))) dirs.push(child);
      walk(child, depth + 1);
    }
  };
  walk("packages", 0);
  walk("apps", 0);
  return dirs;
}

function readManifest(relativeDir: string): PackageManifest | undefined {
  try {
    return JSON.parse(readFileSync(join(workspaceRoot, relativeDir, "package.json"), "utf8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

/** A package is "build-emitting" when its exports resolve into dist/ rather than src/. */
function emitsBuild(manifest: PackageManifest): boolean {
  return JSON.stringify(manifest.exports ?? {}).includes("./dist/");
}

/**
 * DECISION (MADR 0033): a build-emitting package MUST also ship `tsconfig.vitest.json`.
 *
 * The build tsconfig excludes `*.test.ts` so tests do not land in `dist`. That same exclusion
 * removes them from typechecking — silently. Without the second config a package keeps passing
 * `typecheck` while its tests are no longer typechecked at all. Found by piloting the migration;
 * it would otherwise have regressed every migrated package invisibly.
 */
export function checkBuildEmittingPackagesTypecheckTests(): string[] {
  const violations: string[] = [];
  for (const dir of workspacePackageDirs()) {
    const manifest = readManifest(dir);
    if (!manifest || !emitsBuild(manifest)) continue;
    if (!existsSync(join(workspaceRoot, dir, "tsconfig.vitest.json"))) {
      violations.push(
        `${dir}: exports resolve to dist/ (build-emitting) but there is no tsconfig.vitest.json. `
        + `WHY THIS MATTERS: the build tsconfig excludes *.test.ts so tests stay out of dist — which also `
        + `removes them from typechecking. Without tsconfig.vitest.json this package's tests are NOT `
        + `typechecked, and typecheck will still pass, so the loss is invisible. `
        + `FIX: pnpm exec tsx tools/openclinxr/migrate-package-to-build-emitting.ts ${dir}  (see MADR 0033).`,
      );
    }
    if (!manifest.scripts?.["build"]) {
      violations.push(
        `${dir}: exports resolve to dist/ but no "build" script exists, so nothing produces dist. `
        + `Consumers will fail to resolve this package. FIX: add "build": "tsgo --build" (MADR 0033).`,
      );
    }
  }
  return violations;
}

/**
 * DECISION (MADR 0033 rollout): config packages stay SOURCE-FIRST.
 *
 * They export entrypoints consumed by other packages' vitest/rolldown configs at tool-load time.
 * Emitting them to dist means the config would have to be built before any test could run — a
 * bootstrapping cycle. Upstream cellix keeps its config package unmigrated for the same reason.
 */
const SOURCE_FIRST_CONFIG_PACKAGES = [
  "packages/cellix/config-vitest",
  "packages/cellix/config-typescript",
  "packages/openclinxr/config-rolldown",
] as const;

export function checkConfigPackagesStaySourceFirst(): string[] {
  const violations: string[] = [];
  for (const dir of SOURCE_FIRST_CONFIG_PACKAGES) {
    const manifest = readManifest(dir);
    if (!manifest) continue;
    if (emitsBuild(manifest)) {
      violations.push(
        `${dir}: config package must NOT be build-emitting. `
        + `WHY: it exports entrypoints that other packages' vitest/rolldown configs load at TOOL-LOAD time. `
        + `Emitting to dist means the config must be built before any test can run — a bootstrapping cycle. `
        + `This is a deliberate exclusion from the MADR 0033 migration, not an unfinished package.`,
      );
    }
  }
  return violations;
}

/**
 * DECISION (2026-08-05): at most ONE language server may claim a given file extension.
 *
 * `knip-language-server` was registered alongside `typescript-language-server` for `.ts`. Knip's LSP
 * implements only a narrow surface, so semantic requests (findReferences, goToDefinition, hover)
 * were dispatched to it and returned "Unhandled method". It presented as "the LSP is broken" rather
 * than "there is a conflict", and cost real debugging time. Single-purpose tools belong on the CLI.
 */
export function checkNoDuplicateLspExtensionClaims(): string[] {
  const lspConfigPath = join(workspaceRoot, ".grok/lsp.json");
  if (!existsSync(lspConfigPath)) return [];

  let servers: Record<string, { extensionToLanguage?: Record<string, string> }>;
  try {
    servers = JSON.parse(readFileSync(lspConfigPath, "utf8")) as typeof servers;
  } catch {
    return []; // an unparseable config is a different problem; fail open here
  }

  const claims = new Map<string, string[]>();
  for (const [serverName, config] of Object.entries(servers)) {
    for (const extension of Object.keys(config?.extensionToLanguage ?? {})) {
      claims.set(extension, [...(claims.get(extension) ?? []), serverName]);
    }
  }

  return [...claims.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([extension, owners]) =>
      `.grok/lsp.json: extension "${extension}" is claimed by ${owners.length} servers (${owners.join(", ")}). `
      + `WHY THIS MATTERS: a narrower server shadows a richer one — semantic requests are dispatched to `
      + `whichever wins and fall through as "Unhandled method". It presents as "the LSP is broken" rather `
      + `than "there is a conflict". Register ONE server per extension; run single-purpose tools (lint, `
      + `dead-code) via their CLI instead.`,
    );
}

/**
 * DECISION (2026-08-05 dispatch-chokepoint): raw headless `grok -p` must not be a silent
 * convention — a PreToolUse shell matcher refuses it unless a named logged escape is set.
 *
 * WHY: layers 3–6 of merge-safety hang off `dispatch()`; a raw spawn skips contract, baseline,
 * proofs, and loop-pause. Prose in rules lost to a delegate optimising for finishing.
 *
 * HONEST CLAIM locked here: the mechanism is a **string matcher** over shell-tool command text
 * (not an OS sandbox). Architecture only asserts the machinery files remain present and wired —
 * capability residual is documented in tools/openclinxr/openclaw/dispatch-chokepoint.ts.
 */
export function checkDispatchChokepointWired(): string[] {
  const violations: string[] = [];
  const hookPath = join(workspaceRoot, ".grok/hooks/dispatch-chokepoint.json");
  const srcPath = join(workspaceRoot, "tools/openclinxr/openclaw/dispatch-chokepoint.ts");
  const testPath = join(workspaceRoot, "tools/openclinxr/openclaw/dispatch-chokepoint.test.ts");
  const dispatchPath = join(workspaceRoot, "tools/openclinxr/openclaw/dispatch-worker.ts");

  if (!existsSync(hookPath)) {
    violations.push(
      `.grok/hooks/dispatch-chokepoint.json missing. `
      + `WHY: without the PreToolUse hook, raw \`grok -p\` is only a prose convention again.`,
    );
  } else {
    try {
      const hook = JSON.parse(readFileSync(hookPath, "utf8")) as {
        hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
      };
      const groups = hook.hooks?.PreToolUse ?? [];
      const matcherOk = groups.some((g) => /Bash|run_terminal_command/.test(g.matcher ?? ""));
      const commandOk = groups.some((g) =>
        (g.hooks ?? []).some((h) => (h.command ?? "").includes("dispatch-chokepoint")),
      );
      if (!matcherOk) {
        violations.push(
          `.grok/hooks/dispatch-chokepoint.json: PreToolUse matcher must cover Bash|run_terminal_command `
          + `(shell is how delegates spawn raw grok).`,
        );
      }
      if (!commandOk) {
        violations.push(
          `.grok/hooks/dispatch-chokepoint.json: hook command must invoke dispatch-chokepoint.ts.`,
        );
      }
    } catch {
      violations.push(`.grok/hooks/dispatch-chokepoint.json: unparseable JSON.`);
    }
  }

  if (!existsSync(srcPath)) {
    violations.push(
      `tools/openclinxr/openclaw/dispatch-chokepoint.ts missing. `
      + `WHY: the refuse/allow evaluator + named escape live here.`,
    );
  } else {
    const src = readFileSync(srcPath, "utf8");
    for (const needle of [
      "OPENCLINXR_RAW_GROK_SANCTIONED",
      "OPENCLINXR_RAW_GROK_REASON",
      "evaluateRawGrokShellCommand",
      "string matcher",
    ] as const) {
      if (!src.includes(needle)) {
        violations.push(
          `tools/openclinxr/openclaw/dispatch-chokepoint.ts: missing required surface "${needle}". `
          + `WHY: sanction name, reason, evaluator, and honest "string matcher" claim must stay visible.`,
        );
      }
    }
  }

  if (!existsSync(testPath)) {
    violations.push(
      `tools/openclinxr/openclaw/dispatch-chokepoint.test.ts missing. `
      + `WHY: control/treatment (deny without sanction / allow with sanction) must stay machine-checked.`,
    );
  }

  if (!existsSync(dispatchPath)) {
    violations.push(
      `tools/openclinxr/openclaw/dispatch-worker.ts missing. `
      + `WHY: the chokepoint only makes sense if dispatch() remains the supported spawn path.`,
    );
  } else {
    const dispatchSrc = readFileSync(dispatchPath, "utf8");
    if (!dispatchSrc.includes("export async function dispatch")) {
      violations.push(
        `tools/openclinxr/openclaw/dispatch-worker.ts: must export async function dispatch `
        + `(the one supported headless worker entry).`,
      );
    }
  }

  return violations;
}
