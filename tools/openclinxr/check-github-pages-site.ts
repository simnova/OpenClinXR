import { access, constants, readFile } from "node:fs/promises";
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
  let workflow: string | undefined;
  try {
    workflow = await readFile(".github/workflows/pages.yml", "utf8");
  } catch {
    workflow = undefined;
  }

  blockers.push(...[
    indexHtml.includes("<title>OpenClinXR</title>") ? undefined : "pages_index_title_missing",
    indexHtml.includes('href="styles.css"') ? undefined : "pages_index_stylesheet_link_missing",
    indexHtml.includes('src="assets/openclinxr-xr-evidence.png"') ? undefined : "pages_index_visual_asset_missing",
    indexHtml.includes("https://github.com/simnova/OpenClinXR") ? undefined : "pages_index_repo_link_missing",
    indexHtml.includes("Evidence Docs") ? undefined : "pages_index_evidence_docs_link_missing",
    styles.includes("@media (max-width: 860px)") ? undefined : "pages_styles_mobile_breakpoint_missing",
    readme.includes("http://developers.simnova.com/OpenClinXR/") ? undefined : "readme_pages_url_missing",
    readme.includes("main") && readme.includes("/docs") ? undefined : "readme_pages_source_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string"));

  const pagesDocLinkMatch = indexHtml.matchAll(githubDocsLinkMatchPattern(indexHtml));
  for (const match of pagesDocLinkMatch) {
    const rawPath = match[1] ?? "";
    if (!rawPath) {
      continue;
    }

    const normalizedDocPath = rawPath.startsWith("docs/") ? rawPath.slice(5) : rawPath;
    const fullDocPath = rawPath.startsWith("docs/") ? rawPath : `docs/${rawPath}`;

    const existsWithDocs = await fileExists(fullDocPath);
    const existsWithoutDocs = await fileExists(normalizedDocPath);
    try {
      if (!existsWithDocs && !existsWithoutDocs) {
        throw new Error("missing_link");
      }
    } catch {
      blockers.push(`pages_index_github_link_missing:${normalizedDocPath}`);
    }
  }

  if (workflow) {
    const uploadPath = workflow.match(/^\s*path:\s*(.+)$/m)?.[1]?.trim();
    if (!uploadPath || uploadPath !== "docs") {
      blockers.push("pages_workflow_upload_path_missing");
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
  };
}

function githubDocsLinkMatchPattern(indexHtml: string): RegExp {
  if (indexHtml.includes("https://github.com/simnova/OpenClinXR/tree/main/docs/openclinxr/")) {
    return /href="https:\/\/github\.com\/simnova\/OpenClinXR\/tree\/main\/([^\"]+)"/g;
  }

  return /href="https:\/\/github\.com\/simnova\/OpenClinXR\/blob\/main\/([^\"]+)"/g;
}

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
