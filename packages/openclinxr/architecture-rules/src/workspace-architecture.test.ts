import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

const archTsconfig = "../../../tsconfig.archunit.json";

describe("workspace architecture rules", () => {
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

  it("keeps UI REST route catalog usage behind app-local API clients", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/rest/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath))
      .filter((filePath) => !/\/api-client(?:\.test)?\.ts$/.test(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps UI app GraphQL imports on generated documents instead of the executable server surface", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/graphql(?!\/documents)/)
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
  }, 20_000);

  it("keeps UI app source from depending on Mongo persistence source files", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-*/src/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("packages/openclinxr/data-*/src/**")
      .check();

    expect(violations).toEqual([]);
  }, 20_000);
});

function workspacePackageDirs(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((packageDir) => existsSync(join(packageDir, "package.json")));
}

function sourceFilesUnder(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return walk(root)
    .map((filePath) => relative(process.cwd(), filePath).split(sep).join("/"))
    .filter((filePath) => /\/src\/.*\.tsx?$/.test(filePath));
}

function filesWithContentMatching(root: string, pattern: RegExp): string[] {
  return sourceFilesUnder(root).filter((filePath) => pattern.test(readFileSync(filePath, "utf8")));
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
        return [];
      }
      return walk(childPath);
    }
    return entry.isFile() ? [childPath] : [];
  });
}
