import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

const archTsconfig = "../../../tsconfig.archunit.json";

describe("workspace architecture rules", () => {
  it("keeps project-specific packages under packages/openclinxr", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("packages/**/src/**")
      .should()
      .adhereTo(
        (file) => file.path.startsWith("packages/openclinxr/") || file.path.startsWith("packages/cellix/"),
        "package source must live under packages/openclinxr or packages/cellix",
      )
      .check();

    expect(violations).toEqual([]);
  });

  it("keeps Cellix package copies free of OpenClinXR product semantics", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("packages/cellix/**/src/**")
      .should()
      .adhereTo(
        (file) => !/@openclinxr\/|OpenClinXR|openclinxr/.test(file.content),
        "packages/cellix code may receive dependency upgrades and required compatibility changes but must not gain OpenClinXR-specific product semantics",
      )
      .check({ allowEmptyTests: true });

    expect(violations).toEqual([]);
  });

  it("requires changelogs for evolved Cellix package copies", () => {
    const cellixPackageDirs = workspacePackageDirs("packages/cellix");
    const missingChangelogs = cellixPackageDirs.filter((packageDir) => !existsSync(join(packageDir, "CHANGELOG.md")));

    expect(missingChangelogs).toEqual([]);
  });

  it("keeps source folders inside approved app naming conventions", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/**/src/**")
      .should()
      .adhereTo(
        (file) =>
          file.path.startsWith("apps/api/src/")
          || /^apps\/ui-[^/]+\/src\//.test(file.path)
          || /^apps\/mock-[^/]+-server\/src\//.test(file.path),
        "app source must live under apps/api, apps/ui-<portal>, or apps/mock-<server-type>-server",
      )
      .check();

    expect(violations).toEqual([]);
  });

  it("prevents UI app shells from importing backend persistence packages", async () => {
    const forbiddenImports = /@openclinxr\/(?:data-|data-sources-|trace-ledger|scenario-runtime)/;
    const violations = await projectFiles(archTsconfig)
      .inFolder("apps/ui-*/src/**")
      .should()
      .adhereTo(
        (file) => !forbiddenImports.test(file.content),
        "UI portal code must use route/API contracts instead of importing backend persistence/runtime packages",
      )
      .check();

    expect(violations).toEqual([]);
  });

  it("keeps shared UI packages free of circular imports", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("packages/openclinxr/ui-*/src/**")
      .should()
      .haveNoCycles()
      .check();

    expect(violations).toEqual([]);
  });
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
