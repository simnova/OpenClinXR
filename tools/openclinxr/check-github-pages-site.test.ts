import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { rename } from "node:fs/promises";
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
    const workflowPath = ".github/workflows/pages.yml";
    const indexPath = "docs/index.html";
    const index = await readFile(indexPath, "utf8");
    let workflow: string | undefined;

    try {
      await access(workflowPath, constants.F_OK);
      workflow = await readFile(workflowPath, "utf8");
    } catch {
      workflow = undefined;
    }

    if (workflow) {
      const badWorkflowPath = "path: public";
      const previousWorkflow = workflow;
      await writeFile(workflowPath, workflow.replace("path: docs", badWorkflowPath), "utf8");
      try {
        const badWorkflowResult = await validateGitHubPagesSite();
        expect(badWorkflowResult.passed).toBe(false);
        expect(badWorkflowResult.blockers).toContain("pages_workflow_upload_path_missing");
      } finally {
        await writeFile(workflowPath, previousWorkflow, "utf8");
      }

      const workflowBackupPath = `${workflowPath}.codex-test-disabled`;
      const workflowWithoutConfig = workflowPath;
      await rename(workflowWithoutConfig, workflowBackupPath);
      try {
        const noWorkflowResult = await validateGitHubPagesSite();
        expect(noWorkflowResult.passed).toBe(true);
        expect(noWorkflowResult.blockers).not.toContain("pages_workflow_upload_path_missing");
      } finally {
        await rename(workflowBackupPath, workflowWithoutConfig);
      }
    }

    // Create a temporary copy with a broken GitHub link and ensure the validator catches it.
    const brokenIndex = index.replace(
      "openclinxr/local-ai-voice-model-strategy.md",
      "openclinxr/missing-voice-strategy.md",
    );
    try {
      await writeFile(indexPath, brokenIndex, "utf8");
      const brokenLinks = await validateGitHubPagesSite();
      expect(brokenLinks.passed).toBe(false);
      expect(
        brokenLinks.blockers,
      ).toContain("pages_index_github_link_missing:openclinxr/missing-voice-strategy.md");
    } finally {
      await writeFile(indexPath, index, "utf8");
    }
  });
});
