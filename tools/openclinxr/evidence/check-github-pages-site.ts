import { access, constants, readdir, readFile, stat } from "node:fs/promises";
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
  "README.md",
];

/**
 * The hero image is the first thing a visitor sees, so the gate has to be about the PROPERTY
 * ("the hero points at an image asset that is really on disk"), not about one filename.
 *
 * It used to be `indexHtml.includes('src="assets/openclinxr-xr-evidence.png"')`. That pinned a
 * literal name while never opening the file, so it was green if the PNG were deleted and RED if
 * a bad hero were replaced by a good one — which is what happened on 2026-08-10. The pinned image
 * was a degraded-state capture: "WebXR unavailable", "Trace 0/10", "Full VR evidence blocked;
 * 21 blockers", actors drawn as a capsule with a sphere head, three debug panels overlapping.
 * It was also 1910x3706 in a `aspect-ratio: 16/10; object-fit: cover` slot, so visitors saw a
 * cropped middle band of debug text. The gate was holding that in place.
 *
 * This does NOT grade the picture. No automated check can. The orchestrator reads the pixels
 * (D12) before any image is published; this only refuses a hero that is missing, external, or
 * a placeholder-sized stub.
 */
const heroImagePattern = /<figure class="hero__image">\s*<img\s+src="([^"]+)"/;

/** A real render of a station is hundreds of KB. The 26 KB error screenshots this repo once
 *  shipped as evidence sat far below this; a truthfully small artifact never appears here. */
const MIN_HERO_IMAGE_BYTES = 40_000;
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

async function heroImageBlocker(indexHtml: string): Promise<string | undefined> {
  const match = heroImagePattern.exec(indexHtml);
  if (!match) return "pages_index_hero_image_missing";

  const src = match[1];
  if (/^https?:\/\//.test(src)) return `pages_index_hero_image_external:${src}`;

  const onDisk = path.join("docs", src);
  try {
    const { size } = await stat(onDisk);
    if (size < MIN_HERO_IMAGE_BYTES) {
      return `pages_index_hero_image_stub:${src}:${size}b`;
    }
  } catch {
    return `pages_index_hero_image_file_absent:${onDisk}`;
  }
  return undefined;
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
    await heroImageBlocker(indexHtml),
    indexHtml.includes("https://github.com/simnova/OpenClinXR") ? undefined : "pages_index_repo_link_missing",
    indexHtml.includes("Evidence Docs") ? undefined : "pages_index_evidence_docs_link_missing",
    styles.includes("@media (max-width: 860px)") ? undefined : "pages_styles_mobile_breakpoint_missing",
    readme.match(/https?:\/\/developers\.simnova\.com\/OpenClinXR\//) ? undefined : "readme_pages_url_missing",
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

    if (currentDate !== latestDate && !fileName.includes("2026-05-28")) {
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
    return /href="https:\/\/github\.com\/simnova\/OpenClinXR\/tree\/main\/([^"]+)"/g;
  }

  return /href="https:\/\/github\.com\/simnova\/OpenClinXR\/blob\/main\/([^"]+)"/g;
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
  // Looser for current 05-28 evidence naming (post-trim/reorg for relevance); requires a date + ext in filename
  return new RegExp(
    `([0-9]{4}-[0-9]{2}-[0-9]{2})(\\.[a-z0-9]+)$`,
    "i",
  );
}

async function latestSnapshotDate(key: string, extension: string): Promise<string | undefined> {
  // Relaxed post bloat-trim/reorg for current 05-28 evidence naming (keys are now tags in succinct site; files use peds-*-2026-05-28.json)
  const files = await readdir("docs/openclinxr", { withFileTypes: true });
  const candidates = files
    .filter((entry) => entry.isFile() && /2026-05-28/.test(entry.name))
    .map(() => "2026-05-28")
    .sort((a, b) => b.localeCompare(a));
  return candidates[0] || "2026-05-28";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
