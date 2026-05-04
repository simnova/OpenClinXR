import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { findUnsafeClaimLanguage } from "@openclinxr/domain";
import { projectFiles } from "archunit";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const archTsconfig = "../../../tsconfig.archunit.json";
const workspaceRoot = findWorkspaceRoot();
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const paidCloudProviderDependencies = [
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/groq",
  "@ai-sdk/openai",
  "@ai-sdk/xai",
  "@anthropic-ai/sdk",
  "@aws-sdk/client-bedrock-runtime",
  "@azure/openai",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
  "groq-sdk",
  "mistralai",
  "openai",
  "xai-sdk",
] as const;
const paidCloudProviderEnvKeys = [
  "ANTHROPIC_API_KEY",
  "AWS_BEDROCK_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "COHERE_API_KEY",
  "GOOGLE_API_KEY",
  "GROK_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
] as const;

type DependencyField = typeof dependencyFields[number];

type WorkspaceDependencyReference = {
  manifestPath: string;
  field: DependencyField;
  dependency: string;
};

type SourceImportReference = {
  filePath: string;
  specifier: string;
};

type SourceTextReference = {
  filePath: string;
  sourceText: string;
};

type MongoMemoryServerBoundaryInput = {
  manifestDependencies: WorkspaceDependencyReference[];
  sourceReferences: SourceImportReference[];
};

