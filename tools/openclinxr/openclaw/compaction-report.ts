/**
 * compaction-report — one row per compaction in a Claude Code transcript.
 *
 * Usage: pnpm exec tsx tools/openclinxr/openclaw/compaction-report.ts <transcript.jsonl> [--json]
 *
 * A compaction is a top-level {type:"system",subtype:"compact_boundary",timestamp,
 * compactMetadata:{trigger,preTokens}} line. firstContextAfter is input+cache_creation+
 * cache_read on the first assistant line after the boundary, null when none follows.
 * Never writes any file.
 */
import { readFileSync } from "node:fs";

export type CompactionRow = {
  timestamp: string | null;
  trigger: string | null;
  preTokens: number | null;
  firstContextAfter: number | null;
};

type Usage = { input_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown };
type Entry = {
  type?: unknown;
  subtype?: unknown;
  timestamp?: unknown;
  compactMetadata?: { trigger?: unknown; preTokens?: unknown };
  message?: { usage?: Usage };
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function compactionRows(text: string): CompactionRow[] {
  const rows: CompactionRow[] = [];
  let open: CompactionRow | null = null;
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Entry;
    try {
      entry = JSON.parse(trimmed) as Entry;
    } catch {
      continue;
    }
    if (entry?.type === "system" && entry.subtype === "compact_boundary") {
      const meta: NonNullable<Entry["compactMetadata"]> = entry.compactMetadata ?? {};
      open = {
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
        trigger: typeof meta.trigger === "string" ? meta.trigger : null,
        preTokens: num(meta.preTokens),
        firstContextAfter: null,
      };
      rows.push(open);
      continue;
    }
    if (open === null || entry?.type !== "assistant") continue;
    const usage = entry.message?.usage;
    if (!usage || typeof usage !== "object") continue;
    // First assistant line with a usage object; missing fields count 0.
    open.firstContextAfter =
      (num(usage.input_tokens) ?? 0) +
      (num(usage.cache_creation_input_tokens) ?? 0) +
      (num(usage.cache_read_input_tokens) ?? 0);
    open = null;
  }
  return rows;
}

export function formatRows(rows: CompactionRow[]): string {
  const header = ["#", "timestamp", "trigger", "preTokens", "firstContextAfter"];
  const body = rows.map((r, i) => [
    String(i + 1),
    r.timestamp ?? "-",
    r.trigger ?? "-",
    r.preTokens === null ? "-" : String(r.preTokens),
    r.firstContextAfter === null ? "null" : String(r.firstContextAfter),
  ]);
  return [header, ...body].map((cols) => cols.join("\t")).join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    process.stderr.write("usage: compaction-report.ts <transcript.jsonl> [--json]\n");
    process.exit(2);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    process.stderr.write(`cannot read ${path}: ${(error as Error).message}\n`);
    process.exit(1);
  }
  const rows = compactionRows(text);
  process.stdout.write(`${json ? JSON.stringify(rows, null, 2) : formatRows(rows)}\n`);
}

const invokedDirectly = process.argv[1]?.endsWith("compaction-report.ts") ?? false;
if (invokedDirectly) main();
