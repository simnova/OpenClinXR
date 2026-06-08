import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ARCHIVE_DIR = ".openclinxr/slice-archive";
const DEFAULT_SOURCE = "PROJECT_STATUS.md";
const CHECKPOINT_HEADER = "## Per-Slice Checkpoints";

type ArchiveOptions = {
  source: string;
  keep: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): ArchiveOptions {
  const options: ArchiveOptions = { source: DEFAULT_SOURCE, keep: 7, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--keep" && argv[i + 1]) options.keep = Number(argv[++i]);
    else if (arg === "--source" && argv[i + 1]) options.source = argv[++i]!;
  }
  return options;
}

export function splitCheckpointSections(text: string): { header: string; blocks: string[] } {
  const idx = text.indexOf(CHECKPOINT_HEADER);
  if (idx < 0) {
    return { header: text, blocks: [] };
  }
  const before = text.slice(0, idx + CHECKPOINT_HEADER.length);
  const after = text.slice(idx + CHECKPOINT_HEADER.length);
  const introEnd = after.indexOf("\n### ");
  const intro = introEnd >= 0 ? after.slice(0, introEnd) : after;
  const body = introEnd >= 0 ? after.slice(introEnd + 1) : "";
  const blocks = body
    .split(/\n### /u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `### ${block}`);
  return { header: `${before}${intro}`, blocks };
}

export async function archiveCheckpoints(options: ArchiveOptions): Promise<{ archived: number; kept: number }> {
  const sourcePath = path.resolve(options.source);
  const text = await readFile(sourcePath, "utf8");
  const { header, blocks } = splitCheckpointSections(text);
  if (blocks.length <= options.keep) {
    return { archived: 0, kept: blocks.length };
  }

  const toArchive = blocks.slice(options.keep);
  const toKeep = blocks.slice(0, options.keep);
  const archiveFile = path.join(ARCHIVE_DIR, `${path.basename(options.source, ".md")}-checkpoints.jsonl`);
  const archiveLines = toArchive
    .map((block) => JSON.stringify({ archivedAt: new Date().toISOString(), source: options.source, block }))
    .join("\n");

  if (!options.dryRun) {
    await mkdir(ARCHIVE_DIR, { recursive: true });
    await appendFile(archiveFile, `${archiveLines}\n`, "utf8");
    const rebuilt = `${header}\n\n${toKeep.join("\n\n")}\n`;
    await writeFile(sourcePath, rebuilt, "utf8");
  }

  return { archived: toArchive.length, kept: toKeep.length };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await archiveCheckpoints(options);
  console.log(
    JSON.stringify(
      {
        source: options.source,
        keep: options.keep,
        dryRun: options.dryRun,
        ...result,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}