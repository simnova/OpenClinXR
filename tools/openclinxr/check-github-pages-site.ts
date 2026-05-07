import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ValidationResult = {
  passed: boolean;
  blockers: string[];
};

const requiredSiteFiles = [
  "docs/index.html",
  "docs/styles.css",
  "docs/.nojekyll",
  "docs/assets/openclinxr-xr-evidence.png",
  "README.md",
];

async function main(): Promise<void> {
  const result = await validateGitHubPagesSite();
  if (result.passed) {
    console.log("Validated GitHub Pages static site wiring.");
    return;
  }

  for (const blocker of result.blockers) {
    console.error(blocker);
  }
  process.exitCode = 1;
}

export async function validateGitHubPagesSite(): Promise<ValidationResult> {
  const blockers: string[] = [];
  const fileText = new Map<string, string>();
  const workflowPath = ".github/workflows/pages.yml";

  for (const file of requiredSiteFiles) {
    try {
      fileText.set(file, await readFile(file, "utf8"));
    } catch {
      blockers.push(`missing_required_pages_file:${file}`);
    }
  }

  const indexHtml = fileText.get("docs/index.html") ?? "";
  const styles = fileText.get("docs/styles.css") ?? "";
  const readme = fileText.get("README.md") ?? "";
  let workflow: string | undefined;
  try {
    await access(workflowPath, constants.F_OK);
    workflow = await readFile(workflowPath, "utf8");
  } catch {
    // Pages can be configured through repository settings without a committed workflow file.
  }

  blockers.push(...[
    indexHtml.includes("<title>OpenClinXR</title>") ? undefined : "pages_index_title_missing",
    indexHtml.includes('href="styles.css"') ? undefined : "pages_index_stylesheet_link_missing",
    indexHtml.includes('src="assets/openclinxr-xr-evidence.png"') ? undefined : "pages_index_visual_asset_missing",
    indexHtml.includes("https://github.com/simnova/OpenClinXR") ? undefined : "pages_index_repo_link_missing",
    indexHtml.includes("Evidence Docs") ? undefined : "pages_index_evidence_docs_link_missing",
    styles.includes("@media (max-width: 860px)") ? undefined : "pages_styles_mobile_breakpoint_missing",
    workflow
      ? workflow.includes("path: docs")
        ? undefined
        : "pages_workflow_upload_path_missing"
      : undefined,
    readme.includes("http://developers.simnova.com/OpenClinXR/") ? undefined : "readme_pages_url_missing",
    readme.includes("main") && readme.includes("/docs") ? undefined : "readme_pages_source_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string"));

  const indexLinks = extractGitHubLinks(indexHtml);
  for (const link of indexLinks) {
    try {
      await access(path.resolve(process.cwd(), link), constants.F_OK);
    } catch {
      blockers.push(`pages_index_github_link_missing:${link}`);
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
  };
}

function extractGitHubLinks(markup: string): string[] {
  const rawLinkPattern = /href="https:\/\/github\.com\/simnova\/OpenClinXR\/(blob|tree)\/main\/([^"]+)"/g;
  const links: string[] = [];
  for (const match of markup.matchAll(rawLinkPattern)) {
    const relativePath = match[2];
    if (typeof relativePath === "string") {
      links.push(relativePath);
    }
  }
  return links;
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
