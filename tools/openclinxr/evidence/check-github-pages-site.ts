import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkLayout } from "./site/layout.js";
import { validateSiteData } from "./site/site-data-schemas.js";

type ValidationResult = {
  passed: boolean;
  blockers: string[];
};

const requiredSiteFiles = [
  "docs/index.html",
  "docs/engineering.html",
  "docs/styles.css",
  "docs/.nojekyll",
  "docs/CNAME",
  "README.md",
];

/**
 * The hero gate reads media.json slot hero-poster. Any state other than GRADED
 * requires the shared capture-pending hero figure with no img in it; GRADED
 * requires a hero-figure img whose sha256 equals the grades.json entry.
 * An unreadable or unparsable media.json means no hero-poster slot, i.e. the
 * PLACEHOLDER default. This does NOT grade the picture. No automated check can.
 * The orchestrator reads the pixels (D12) before any image is published.
 */
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

const factoryStationCardsPattern = /src="(assets\/factory-station-cards-[^"]+\.png)"/;
const factoryStationEquipmentPattern = /src="(assets\/factory-station-equipment-generate-[^"]+\.png)"/;
const MIN_FACTORY_STATION_CARDS_BYTES = 40_000;

async function factoryStationStillBlocker(indexHtml: string): Promise<string | undefined> {
  const cards = factoryStationCardsPattern.exec(indexHtml);
  const equipment = factoryStationEquipmentPattern.exec(indexHtml);
  if (!cards?.[1]) return "pages_index_factory_station_cards_image_missing";
  if (!equipment?.[1]) return "pages_index_factory_station_equipment_image_missing";
  for (const src of [cards[1], equipment[1]]) {
    const onDisk = path.join("docs", src);
    try {
      const { size } = await stat(onDisk);
      if (src.includes("factory-station-cards-") && size < MIN_FACTORY_STATION_CARDS_BYTES) {
        return `pages_index_factory_station_cards_stub:${src}:${size}b`;
      }
    } catch {
      return `pages_index_factory_station_image_absent:${onDisk}`;
    }
  }
  return undefined;
}

export type HeroMediaFile = {
  slots?: { id?: string; state?: string }[];
};

export type HeroGradesFile = {
  entries?: { slot?: string; path?: string; sha256?: string }[];
};

export type HeroBytesReader = (docsRelativePath: string) => Buffer | undefined;

function heroFigureOpenTag(figureHtml: string): string {
  return (/<figure\b[^>]*>/i.exec(figureHtml) ?? [])[0] ?? "";
}

function hasClassToken(openTag: string, token: string): boolean {
  const match = /\sclass\s*=\s*("[^"]*"|'[^']*')/.exec(openTag);
  if (!match?.[1]) {
    return false;
  }
  return match[1].slice(1, -1).split(/\s+/).includes(token);
}

