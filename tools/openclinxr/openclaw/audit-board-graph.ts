/**
 * Read-only structural audit of a BothyBoard subtree.
 *
 *     direnv exec . npx tsx tools/openclinxr/openclaw/audit-board-graph.ts [parentTaskId]
 *
 * ## Why this exists
 *
 * Four graph transactions ran across this board in one day, by two orchestrators, and each was
 * verified by hand-written throwaway scripts. The same four defect classes appeared repeatedly, and
 * every one of them was found by a person reading a dump rather than by a check:
 *
 *   - a DANGLING DEP, because `depIds` is create-only so correcting an edge means refiling a card and
 *     every transitive dependent. One survived a re-walk because the walk ran before a later rename.
 *   - a card whose WRITE ROOT has no proof mentioning it. Found on bake twice, on section-19, on D9,
 *     and on a replacement M1. A worker satisfies such a card while writing nothing in the surface it
 *     claims.
 *   - a card with a COMMITTED RED sitting Idle, so it can never dequeue. Found once on M5, then at
 *     seven times the scale after a large refile — a refile resets factory to Idle and the replanting
 *     is easy to forget.
 *   - a PLANTED card whose `live:` path does not exist, which is a contract pointing at nothing.
 *
 * None of these needs judgement. All four are mechanical, and a check that runs in seconds beats a
 * reviewer who has to be asked.
 *
 * ## What it does NOT check, deliberately
 *
 * Whether a card's contract is any good — satisfiable, hard to cheat, bounding a relationship rather
 * than a presence. That is what the paired reviews are for and this must not be read as covering it.
 * Nor whether a `live:` file's clauses are red for their own reasons; `probe:reds` owns that, per
 * package.
 *
 * Read-only by construction: it calls `tasks.get` and nothing else.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { bothyMcpCall } from "./board-bothy-dequeue.js";

const MOTION_FACTORY_PARENT = "tsk_784e4714847f900b";

type Card = {
  id?: string;
  title?: string;
  status?: string;
  factory?: string;
  depIds?: string[];
  writeRoots?: string[];
  doneWhen?: string[];
};

export type BoardGraphFinding = {
  kind: "dangling_dep" | "cycle" | "planted_red_absent" | "committed_red_idle" | "write_root_unproven";
  cardId: string;
  title: string;
  detail: string;
};

/** The four mechanical rules. Exported so a test can drive them without a network call. */
export function auditBoardGraph(cards: readonly Card[], repoRoot: string): BoardGraphFinding[] {
  const all = new Map<string, Card>(cards.filter((c) => c.id).map((c) => [c.id!, c]));
  const live = new Map([...all].filter(([, c]) => c.status !== "cancelled"));
  const findings: BoardGraphFinding[] = [];
  const at = (c: Card) => ({ cardId: c.id ?? "(no id)", title: (c.title ?? "").slice(0, 60) });
  const liveRed = (c: Card): string | undefined =>
    (c.doneWhen ?? []).find((r) => r.startsWith("live:"))?.slice("live:".length);

  for (const c of live.values()) {
    for (const dep of c.depIds ?? []) {
      const status = all.get(dep)?.status ?? "MISSING";
      if (status === "cancelled" || status === "MISSING") {
        findings.push({ kind: "dangling_dep", ...at(c), detail: `depends on ${dep}, which is ${status}` });
      }
    }
  }

  // Cycles. A create-only graph cannot break one without rebuilding both halves, so catching it at
  // creation time is the only cheap moment.
  const deps = new Map([...live].map(([id, c]) => [id, (c.depIds ?? []).filter((d) => live.has(d))]));
  const seen = new Set<string>();
  const stack = new Set<string>();
  const walk = (node: string, trail: string[]): void => {
    if (stack.has(node)) {
      const cycle = trail.slice(trail.indexOf(node));
      findings.push({ ...at(live.get(node)!), kind: "cycle", detail: `cycle: ${cycle.join(" -> ")}` });
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    stack.add(node);
    for (const d of deps.get(node) ?? []) walk(d, [...trail, d]);
    stack.delete(node);
  };
  for (const id of live.keys()) walk(id, [id]);

  for (const c of live.values()) {
    const red = liveRed(c);
    const onDisk = red !== undefined && existsSync(path.resolve(repoRoot, red));

    if (c.factory === "Planted" && !onDisk) {
      findings.push({
        ...at(c),
        kind: "planted_red_absent",
        detail: red === undefined ? "Planted with no live: rule at all" : `Planted, but ${red} is not on disk`,
      });
    }
    // The inverse, and the one a large refile produces in bulk: the contract exists and the card
    // cannot be dequeued, so the work is invisible to tasks.next.
    if (c.factory !== "Planted" && onDisk) {
      findings.push({ ...at(c), kind: "committed_red_idle", detail: `${red} is committed but the card is ${c.factory}` });
    }

    // A write root with no proof naming it is a surface a worker may touch and nothing checks. Only
    // meaningful on multi-root cards: a single-root card's proofs are self-evidently about that root.
    const roots = c.writeRoots ?? [];
    if (roots.length > 1) {
      const proofs = (c.doneWhen ?? []).join(" ");
      for (const root of roots) {
        if (!proofs.includes(root)) {
          findings.push({ ...at(c), kind: "write_root_unproven", detail: `write root ${root} appears in no done_when rule` });
        }
      }
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const pat = process.env["BOTHY_BOARD_PAT"] ?? "";
  if (!pat.startsWith("bb_pat_")) {
    console.error("BOTHY_BOARD_PAT missing — run under `direnv exec .`. Refusing rather than auditing nothing.");
    process.exit(2);
  }
  const parent = process.argv[2] ?? MOTION_FACTORY_PARENT;
  const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

  const { structuredContent } = await bothyMcpCall(pat, "bothy-board.tasks.get", { taskId: parent });
  const children = ((structuredContent as { task?: { children?: Card[] } })?.task?.children ?? []) as Card[];

  // COUNTERWEIGHT: an empty read reports "no findings", which is indistinguishable from a clean board.
  if (children.length === 0) {
    console.error(`no children under ${parent} — the read failed or the id is wrong; refusing to report clean`);
    process.exit(2);
  }

  const live = children.filter((c) => c.status !== "cancelled");
  const findings = auditBoardGraph(children, repoRoot);
  console.log(`board audit under ${parent}: ${live.length} live, ${children.length - live.length} cancelled`);
  for (const f of findings) console.log(`  ${f.kind.padEnd(22)} ${f.cardId.slice(4, 12)}  ${f.detail}\n${" ".repeat(26)}${f.title}`);
  console.log(`\n${findings.length} finding(s).`);
  process.exit(findings.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
