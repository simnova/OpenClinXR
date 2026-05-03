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
