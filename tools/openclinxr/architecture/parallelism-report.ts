import { execFileSync } from "node:child_process";

/**
 * Serialization report: which files force parallel workers to queue behind each other.
 *
 * MEASURED 2026-09-07 and this is why the script exists. The assumption driving the
 * composition-root work was that god-files limit parallel agentic development. Against
 * 1,500 commits that is false: apps/ui-xr/src/main.ts has 185 commits and appears in ZERO
 * of the 17 conflict-resolving merges, and on the day the repo landed the most commits with
 * no conflicts (159 on 2026-08-21) main.ts was 9,872 lines, nearly twice its size now.
 *
 * What actually serializes work is shared coordination state: hand-edited freeze tables,
 * checked-in registries, one shared evidence-probe directory, and the lockfile. Module
 * structure explained at most 23% of measured contention; main.ts alone explained 1.9%.
 *
 * METRIC: excess writers. For each (day, file), a file touched by N distinct commits that
 * day contributes N-1. Two workers editing one file on one day is what costs a merge; one
 * worker editing it twenty times is not. Run it after a batch of parallel work: a new entry
 * near the top is a new serialization point, and it is usually coordination state, not a
 * module.
 */
const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8) ?? "2026-08-01";
const top = Number(process.argv.find((a) => a.startsWith("--top="))?.slice(6) ?? "20");

const log = execFileSync(
  "git",
  ["log", `--since=${since}`, "--pretty=format:@%H %ad", "--date=short", "--name-only"],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);

const writersByDayFile = new Map<string, Set<string>>();
let sha = "";
let day = "";
for (const line of log.split("\n")) {
  if (line.startsWith("@")) {
    const parts = line.slice(1).split(" ");
    sha = parts[0] ?? "";
    day = parts[1] ?? "";
    continue;
  }
  if (line.trim() === "") continue;
  const key = `${day}\t${line}`;
  const set = writersByDayFile.get(key) ?? new Set<string>();
  set.add(sha);
  writersByDayFile.set(key, set);
}

const excessByFile = new Map<string, number>();
const daysByFile = new Map<string, number>();
for (const [key, writers] of writersByDayFile) {
  const file = key.split("\t")[1] ?? "";
  if (writers.size < 2) continue;
  excessByFile.set(file, (excessByFile.get(file) ?? 0) + writers.size - 1);
  daysByFile.set(file, (daysByFile.get(file) ?? 0) + 1);
}

/** Classes exist so the report answers "is this structure, or is it coordination state?". */
function classify(file: string): string {
  if (/(^|\/)(pnpm-lock\.yaml|package\.json|tsconfig.*\.json|biome\.json|turbo\.json)$/.test(file)) {
    return "build/config";
  }
  if (/arch-ceiling\.json$|architecture-rules\/src\/checks\//.test(file)) return "ratchet";
  if (/registry|PROJECT_STATUS\.md|manifest\.ts$|ledger\.md$|backlog/i.test(file)) return "registry";
  if (/\.(test|spec)\.tsx?$/.test(file)) return "shared test";
  if (/^(docs|\.claude|\.agents|\.grok|agents)\//.test(file)) return "doc";
  if (/^tools\//.test(file)) return "harness";
  if (/^(apps|packages)\//.test(file)) return "source";
  return "other";
}

const rows = [...excessByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
const total = [...excessByFile.values()].reduce((a, b) => a + b, 0);
const byClass = new Map<string, number>();
for (const [file, excess] of excessByFile) {
  const c = classify(file);
  byClass.set(c, (byClass.get(c) ?? 0) + excess);
}

console.log(`serialization report since ${since} - ${total} excess-writer events`);
console.log("");
console.log("  excess  days  class         file");
for (const [file, excess] of rows) {
  const days = String(daysByFile.get(file) ?? 0).padStart(4);
  console.log(`  ${String(excess).padStart(6)}  ${days}  ${classify(file).padEnd(12)}  ${file}`);
}
console.log("");
console.log("  by class:");
for (const [c, n] of [...byClass].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(6)}  ${((100 * n) / total).toFixed(1).padStart(5)}%  ${c}`);
}
