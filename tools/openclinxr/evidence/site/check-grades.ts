import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const visualExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".mp4",
  ".webm",
]);

type GradeEntry = {
  path?: unknown;
  sha256?: unknown;
  grader?: unknown;
  gradeMessageId?: unknown;
  demonstrates?: unknown;
};

async function collectVisualFiles(rootDir: string): Promise<string[]> {
  const mediaDir = path.join(rootDir, "docs", "site", "media");
  const docsDir = path.join(rootDir, "docs");
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let isDir = false;
      try {
        isDir = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        await walk(full);
      } else if (visualExtensions.has(path.extname(name).toLowerCase())) {
        found.push(path.relative(docsDir, full).split(path.sep).join("/"));
      }
    }
  }
  await walk(mediaDir);
  found.sort();
  return found;
}

export async function checkGrades(rootDir: string): Promise<string[]> {
  const blockers: string[] = [];
  const gradesPath = path.join(rootDir, "docs", "site", "data", "grades.json");
  let entries: GradeEntry[] = [];
  try {
    const text = await readFile(gradesPath, "utf8");
    const data = JSON.parse(text) as { entries?: unknown };
    if (Array.isArray(data.entries)) {
      entries = data.entries as GradeEntry[];
    }
  } catch {
    entries = [];
  }

  const entryPaths = new Set<string>();
  for (const entry of entries) {
    const entryPath = typeof entry.path === "string" ? entry.path : "";
    if (entryPath) {
      entryPaths.add(entryPath);
    }
    for (const field of ["gradeMessageId", "demonstrates"] as const) {
      const value = entry[field];
      if (typeof value !== "string" || value.trim() === "") {
        blockers.push(`grades_field_missing:${entryPath}:${field}`);
      }
    }
    if (entry.grader !== "super-ceo") {
      blockers.push(`grades_grader_not_super_ceo:${entryPath}`);
    }
    if (!entryPath) {
      continue;
    }
    let bytes: Buffer | undefined;
    try {
      bytes = await readFile(path.join(rootDir, "docs", entryPath));
    } catch {
      blockers.push(`grades_file_missing:${entryPath}`);
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (typeof entry.sha256 !== "string" || entry.sha256.toLowerCase() !== actual) {
      blockers.push(`grades_sha_mismatch:${entryPath}`);
    }
  }

  for (const visual of await collectVisualFiles(rootDir)) {
    if (!entryPaths.has(visual)) {
      blockers.push(`grades_visual_without_entry:${visual}`);
    }
  }
  return blockers;
}

async function main(): Promise<void> {
  const blockers = await checkGrades(process.cwd());
  if (blockers.length === 0) {
    console.log("Grades check passed: every visual file has a matching super-ceo grade entry.");
    return;
  }
  for (const blocker of blockers) {
    console.error(blocker);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
