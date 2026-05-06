import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateGitHubPagesSite } from "./check-github-pages-site.js";

describe("GitHub Pages static site", () => {
  it("exposes a package validator and includes it in the unattended agent gate", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["pages:validate"]).toBe(
      "tsx tools/openclinxr/check-github-pages-site.ts",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm pages:validate");
  });

  it("keeps the static branch-source Pages site wired", async () => {
    await expect(validateGitHubPagesSite()).resolves.toEqual({
      passed: true,
      blockers: [],
    });
  });
});
