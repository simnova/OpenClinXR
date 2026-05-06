import { readFile } from "node:fs/promises";
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

  blockers.push(...[
    indexHtml.includes("<title>OpenClinXR</title>") ? undefined : "pages_index_title_missing",
    indexHtml.includes('href="styles.css"') ? undefined : "pages_index_stylesheet_link_missing",
    indexHtml.includes('src="assets/openclinxr-xr-evidence.png"') ? undefined : "pages_index_visual_asset_missing",
    indexHtml.includes("https://github.com/simnova/OpenClinXR") ? undefined : "pages_index_repo_link_missing",
    indexHtml.includes("Evidence Docs") ? undefined : "pages_index_evidence_docs_link_missing",
    styles.includes("@media (max-width: 860px)") ? undefined : "pages_styles_mobile_breakpoint_missing",
    readme.includes("https://simnova.github.io/OpenClinXR/") ? undefined : "readme_pages_url_missing",
    readme.includes("main") && readme.includes("/docs") ? undefined : "readme_pages_source_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string"));

  return {
    passed: blockers.length === 0,
    blockers,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
