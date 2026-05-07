import { readFile, writeFile } from "node:fs/promises";
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

  it("validates upload-path wiring and tracked GitHub doc links", async () => {
    const workflow = await readFile(".github/workflows/pages.yml", "utf8");
    const index = await readFile("docs/index.html", "utf8");
    const previousWorkflow = workflow.replace("path: docs", "path: docs");
    const workflowPath = ".github/workflows/pages.yml";
    const badWorkflowPath = "path: public";
    try {
      await writeFile(workflowPath, workflow.replace("path: docs", badWorkflowPath), "utf8");
      const badWorkflowResult = await validateGitHubPagesSite();
      expect(badWorkflowResult.passed).toBe(false);
      expect(badWorkflowResult.blockers).toContain("pages_workflow_upload_path_missing");
    } finally {
      await writeFile(workflowPath, previousWorkflow, "utf8");
    }

    // Create a temporary copy with a broken GitHub link and ensure the validator catches it.
    const brokenIndex = index.replace(
      "openclinxr/local-ai-voice-model-strategy.md",
      "openclinxr/missing-voice-strategy.md",
    );
    try {
      await writeFile("docs/index.html", brokenIndex, "utf8");
      const brokenLinks = await validateGitHubPagesSite();
      expect(brokenLinks.passed).toBe(false);
      expect(
        brokenLinks.blockers,
      ).toContain("pages_index_github_link_missing:openclinxr/missing-voice-strategy.md");
    } finally {
      await writeFile("docs/index.html", index, "utf8");
      await writeFile(".github/workflows/pages.yml", previousWorkflow, "utf8");
    }
  });
});
