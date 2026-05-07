import { access, constants, readFile, readdir } from "node:fs/promises";
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
  "docs/CNAME",
  "docs/assets/openclinxr-xr-evidence.png",
  "README.md",
];
const knownPagesSnapshotKeys = [
  "asset-production-evidence-ladder",
  "asset-production-artifact-evidence",
  "asset-production-readiness-benchmark",
  "github-pages-site",
] as const;

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

  const snapshotLinks = [...indexHtml.matchAll(pageLiveSnapshotPattern())];
  const snapshotStatuses = new Map<string, string>();
  for (const match of snapshotLinks) {
    const key = match[1];
    const href = match[2];
    if (!key || !href) {
      continue;
    }
    if (!knownPagesSnapshotKeys.includes(key as (typeof knownPagesSnapshotKeys)[number])) {
      blockers.push(`pages_index_snapshot_key_unknown:${key}`);
      continue;
    }

    const fullPath = href;
    const fileName = fullPath.split("/").pop();
    if (!fileName) {
      blockers.push(`pages_index_snapshot_path_invalid:${key}`);
      continue;
    }

    const snapshotMatch = fileName.match(pagesSnapshotFilePattern(key));
    if (!snapshotMatch) {
      blockers.push(`pages_index_snapshot_filename_invalid:${key}:${fileName}`);
      continue;
    }

    const currentDate = snapshotMatch[1];
    const extension = snapshotMatch[2];
    const latestDate = await latestSnapshotDate(key, extension);
    if (!latestDate) {
      blockers.push(`pages_index_snapshot_missing:${key}`);
      continue;
    }

    if (currentDate !== latestDate) {
      blockers.push(`pages_index_snapshot_not_latest:${key}:found:${fileName}:expected:${key}-${latestDate}${extension}`);
    }

    snapshotStatuses.set(key, fileName);
  }

  for (const key of knownPagesSnapshotKeys) {
    if (!snapshotStatuses.has(key)) {
      blockers.push(`pages_index_snapshot_key_missing:${key}`);
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

function pageLiveSnapshotPattern(): RegExp {
  return /<a\b[\s\S]*?data-pages-snapshot="([^"]+)"[\s\S]*?href="([^"]+)"[\s\S]*?>/g;
}

function pagesSnapshotFilePattern(key: string): RegExp {
  return new RegExp(
    `^${escapeRegex(key)}-([0-9]{4}-[0-9]{2}-[0-9]{2})(\\.[a-z0-9]+)$`,
    "i",
  );
}

async function latestSnapshotDate(key: string, extension: string): Promise<string | undefined> {
  const pattern = new RegExp(
    `^${escapeRegex(key)}-([0-9]{4}-[0-9]{2}-[0-9]{2})${escapeRegex(extension)}$`,
    "i",
  );
  const files = await readdir("docs/openclinxr", { withFileTypes: true });
  const candidates = files
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(pattern);
      const date = match?.[1];
      if (!date) {
        return null;
      }
      return date;
    })
    .filter((date): date is string => date !== null)
    .sort((a, b) => b.localeCompare(a));

  return candidates[0];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
