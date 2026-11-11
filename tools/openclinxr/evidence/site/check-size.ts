import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type WebsitePathsManifest = {
  schema?: unknown;
  paths?: unknown;
  budgetBytes?: unknown;
  websiteBytesAtBase?: unknown;
  baseSha?: unknown;
};

export async function loadManifest(manifestPath: string): Promise<{
  paths: string[];
  budgetBytes: number;
}> {
  const text = await readFile(manifestPath, "utf8");
  const data = JSON.parse(text) as WebsitePathsManifest;
  const paths = Array.isArray(data.paths)
    ? data.paths.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (
    typeof data.budgetBytes !== "number" ||
    !Number.isFinite(data.budgetBytes) ||
    data.budgetBytes <= 0
  ) {
    throw new Error(`manifest_budget_missing: ${manifestPath} has no numeric budgetBytes`);
  }
  const budgetBytes: number = data.budgetBytes;
  return { paths, budgetBytes };
}

function manifestPathForThisModule(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "website-paths.json");
}

export async function measureWebsiteBytes(rootDir: string, paths: string[]): Promise<number> {
  const specs = paths.map((pattern) => (pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern));
  let tracked: string[] = [];
  try {
    const output = execFileSync("git", ["ls-files", "-z", "--", ...specs], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }) as string;
    tracked = output.split("\0").filter((entry) => entry.length > 0);
  } catch {
    tracked = [];
  }
  let total = 0;
  for (const relative of tracked) {
    let size = 0;
    try {
      size = (await stat(path.join(rootDir, relative))).size;
    } catch {
      size = 0;
    }
    total += size;
  }
  return total;
}

export async function checkSize(rootDir: string): Promise<string[]> {
  const { paths, budgetBytes } = await loadManifest(manifestPathForThisModule());
  const total = await measureWebsiteBytes(rootDir, paths);
  if (total > budgetBytes) {
    return [`site_over_budget:${total}:${budgetBytes}`];
  }
  return [];
}

async function main(): Promise<void> {
  const { paths, budgetBytes } = await loadManifest(manifestPathForThisModule());
  const total = await measureWebsiteBytes(process.cwd(), paths);
  console.log(`Website bytes ${total} / ${budgetBytes}`);
  if (total > budgetBytes) {
    console.error(`site_over_budget:${total}:${budgetBytes}`);
    process.exitCode = 1;
    return;
  }
  console.log("Size check passed: website-written paths are within budget.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
