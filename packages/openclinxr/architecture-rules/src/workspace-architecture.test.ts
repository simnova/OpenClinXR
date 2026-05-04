import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { findUnsafeClaimLanguage } from "@openclinxr/domain";
import { projectFiles } from "archunit";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const archTsconfig = "../../../tsconfig.archunit.json";
const workspaceRoot = findWorkspaceRoot();

describe("workspace architecture rules", () => {
  it("keeps root package quality gates delegated through Turborepo package tasks", () => {
    const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const packageScriptNames = [
      "packages:typecheck",
      "packages:test",
      "packages:build",
      "packages:typecheck:affected",
      "packages:test:affected",
      "packages:build:affected",
    ];

    expect(rootPackage.scripts?.["packages:typecheck"]).toContain("turbo run typecheck");
    expect(rootPackage.scripts?.["packages:test"]).toContain("turbo run test");
    expect(rootPackage.scripts?.["packages:build"]).toContain("turbo run build");
    expect(rootPackage.scripts?.["packages:typecheck:affected"]).toContain("turbo run typecheck --affected");
    expect(rootPackage.scripts?.["packages:test:affected"]).toContain("turbo run test --affected");
    expect(rootPackage.scripts?.["packages:build:affected"]).toContain("turbo run build --affected");
    for (const scriptName of packageScriptNames) {
      expect(rootPackage.scripts?.[scriptName]).toContain("TURBO_TELEMETRY_DISABLED=1");
      expect(rootPackage.scripts?.[scriptName]).toContain("DO_NOT_TRACK=1");
      expect(rootPackage.scripts?.[scriptName]).not.toMatch(/\bturbo\s+(?!run\b)(?:build|test|typecheck|dev)\b/);
    }
    expect(rootPackage.scripts?.typecheck).toContain("pnpm packages:typecheck");
    expect(rootPackage.scripts?.test).toContain("pnpm packages:test");
    expect(rootPackage.scripts?.typecheck).not.toContain("pnpm -r");
    expect(rootPackage.scripts?.test).not.toContain("pnpm -r");
  });

  it("keeps Turborepo cache artifacts out of tracked workspace files", () => {
    const trackedFiles = execFileSync("git", ["ls-files"], { cwd: workspaceRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const violations = trackedFiles
      .filter((filePath) => filePath.includes("/.turbo/") || filePath.startsWith(".turbo/"));

    expect(violations).toEqual([]);
  });

  it("keeps the API deploy bundle on the smoke-tested tsdown path with a Rolldown fallback", () => {
    const apiPackage = JSON.parse(readFileSync(join(workspaceRoot, "apps/api/package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsdownConfig = readFileSync(join(workspaceRoot, "apps/api/tsdown.config.ts"), "utf8");

    expect(apiPackage.scripts?.build).toBe("pnpm run package:azure");
    expect(apiPackage.scripts?.["build:azure"]).toContain("tsdown -c tsdown.config.ts");
    expect(apiPackage.scripts?.["build:azure:rolldown"]).toContain("rolldown -c rolldown.config.ts");
    expect(apiPackage.scripts?.["smoke:azure"]).toContain("pnpm run package:azure");
    expect(apiPackage.devDependencies?.tsdown).toMatch(/^\d+\.\d+\.\d+/);
    expect(tsdownConfig).toContain("onlyBundle");
    expect(tsdownConfig).toContain("neverBundle: [\"@azure/functions-core\"]");
    expect(tsdownConfig).toContain("alwaysBundle: [/^@openclinxr\\//, \"hono\", \"graphql\"]");
  });

  it("keeps project-specific packages under packages/openclinxr", () => {
    const violations = sourceFilesUnder("packages").filter(
      (filePath) => !filePath.startsWith("packages/openclinxr/") && !filePath.startsWith("packages/cellix/"),
    );

    expect(violations).toEqual([]);
  });

  it("keeps Cellix package copies free of OpenClinXR product semantics", () => {
    const violations = filesWithContentMatching("packages/cellix", /@openclinxr\/|OpenClinXR|openclinxr/);

    expect(violations).toEqual([]);
  });

  it("requires changelogs for evolved Cellix package copies", () => {
    const cellixPackageDirs = workspacePackageDirs("packages/cellix");
    const missingChangelogs = cellixPackageDirs.filter((packageDir) => !existsSync(join(packageDir, "CHANGELOG.md")));

    expect(missingChangelogs).toEqual([]);
  });

  it("keeps source folders inside approved app naming conventions", () => {
    const violations = sourceFilesUnder("apps").filter(
      (filePath) =>
        !filePath.startsWith("apps/api/src/")
        && !/^apps\/ui-[^/]+\/src\//.test(filePath)
        && !/^apps\/mock-[^/]+-server\/src\//.test(filePath),
    );

    expect(violations).toEqual([]);
  });

  it("prevents UI app shells from importing backend persistence packages", () => {
    const forbiddenImports = /@openclinxr\/(?:data-|data-sources-|trace-ledger|scenario-runtime)/;
    const violations = filesWithContentMatching("apps", forbiddenImports)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI app domain-contract imports behind app-local API clients", () => {
    const forbiddenImports = /@openclinxr\/(?:asset-registry|exam-assembly|model-gateway|voice-gateway|scenario-runtime|trace-ledger|data-|data-sources-)/;
    const violations = filesWithContentMatching("apps", forbiddenImports)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath))
      .filter((filePath) => !/\/api-client(?:\.test)?\.ts$/.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI app domain imports on the claim-language subpath", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/domain(?!\/claim-language\b)/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI REST route catalog usage behind app-local API clients", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/rest/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath))
      .filter((filePath) => !/\/api-client(?:\.test)?\.ts$/.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI app GraphQL imports on generated document subpaths instead of the executable server surface", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/graphql(?!\/(?:documents|client)\b)/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps the API app persistence-injected instead of importing concrete Mongo packages", () => {
    const forbiddenImports = /@openclinxr\/(?:data-mongodb|data-sources-mongoose-models)/;
    const violations = filesWithContentMatching("apps/api/src", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("keeps telemetry contracts independent from application and runtime packages", () => {
    const forbiddenImports = /@openclinxr\//;
    const violations = filesWithContentMatching("packages/openclinxr/telemetry", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("keeps Mongoose data sources out of station runtime and trace-ledger dependencies", () => {
    const forbiddenImports = /@openclinxr\/(?:scenario-runtime|trace-ledger|model-gateway|voice-gateway)|apps\//;
    const violations = filesWithContentMatching("packages/openclinxr/data-sources-mongoose-models", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("keeps the agent-loop orchestration package independent from app and station runtime code", () => {
    const forbiddenImports = /@openclinxr\/(?:scenario-runtime|data-|data-sources-|model-gateway|voice-gateway|trace-ledger)|apps\//;
    const violations = filesWithContentMatching("packages/openclinxr/agent-loop", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("keeps shared UI packages free of circular imports", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("packages/openclinxr/ui-*/src/**")
      .should()
      .haveNoCycles()
      .check();

    expect(violations).toEqual([]);
  }, 60_000);

  it("keeps the XR headset runtime on scenario fixture subpaths instead of the barrel", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-xr/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath("packages/openclinxr/scenario-fixtures/src/index.ts")
      .check();

    expect(violations).toEqual([]);
  }, 20_000);

  it("keeps Meta Immersive Web SDK dependencies isolated from production runtime paths", () => {
    const allowedSpikeRoots = ["apps/ui-xr-iwsdk-spike/", "packages/openclinxr/iwsdk-spike/"];
    const iwsdkImportPattern = /(?:from\s+["']|import\s*\(\s*["'])@iwsdk\//;
    const sourceViolations = [...sourceFilesUnder("apps"), ...sourceFilesUnder("packages")]
      .filter((filePath) => iwsdkImportPattern.test(readFileSync(join(workspaceRoot, filePath), "utf8")))
      .filter((filePath) => !allowedSpikeRoots.some((root) => filePath.startsWith(root)));
    const manifestViolations = packageManifestFiles()
      .filter((filePath) => /"@iwsdk\//.test(readFileSync(join(workspaceRoot, filePath), "utf8")))
      .filter((filePath) => !allowedSpikeRoots.some((root) => filePath.startsWith(root)));

    expect([...sourceViolations, ...manifestViolations]).toEqual([]);
  });

  it("keeps blocked IWSDK optional packages out of package manifests and the lockfile", () => {
    const blockedDependencies = ["@iwsdk/reference", "@meta-quest/hzdb"];
    const manifestViolations = workspacePackageDependencyFindings(blockedDependencies);
    const lockfileText = readFileSync(join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
    const lockfileViolations = blockedDependencies.filter((dependency) => lockfileContainsDependency(lockfileText, dependency));

    expect([...manifestViolations, ...lockfileViolations.map((dependency) => `pnpm-lock.yaml:${dependency}`)]).toEqual([]);
  });

  it("keeps UI app source from depending on Mongo persistence source files", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-*/src/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("packages/openclinxr/data-*/src/**")
      .check();

    expect(violations).toEqual([]);
  }, 20_000);

  it("keeps production UI source free of unsafe user-facing assessment claims", () => {
    const productionUiSource = [
      ...sourceFilesUnder("apps").filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath)),
      ...sourceFilesUnder("packages/openclinxr").filter((filePath) => /^packages\/openclinxr\/ui-[^/]+\/src\//.test(filePath)),
    ]
      .filter((filePath) => !filePath.includes(".test."))
      .filter((filePath) => filePath.endsWith(".tsx") || /^packages\/openclinxr\/ui-route-[^/]+\/src\/index\.ts$/.test(filePath));
    const violations = productionUiSource.flatMap((filePath) =>
      userFacingTextFragments(filePath).flatMap((fragment) =>
        findUnsafeClaimLanguage(fragment).map((finding) => ({
          filePath,
          ruleId: finding.ruleId,
          match: finding.match,
        })),
      ),
    );

    expect(violations).toEqual([]);
  });
});

function workspacePackageDirs(root: string): string[] {
  root = join(workspaceRoot, root);

  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((packageDir) => existsSync(join(packageDir, "package.json")));
}

function sourceFilesUnder(root: string): string[] {
  root = join(workspaceRoot, root);

  if (!existsSync(root)) {
    return [];
  }

  return walk(root)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => /\/src\/.*\.tsx?$/.test(filePath));
}

function filesWithContentMatching(root: string, pattern: RegExp): string[] {
  return sourceFilesUnder(root).filter((filePath) => pattern.test(readFileSync(join(workspaceRoot, filePath), "utf8")));
}

function packageManifestFiles(): string[] {
  return walk(workspaceRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => filePath.endsWith("package.json"))
    .filter((filePath) => !filePath.includes("/node_modules/") && !filePath.includes("/dist/"));
}

function workspacePackageDependencyFindings(blockedDependencies: string[]): string[] {
  const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

  return packageManifestFiles().flatMap((filePath) => {
    const packageJson = JSON.parse(readFileSync(join(workspaceRoot, filePath), "utf8")) as Record<string, Record<string, string>>;

    return dependencyFields.flatMap((field) =>
      blockedDependencies
        .filter((dependency) => packageJson[field]?.[dependency])
        .map((dependency) => `${filePath}:${field}.${dependency}`),
    );
  });
}

function lockfileContainsDependency(lockfileText: string, dependency: string): boolean {
  const escapedDependency = dependency.replaceAll("/", "\\/").replaceAll("@", "\\@");
  return new RegExp(`(?:^|\\n)\\s*(?:${escapedDependency}:|/${escapedDependency}@)`).test(lockfileText);
}

function userFacingTextFragments(filePath: string): string[] {
  const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fragments: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      fragments.push(node.text);
    } else if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).trim();
      if (text.length > 0) {
        fragments.push(text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return fragments;
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".git") {
        return [];
      }
      return walk(childPath);
    }
    return entry.isFile() ? [childPath] : [];
  });
}

function findWorkspaceRoot(): string {
  let candidate = process.cwd();

  while (true) {
    if (existsSync(join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error("Could not find workspace root containing pnpm-workspace.yaml");
    }
    candidate = parent;
  }
}
