#!/usr/bin/env tsx
/**
 * Print the next board card by priority, or refuse and exit non-zero.
 *
 * The unattended tick calls THIS instead of a hand-rolled `gh project item-list | python3 …`, because
 * that one-liner discarded `totalCount` and silently ranked a 200-item prefix of a 614-item board —
 * hiding 14 of 17 prioritized items including both P0s. See board-next-selector.ts.
 */
import { execFileSync } from "node:child_process";
import { selectNextBoardCard } from "./board-next-selector.js";

const runner = (argv: string[]): string =>
  execFileSync(argv[0]!, argv.slice(1), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const v = selectNextBoardCard(runner);
if (v.ok) {
  process.stdout.write(`[${v.priority}] #${v.number} ${v.title}\n`);
  process.stdout.write(`(complete read: ${v.fetched}/${v.totalCount} board items)\n`);
  process.exit(0);
}
process.stderr.write(`NO CANDIDATE (${v.reason}): ${v.detail}\n`);
process.exit(v.reason === "no-candidate" ? 0 : 2);