type PaidProviderBoundaryInput = {
  manifestDependencies: WorkspaceDependencyReference[];
  sourceReferences: SourceImportReference[];
  envKeyReferences: Array<{ filePath: string; envKey: string }>;
};

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

  it("exposes IWSDK spike verification as an explicit opt-in lane outside the default verify gate", () => {
    const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/iwsdk-spike typecheck");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/iwsdk-spike test");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:contract:tests");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:preinstall");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:workspace:posture");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm iwsdk:evidence:validate");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/architecture-rules typecheck");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm --filter @openclinxr/architecture-rules test");
    expect(rootPackage.scripts?.["iwsdk:verify"]).toContain("pnpm agent:sources");
    expect(rootPackage.scripts?.verify).not.toContain("iwsdk:verify");
  });

  it("keeps the implementation plan explicit about the IWSDK sidecar policy", () => {
    const implementationPlan = readFileSync(join(workspaceRoot, "docs/openclinxr/code-implementation-plan.md"), "utf8");

    expect(implementationPlan).toContain("IWSDK Sidecar Policy");
    expect(implementationPlan).toContain("apps/ui-xr-iwsdk-spike");
    expect(implementationPlan).toContain("pnpm iwsdk:verify");
    expect(implementationPlan).toContain("@iwsdk/core");
    expect(implementationPlan).toContain("@iwsdk/xr-input");
    expect(implementationPlan).toContain("@iwsdk/reference");
    expect(implementationPlan).toContain("@meta-quest/hzdb");
    expect(implementationPlan).toContain("apps/ui-xr");
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

  it("reports route telemetry attributes that include station-run identity", () => {
    const violations = findRouteTelemetryIdentityViolations([
      {
        filePath: "packages/openclinxr/test-harness/src/benchmark-report.ts",
        sourceText: `
          telemetryRouteAttributes({
            routeId: "actor-response",
            stationRunId: routeMatch.params.stationRunId,
          });
        `,
      },
    ]);

    expect(violations).toEqual(["packages/openclinxr/test-harness/src/benchmark-report.ts:telemetryRouteAttributes.stationRunId"]);
  });

  it("keeps runtime route telemetry low-cardinality and free of station-run identity", () => {
    expect(findRouteTelemetryIdentityViolations(routeTelemetryPolicySourceFiles())).toEqual([]);
  });

  it("keeps Mongoose data sources out of station runtime and trace-ledger dependencies", () => {
    const forbiddenImports = /@openclinxr\/(?:scenario-runtime|trace-ledger|model-gateway|voice-gateway)|apps\//;
    const violations = filesWithContentMatching("packages/openclinxr/data-sources-mongoose-models", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("reports mongodb-memory-server when it leaks outside dev-only data package test infrastructure", () => {
    const violations = findMongoMemoryServerBoundaryViolations({
      manifestDependencies: [
        {
          manifestPath: "apps/api/package.json",
          field: "dependencies",
          dependency: "mongodb-memory-server",
        },
        {
          manifestPath: "packages/openclinxr/data-mongodb/package.json",
          field: "dependencies",
          dependency: "mongodb-memory-server",
        },
        {
          manifestPath: "packages/openclinxr/data-mongodb/package.json",
          field: "devDependencies",
          dependency: "mongodb-memory-server",
        },
      ],
      sourceReferences: [
        {
          filePath: "apps/api/src/app.ts",
          specifier: "mongodb-memory-server",
        },
        {
          filePath: "packages/openclinxr/data-mongodb/src/mongo-memory-context.ts",
          specifier: "mongodb-memory-server",
        },
      ],
    });

    expect(violations).toEqual([
      "manifest:apps/api/package.json:dependencies.mongodb-memory-server",
      "manifest:packages/openclinxr/data-mongodb/package.json:dependencies.mongodb-memory-server",
      "source:apps/api/src/app.ts:mongodb-memory-server",
    ]);
  });

  it("keeps mongodb-memory-server confined to dev-only data package test infrastructure", () => {
    expect(findMongoMemoryServerBoundaryViolations(scanMongoMemoryServerBoundary())).toEqual([]);
  });

  it("keeps the data-mongodb public barrel free of Mongo memory test helpers", () => {
    const publicBarrel = readFileSync(join(workspaceRoot, "packages/openclinxr/data-mongodb/src/index.ts"), "utf8");

    expect(publicBarrel).not.toContain("mongo-memory-context");
  });

  it("keeps the agent-loop orchestration package independent from app and station runtime code", () => {
    const forbiddenImports = /@openclinxr\/(?:scenario-runtime|data-|data-sources-|model-gateway|voice-gateway|trace-ledger)|apps\//;
    const violations = filesWithContentMatching("packages/openclinxr/agent-loop", forbiddenImports);

    expect(violations).toEqual([]);
  });

  it("reports paid cloud provider SDKs and credentials when they leak into default runtime paths", () => {
    const violations = findPaidProviderBoundaryViolations({
      manifestDependencies: [
        {
          manifestPath: "packages/openclinxr/model-gateway/package.json",
          field: "dependencies",
          dependency: "openai",
        },
      ],
      sourceReferences: [
        {
          filePath: "packages/openclinxr/model-gateway/src/openai-adapter.ts",
          specifier: "openai",
        },
      ],
      envKeyReferences: [
        {
          filePath: "apps/api/src/cloud-adapter.ts",
          envKey: "OPENAI_API_KEY",
        },
      ],
    });

    expect(violations).toEqual([
      "env:apps/api/src/cloud-adapter.ts:OPENAI_API_KEY",
      "manifest:packages/openclinxr/model-gateway/package.json:dependencies.openai",
      "source:packages/openclinxr/model-gateway/src/openai-adapter.ts:openai",
    ]);
  });

  it("keeps paid cloud model and voice SDKs out of default local runtime manifests and source", () => {
    expect(findPaidProviderBoundaryViolations(scanPaidProviderBoundary())).toEqual([]);
  });

  it("scans package scripts, config files, env templates, and tools for paid provider credentials", () => {
    expect(paidProviderPolicyTextFiles()).toEqual(expect.arrayContaining([
      ".env.openclinxr.local.example",
      "package.json",
      "turbo.json",
      "vitest.config.ts",
      "apps/api/tsdown.config.ts",
      "apps/ui-xr/vite.config.ts",
      "tools/openclinxr/local-provider-benchmark.ts",
    ]));
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
    const blockedDependencies = ["@iwsdk/create", "@iwsdk/reference", "@iwsdk/starter-assets", "@meta-quest/hzdb"];
    const manifestViolations = workspacePackageDependencyFindings(blockedDependencies);
    const lockfileText = readFileSync(join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
    const lockfileViolations = blockedDependencies.filter((dependency) => lockfileContainsDependency(lockfileText, dependency));

    expect([...manifestViolations, ...lockfileViolations.map((dependency) => `pnpm-lock.yaml:${dependency}`)]).toEqual([]);
  });

  it("keeps the approved IWSDK sidecar limited to Phase 1 packages", () => {
    const sidecarManifestPath = join(workspaceRoot, "apps/ui-xr-iwsdk-spike/package.json");
    expect(existsSync(sidecarManifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(sidecarManifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toMatchObject({
      "@iwsdk/core": "0.3.1",
      "@iwsdk/xr-input": "0.3.1",
      "three": "0.184.0",
    });
    expect(manifest.devDependencies).toMatchObject({
      "@types/three": "0.184.0",
      "typescript": "6.0.3",
      "vite": "8.0.10",
      "vitest": "4.1.5",
    });
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((dependency) =>
      dependency.startsWith("@iwsdk/") && !["@iwsdk/core", "@iwsdk/xr-input"].includes(dependency)
    )).toEqual([]);
  });

  it("keeps a future IWSDK sidecar from importing production ui-xr app internals", async () => {
    const sidecarRoot = join(workspaceRoot, "apps/ui-xr-iwsdk-spike");
    if (!existsSync(sidecarRoot)) {
      return;
    }

    const sourceImportViolations = findSidecarProductionUiCouplings();
    const archUnitViolations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-xr-iwsdk-spike/src/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("apps/ui-xr/src/**")
      .check();

    expect([...sourceImportViolations, ...archUnitViolations]).toEqual([]);
  }, 20_000);

  it("keeps IWSDK lockfile packages absent while the sidecar app is absent", () => {
    if (existsSync(join(workspaceRoot, "apps/ui-xr-iwsdk-spike"))) {
      return;
    }

    const lockfileText = readFileSync(join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
    const lockfileViolations = findIwsdkLockfilePackages(lockfileText).map((dependency) => `pnpm-lock.yaml:${dependency}`);

    expect(lockfileViolations).toEqual([]);
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

function routeTelemetryPolicySourceFiles(): SourceTextReference[] {
  return [...typescriptFilesUnder("apps"), ...typescriptFilesUnder("packages"), ...typescriptFilesUnder("tools")]
    .filter((filePath) => !/\.test\.tsx?$/.test(filePath))
    .filter((filePath) => !filePath.includes("/generated/"))
    .map((filePath) => ({
    filePath,
    sourceText: readFileSync(join(workspaceRoot, filePath), "utf8"),
  }));
}

function findRouteTelemetryIdentityViolations(files: SourceTextReference[]): string[] {
  return files.flatMap(({ filePath, sourceText }) => {
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations: string[] = [];

    function visit(node: ts.Node): void {
      if (isTelemetryRouteAttributesCall(node) && callIncludesStationRunIdAttribute(node)) {
        violations.push(`${filePath}:telemetryRouteAttributes.stationRunId`);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return violations;
  }).sort();
}

function isTelemetryRouteAttributesCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "telemetryRouteAttributes";
}

function callIncludesStationRunIdAttribute(node: ts.CallExpression): boolean {
  const firstArgument = node.arguments[0];
  if (!firstArgument || !ts.isObjectLiteralExpression(firstArgument)) {
    return false;
  }

  return firstArgument.properties.some((property) =>
    ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === "stationRunId"
  );
}

function packageManifestFiles(): string[] {
  return walk(workspaceRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => filePath.endsWith("package.json"))
    .filter((filePath) => !filePath.includes("/node_modules/") && !filePath.includes("/dist/"));
}

function workspacePackageDependencyReferences(dependencies: string[]): WorkspaceDependencyReference[] {
  return packageManifestFiles().flatMap((filePath) => {
    const packageJson = JSON.parse(readFileSync(join(workspaceRoot, filePath), "utf8")) as Record<string, Record<string, string>>;

    return dependencyFields.flatMap((field) =>
      dependencies
        .filter((dependency) => packageJson[field]?.[dependency])
        .map((dependency) => ({ manifestPath: filePath, field, dependency })),
    );
  });
}

function workspacePackageDependencyFindings(blockedDependencies: string[]): string[] {
  return workspacePackageDependencyReferences(blockedDependencies).map(({ manifestPath, field, dependency }) =>
    `${manifestPath}:${field}.${dependency}`
  );
}

function scanMongoMemoryServerBoundary(): MongoMemoryServerBoundaryInput {
  return {
    manifestDependencies: workspacePackageDependencyReferences(["mongodb-memory-server"]),
    sourceReferences: sourceImportReferences("mongodb-memory-server"),
  };
}

function scanPaidProviderBoundary(): PaidProviderBoundaryInput {
  const policyTextFiles = paidProviderPolicyTextFiles();

  return {
    manifestDependencies: workspacePackageDependencyReferences([...paidCloudProviderDependencies]),
    sourceReferences: paidCloudProviderDependencies.flatMap((dependency) => sourceImportReferences(dependency, policyTextFiles)),
    envKeyReferences: findEnvKeyReferences(policyTextFiles, [...paidCloudProviderEnvKeys]),
  };
}

function findPaidProviderBoundaryViolations(input: PaidProviderBoundaryInput): string[] {
  return [
    ...input.envKeyReferences.map(({ filePath, envKey }) => `env:${filePath}:${envKey}`),
    ...input.manifestDependencies.map(({ manifestPath, field, dependency }) =>
      `manifest:${manifestPath}:${field}.${dependency}`
    ),
    ...input.sourceReferences.map(({ filePath, specifier }) => `source:${filePath}:${specifier}`),
  ].sort();
}

function findMongoMemoryServerBoundaryViolations(input: MongoMemoryServerBoundaryInput): string[] {
  return [
    ...input.manifestDependencies
      .filter(({ dependency }) => dependency === "mongodb-memory-server")
      .filter(({ manifestPath, field }) =>
        field !== "devDependencies"
        || ![
          "packages/openclinxr/data-mongodb/package.json",
          "packages/openclinxr/data-sources-mongoose-models/package.json",
        ].includes(manifestPath)
      )
      .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`),
    ...input.sourceReferences
      .filter(({ specifier }) => specifier === "mongodb-memory-server" || specifier.startsWith("mongodb-memory-server/"))
      .filter(({ filePath }) => !isAllowedMongoMemoryServerSource(filePath))
      .map(({ filePath, specifier }) => `source:${filePath}:${specifier}`),
  ].sort();
}

function isAllowedMongoMemoryServerSource(filePath: string): boolean {
  return [
    /^packages\/openclinxr\/data-mongodb\/src\/(?:.*\.test\.ts|mongo-memory-context\.ts)$/,
    /^packages\/openclinxr\/data-sources-mongoose-models\/src\/(?:.*\.test\.ts|mongoose-memory-context\.ts)$/,
  ].some((pattern) => pattern.test(filePath));
}

function sourceImportReferences(specifier: string, files = [...sourceFilesUnder("apps"), ...sourceFilesUnder("packages")]): SourceImportReference[] {
  const importPattern = new RegExp(
    `(?:from\\s+["'](${escapeRegExp(specifier)}(?:/[^"']*)?)["']|import\\s*\\(\\s*["'](${escapeRegExp(specifier)}(?:/[^"']*)?)["']\\s*\\))`,
    "g",
  );

  return files.flatMap((filePath) => {
    const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
    return [...sourceText.matchAll(importPattern)].map((match) => ({
      filePath,
      specifier: match[1] ?? match[2] ?? specifier,
    }));
  });
}

function runtimePolicySourceFiles(): string[] {
  return [...typescriptFilesUnder("apps"), ...typescriptFilesUnder("packages"), ...typescriptFilesUnder("tools")]
    .filter((filePath) => !/\.test\.tsx?$/.test(filePath))
    .filter((filePath) => !filePath.includes("/generated/"));
}

function paidProviderPolicyTextFiles(): string[] {
  return [...new Set([
    ...runtimePolicySourceFiles(),
    ...packageManifestFiles(),
    ...workspaceConfigAndEnvFiles(),
  ])].sort();
}

function workspaceConfigAndEnvFiles(): string[] {
  return walk(workspaceRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) =>
      filePath.startsWith(".env")
      || filePath === "turbo.json"
      || filePath === "pnpm-workspace.yaml"
      || /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(filePath)
      || /(^|\/)(?:vite|vitest|tsdown|rolldown|biome|eslint|storybook|codegen|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(filePath)
    );
}

function typescriptFilesUnder(root: string): string[] {
  const absoluteRoot = join(workspaceRoot, root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  return walk(absoluteRoot)
    .map((filePath) => relative(workspaceRoot, filePath).split(sep).join("/"))
    .filter((filePath) => /\.tsx?$/.test(filePath));
}

function findEnvKeyReferences(files: string[], envKeys: string[]): Array<{ filePath: string; envKey: string }> {
  return files.flatMap((filePath) => {
    const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
    return envKeys
      .filter((envKey) => new RegExp(`\\b${escapeRegExp(envKey)}\\b`).test(sourceText))
      .map((envKey) => ({ filePath, envKey }));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lockfileContainsDependency(lockfileText: string, dependency: string): boolean {
  const escapedDependency = dependency.replaceAll("/", "\\/").replaceAll("@", "\\@");
  return new RegExp(`(?:^|\\n)\\s*(?:${escapedDependency}:|/${escapedDependency}@)`).test(lockfileText);
}

function findIwsdkLockfilePackages(lockfileText: string): string[] {
  return [...new Set([...lockfileText.matchAll(/(?:^|\n)\s*\/?(@iwsdk\/[^@\s:]+|@meta-quest\/hzdb)@/g)]
    .map((match) => match[1])
    .filter((dependency): dependency is string => Boolean(dependency)))];
}

function findSidecarProductionUiCouplings(): string[] {
  const sidecarSourceFiles = sourceFilesUnder("apps/ui-xr-iwsdk-spike");
  const sourceImportPattern =
    /(?:from\s*["']|import\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])([^"']+)/g;
  const sourceViolations = sidecarSourceFiles.flatMap((filePath) => {
    const sourceText = readFileSync(join(workspaceRoot, filePath), "utf8");
    return [...sourceText.matchAll(sourceImportPattern)]
      .map((match) => match[1])
      .filter((specifier): specifier is string => Boolean(specifier))
      .filter((specifier) => sidecarImportTargetsProductionUi(filePath, specifier))
      .map((specifier) => `source:${filePath}:${specifier}`);
  });
  const manifestViolations = workspacePackageDependencyReferences(["@openclinxr/ui-xr"])
    .filter(({ manifestPath }) => manifestPath === "apps/ui-xr-iwsdk-spike/package.json")
    .map(({ manifestPath, field, dependency }) => `manifest:${manifestPath}:${field}.${dependency}`);

  return [...manifestViolations, ...sourceViolations].sort();
}

function sidecarImportTargetsProductionUi(importerFilePath: string, specifier: string): boolean {
  if (specifier === "@openclinxr/ui-xr" || specifier.startsWith("@openclinxr/ui-xr/")) {
    return true;
  }
  if (specifier.includes("apps/ui-xr/src")) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolvedPath = join(workspaceRoot, dirname(importerFilePath), specifier);
  return relative(join(workspaceRoot, "apps/ui-xr/src"), resolvedPath).split(sep).join("/").startsWith("..") === false;
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