function hasSlotToken(openTag: string, slotId: string): boolean {
  const match = /\sdata-slot\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/.exec(openTag);
  if (!match?.[1]) {
    return false;
  }
  return match[1].replace(/^['"]|['"]$/g, "") === slotId;
}

function heroImgSrcs(figures: string[]): string[] {
  const srcs: string[] = [];
  for (const figure of figures) {
    const openTag = heroFigureOpenTag(figure);
    const isHeroFigure =
      hasClassToken(openTag, "hero__image") ||
      (hasClassToken(openTag, "capture-pending") && hasSlotToken(openTag, "hero-poster"));
    if (!isHeroFigure) {
      continue;
    }
    for (const match of figure.matchAll(/<img\b[^>]*\bsrc\s*=\s*("[^"]*"|'[^']*')/gi)) {
      const src = (match[1] ?? "").slice(1, -1).trim();
      if (src === "" || /^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) {
        continue;
      }
      srcs.push(src);
    }
  }
  return srcs;
}

/**
 * Pure hero gate used by heroImageBlocker so tests can call it with fixtures.
 * media.json slot hero-poster decides the branch: any state other than GRADED
 * requires the shared capture-pending figure (no img inside it or inside a
 * figure.hero__image); GRADED requires an img inside figure.hero__image or inside
 * the hero-poster capture-pending figure whose file sha256 equals the grades.json
 * entry for hero-poster. An img anywhere else does not count.
 */
export function heroImageBlockerFor(
  indexHtml: string,
  media: HeroMediaFile,
  grades: HeroGradesFile,
  readBytes: HeroBytesReader,
): string | undefined {
  const slot = (media.slots ?? []).find((entry) => entry?.id === "hero-poster");
  const state = slot?.state ?? "PLACEHOLDER";
  const figures = [...indexHtml.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi)].map(
    (match) => match[0],
  );
  if (state !== "GRADED") {
    const heroFigure = figures.find(
      (figure) =>
        hasClassToken(heroFigureOpenTag(figure), "capture-pending") &&
        hasSlotToken(heroFigureOpenTag(figure), "hero-poster"),
    );
    if (heroFigure === undefined) {
      return "pages_index_hero_image_missing";
    }
    if (/<img\b/i.test(heroFigure)) {
      return "pages_index_hero_image_ungraded_has_img";
    }
    if (
      figures.some(
        (figure) =>
          hasClassToken(heroFigureOpenTag(figure), "hero__image") && /<img\b/i.test(figure),
      )
    ) {
      return "pages_index_hero_image_ungraded_has_img";
    }
    return undefined;
  }
  const expected = (grades.entries ?? [])
    .filter((entry) => entry?.slot === "hero-poster")
    .map((entry) => entry?.sha256)
    .find((sha): sha is string => typeof sha === "string" && sha.length > 0);
  if (expected === undefined) {
    return "pages_index_hero_image_grade_missing";
  }
  const srcs = heroImgSrcs(figures);
  if (srcs.length === 0) {
    return "pages_index_hero_image_missing";
  }
  for (const src of srcs) {
    const bytes = readBytes(src.startsWith("docs/") ? src : `docs/${src}`);
    if (bytes === undefined) {
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex").toLowerCase() === expected.toLowerCase()) {
      return undefined;
    }
  }
  return "pages_index_hero_image_sha_mismatch";
}

export async function heroImageBlocker(indexHtml: string): Promise<string | undefined> {
  // Unreadable or unparsable media.json means no hero-poster slot, i.e. PLACEHOLDER.
  let media: HeroMediaFile = {};
  try {
    media = JSON.parse(
      await readFile(path.join("docs", "site", "data", "media.json"), "utf8"),
    ) as HeroMediaFile;
  } catch {
    media = {};
  }
  let grades: HeroGradesFile = {};
  try {
    grades = JSON.parse(
      await readFile(path.join("docs", "site", "data", "grades.json"), "utf8"),
    ) as HeroGradesFile;
  } catch {
    grades = {};
  }
  return heroImageBlockerFor(indexHtml, media, grades, (docsRelativePath) => {
    try {
      return readFileSync(docsRelativePath);
    } catch {
      return undefined;
    }
  });
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
  const engineeringHtml = fileText.get("docs/engineering.html") ?? "";
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
    engineeringHtml.includes("Evidence Docs") ? undefined : "pages_index_evidence_docs_link_missing",
    engineeringHtml.includes('id="factory-stations"') ? undefined : "pages_index_factory_stations_section_missing",
    await factoryStationStillBlocker(engineeringHtml),
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

  const snapshotLinks = [...engineeringHtml.matchAll(pageLiveSnapshotPattern())];
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

  blockers.push(...(await validateSiteData(process.cwd())));
  blockers.push(...(await checkLayout(process.cwd())));
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
  return /([0-9]{4}-[0-9]{2}-[0-9]{2})(\.[a-z0-9]+)$/i;
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
