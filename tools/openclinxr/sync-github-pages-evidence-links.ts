import { readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const evidenceDocsDir = "docs/openclinxr";
const evidencePageRepoRoot = "docs/index.html";
const githubRepoBlobPrefix = "https://github.com/simnova/OpenClinXR/blob/main/";
const knownSnapshots = [
  "asset-production-evidence-ladder",
  "asset-production-artifact-evidence",
  "asset-production-readiness-benchmark",
  "github-pages-site",
] as const;
const githubPagesSnapshotPathPattern = /^https:\/\/github\.com\/simnova\/OpenClinXR\/blob\/main\/([^"]+)$/;

type SyncUpdate = {
  key: string;
  previousFile: string;
  nextFile: string;
};

type SyncResult = {
  updates: SyncUpdate[];
  changed: boolean;
};

const anchorTagPattern = /<a\b[^>]*?>/g;

function parsePagesSnapshotKey(tag: string): string | undefined {
  const match = /data-pages-snapshot="([^"]+)"/.exec(tag);
  return match?.[1];
}

function parseTagHref(tag: string): string | undefined {
  const match = /href="([^"]+)"/.exec(tag);
  return match?.[1];
}

export async function syncGithubPagesEvidenceLinks(
  indexPath = evidencePageRepoRoot,
  options: { write?: boolean } = {},
): Promise<SyncResult> {
  const { write = true } = options;
  const indexHtml = await readFile(indexPath, "utf8");
  const updates: SyncUpdate[] = [];
  const tagMatches = [...indexHtml.matchAll(anchorTagPattern)];
  let cursor = 0;
  let output = "";

  for (const match of tagMatches) {
    const fullTag = match[0];
    const matchIndex = match.index ?? 0;
    const key = parsePagesSnapshotKey(fullTag);
    const href = parseTagHref(fullTag);
    if (!key || !href) {
      output += indexHtml.slice(cursor, matchIndex + fullTag.length);
      cursor = matchIndex + fullTag.length;
      continue;
    }

    const tagBeforeUpdate = indexHtml.slice(cursor, matchIndex);
    output += tagBeforeUpdate;
    cursor = matchIndex + fullTag.length;

    if (!knownSnapshots.includes(key as (typeof knownSnapshots)[number])) {
      output += fullTag;
      continue;
    }

    const githubMatch = href.match(githubPagesSnapshotPathPattern);
    if (!githubMatch) {
      output += fullTag;
      continue;
    }

    const [, fullPath] = githubMatch;
    const fileName = fullPath.split("/").pop();
    if (!fileName) {
      output += fullTag;
      continue;
    }

    const snapshotMatchParts = fileName.match(snapshotFilePattern(key));
    if (!snapshotMatchParts) {
      output += fullTag;
      continue;
    }

    const extension = snapshotMatchParts[2];
    const latest = await findLatestSnapshotFileName(key, extension);
    if (!latest || latest === fileName) {
      output += fullTag;
      continue;
    }

    const latestUrl = `${githubRepoBlobPrefix}${evidenceDocsDir}/${latest}`;
    const updatedTag = fullTag.replace(href, latestUrl);
    const previousPath = `${evidenceDocsDir}/${fileName}`;
    output += updatedTag;
    updates.push({
      key,
      previousFile: previousPath,
      nextFile: `${evidenceDocsDir}/${latest}`,
    });
  }

  output += indexHtml.slice(cursor);

  if (updates.length === 0) {
    return { changed: false, updates };
  }

  if (write) {
    await writeFile(indexPath, output, "utf8");
  }
  return { changed: true, updates };
}

function snapshotFilePattern(key: string): RegExp {
  return new RegExp(`^${escapeRegex(key)}-([0-9]{4}-[0-9]{2}-[0-9]{2})(\\.[a-z0-9]+)$`, "i");
}

async function findLatestSnapshotFileName(
  key: string,
  extension: string,
): Promise<string | undefined> {
  const pattern = new RegExp(
    `^${escapeRegex(key)}-([0-9]{4}-[0-9]{2}-[0-9]{2})${escapeRegex(extension)}$`,
    "i",
  );
  const entries = await readdir(evidenceDocsDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const groups = entry.name.match(pattern);
      const date = groups?.[1];
      if (!date) {
        return null;
      }

      return {
        date,
        fileName: entry.name,
      };
    })
    .filter((item): item is { date: string; fileName: string } => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  return candidates[0]?.fileName;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  const indexArgIndex = process.argv.indexOf("--index");
  const indexArgValue = indexArgIndex >= 0 ? process.argv[indexArgIndex + 1] : undefined;
  const indexPath = indexArgValue ?? evidencePageRepoRoot;
  const checkMode = process.argv.includes("--check");
  const result = await syncGithubPagesEvidenceLinks(indexPath, { write: !checkMode });

  if (result.changed) {
    if (checkMode) {
      console.error("Evidence snapshot links are stale. Run pnpm pages:sync-evidence-links to update them.");
      for (const update of result.updates) {
        console.error(`Updated ${update.key}: ${update.previousFile} -> ${update.nextFile}`);
      }
      process.exitCode = 1;
      return;
    }

    for (const update of result.updates) {
      console.log(`Updated ${update.key}: ${update.previousFile} -> ${update.nextFile}`);
    }
    return;
  }

  console.log("No evidence snapshot links needed updates.");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  void main();
}
