/**
 * Temporal decisions catalog — PMO-owned due/queue workflow.
 *
 * SSOT: docs/agent-ops/TEMPORAL-DECISIONS.md
 * Catalog: docs/agent-ops/temporal-decisions-catalog.json
 *
 * Commands: list | due | measure | register | mark | queue | reschedule | help
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TEMPORAL_CATALOG_SCHEMA = "openclinxr.temporal-decisions-catalog.v1" as const;
export const CATALOG_REL = "docs/agent-ops/temporal-decisions-catalog.json";
export const QUEUE_REL = "docs/agent-ops/temporal-review-queue.md";
export const STATE_REL = ".openclinxr/temporal-review/last-measure.json";

export type TemporalStatus =
  | "open"
  | "due"
  | "in_review"
  | "keep"
  | "replace"
  | "retire"
  | "closed";

export type TemporalDecisionItem = {
  id: string;
  title: string;
  decidedAt: string;
  context: string;
  revisitWhy: string;
  cadenceDays: number;
  nextReviewAt: string;
  priority: number;
  status: TemporalStatus;
  analysisOwnerRole: string;
  executeOwnerRole: string;
  workProductHints: string[];
  outcomeCreatesWork: boolean;
  tags?: string[];
  lastReviewAt?: string;
  lastVerdict?: string;
  notes?: string;
};

export type TemporalCatalog = {
  schemaVersion: typeof TEMPORAL_CATALOG_SCHEMA;
  updatedAt: string;
  ownerRole: string;
  processDoc: string;
  items: TemporalDecisionItem[];
};

export function parseIsoDateOnly(iso: string): number {
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return Number.isFinite(t) ? t : 0;
}

export function isDue(item: TemporalDecisionItem, now: Date = new Date()): boolean {
  if (item.status === "closed" || item.status === "retire") return false;
  if (item.status === "due" || item.status === "in_review" || item.status === "replace") {
    return true;
  }
  const next = parseIsoDateOnly(item.nextReviewAt);
  if (!next) return false;
  return next <= now.getTime();
}

export function effectiveStatus(item: TemporalDecisionItem, now: Date = new Date()): TemporalStatus {
  if (item.status === "closed" || item.status === "retire" || item.status === "in_review" || item.status === "replace") {
    return item.status;
  }
  if (isDue(item, now) && (item.status === "open" || item.status === "keep" || item.status === "due")) {
    return "due";
  }
  return item.status;
}

export function loadCatalog(repoRoot: string): TemporalCatalog {
  const full = path.join(repoRoot, CATALOG_REL);
  if (!existsSync(full)) {
    return {
      schemaVersion: TEMPORAL_CATALOG_SCHEMA,
      updatedAt: new Date().toISOString(),
      ownerRole: "pmo",
      processDoc: "docs/agent-ops/TEMPORAL-DECISIONS.md",
      items: [],
    };
  }
  const raw = JSON.parse(readFileSync(full, "utf8")) as TemporalCatalog;
  return {
    ...raw,
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}

export function saveCatalog(repoRoot: string, catalog: TemporalCatalog): void {
  const full = path.join(repoRoot, CATALOG_REL);
  mkdirSync(path.dirname(full), { recursive: true });
  const payload: TemporalCatalog = {
    ...catalog,
    schemaVersion: TEMPORAL_CATALOG_SCHEMA,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(full, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function listDueItems(catalog: TemporalCatalog, now: Date = new Date()): TemporalDecisionItem[] {
  return catalog.items
    .filter((item) => isDue(item, now))
    .sort((a, b) => a.priority - b.priority || a.nextReviewAt.localeCompare(b.nextReviewAt));
}

export function measureTemporalReview(options: {
  repoRoot: string;
  now?: Date;
  topN?: number;
}): {
  schemaVersion: "openclinxr.temporal-review-measure.v1";
  measuredAt: string;
  dueCount: number;
  openCount: number;
  topDue: Array<{ id: string; title: string; priority: number; analysisOwnerRole: string; nextReviewAt: string }>;
  bannerLine: string;
  forceAttention: boolean;
} {
  const now = options.now ?? new Date();
  const topN = options.topN ?? 3;
  const catalog = loadCatalog(options.repoRoot);
  const due = listDueItems(catalog, now);
  const openCount = catalog.items.filter((i) => i.status !== "closed" && i.status !== "retire").length;
  const topDue = due.slice(0, topN).map((i) => ({
    id: i.id,
    title: i.title,
    priority: i.priority,
    analysisOwnerRole: i.analysisOwnerRole,
    nextReviewAt: i.nextReviewAt,
  }));
  const forceAttention = due.length > 0;
  const bannerLine = forceAttention
    ? `TEMPORAL DUE: ${due.length} decision(s) — top: ${topDue.map((d) => d.id).join(", ") || "—"} (pnpm temporal:review -- due | queue)`
    : "TEMPORAL: no decisions due";
  return {
    schemaVersion: "openclinxr.temporal-review-measure.v1",
    measuredAt: now.toISOString(),
    dueCount: due.length,
    openCount,
    topDue,
    bannerLine,
    forceAttention,
  };
}

export function buildQueueMarkdown(catalog: TemporalCatalog, now: Date = new Date()): string {
  const due = listDueItems(catalog, now);
  const lines = [
    `# Temporal review queue (warm)`,
    ``,
    `**Generated:** ${now.toISOString()} · **Owner:** pmo · **Process:** [TEMPORAL-DECISIONS.md](./TEMPORAL-DECISIONS.md)`,
    ``,
    `Regenerate: \`pnpm temporal:review -- queue\`. Do not treat as product Next dequeue unless orchestrator promotes.`,
    ``,
    `## Due (${due.length})`,
    ``,
  ];
  if (due.length === 0) {
    lines.push("_None due._", ``);
  } else {
    lines.push(
      `| Priority | Id | Analysis | Execute | Next review | Title |`,
      `|----------|----|----------|---------|-------------|-------|`,
    );
    for (const i of due) {
      lines.push(
        `| ${i.priority} | \`${i.id}\` | ${i.analysisOwnerRole} | ${i.executeOwnerRole} | ${i.nextReviewAt} | ${i.title} |`,
      );
    }
    lines.push(``);
    lines.push(`## Suggested analysis prompts`);
    lines.push(``);
    for (const i of due.slice(0, 5)) {
      lines.push(`### ${i.id}`);
      lines.push(``);
      lines.push(`- **Revisit:** ${i.revisitWhy}`);
      lines.push(`- **Context:** ${i.context}`);
      lines.push(`- **Hints:** ${i.workProductHints.map((h) => `\`${h}\``).join(", ") || "—"}`);
      lines.push(
        `- **Done when:** Verdict KEEP (reschedule) | REPLACE/RETIRE (queue work for ${i.executeOwnerRole}) recorded via \`pnpm temporal:review -- mark --id ${i.id} --status ...\``,
      );
      lines.push(``);
    }
  }
  lines.push(`## Open catalog size: ${catalog.items.length}`);
  lines.push(``);
  return lines.join("\n");
}

export function addDaysIso(from: Date, days: number): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): {
  command: string;
  id?: string;
  title?: string;
  cadenceDays?: number;
  status?: TemporalStatus;
  days?: number;
  analysisOwnerRole?: string;
  executeOwnerRole?: string;
  context?: string;
  revisitWhy?: string;
  priority?: number;
  json: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  const command = args[0] ?? "help";
  let id: string | undefined;
  let title: string | undefined;
  let cadenceDays: number | undefined;
  let status: TemporalStatus | undefined;
  let days: number | undefined;
  let analysisOwnerRole: string | undefined;
  let executeOwnerRole: string | undefined;
  let context: string | undefined;
  let revisitWhy: string | undefined;
  let priority: number | undefined;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (a === "--json") json = true;
    else if (a === "--id" && next) {
      id = next;
      i++;
    } else if (a === "--title" && next) {
      title = next;
      i++;
    } else if (a === "--cadence-days" && next) {
      cadenceDays = Number(next);
      i++;
    } else if (a === "--status" && next) {
      status = next as TemporalStatus;
      i++;
    } else if (a === "--days" && next) {
      days = Number(next);
      i++;
    } else if (a === "--analysis-role" && next) {
      analysisOwnerRole = next;
      i++;
    } else if (a === "--execute-role" && next) {
      executeOwnerRole = next;
      i++;
    } else if (a === "--context" && next) {
      context = next;
      i++;
    } else if (a === "--revisit-why" && next) {
      revisitWhy = next;
      i++;
    } else if (a === "--priority" && next) {
      priority = Number(next);
      i++;
    }
  }
  return {
    command,
    id,
    title,
    cadenceDays,
    status,
    days,
    analysisOwnerRole,
    executeOwnerRole,
    context,
    revisitWhy,
    priority,
    json,
  };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === "--help") {
    console.log(`temporal-review — PMO catalog for time-bound decisions

Usage:
  pnpm temporal:review -- list [--json]
  pnpm temporal:review -- due [--json]
  pnpm temporal:review -- measure [--json]
  pnpm temporal:review -- queue
  pnpm temporal:review -- register --id ID --title "..." --cadence-days N \\
       --analysis-role ROLE --execute-role ROLE --context "..." --revisit-why "..."
  pnpm temporal:review -- mark --id ID --status keep|replace|retire|in_review|closed|due|open
  pnpm temporal:review -- reschedule --id ID --days N

Catalog: ${CATALOG_REL}
Process: docs/agent-ops/TEMPORAL-DECISIONS.md
`);
    process.exitCode = 0;
    return;
  }

  if (args.command === "list") {
    const catalog = loadCatalog(repoRoot);
    const rows = catalog.items.map((i) => ({
      ...i,
      effectiveStatus: effectiveStatus(i),
    }));
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(`items=${rows.length}`);
      for (const r of rows) {
        console.log(
          `${r.effectiveStatus.padEnd(10)} p${r.priority} ${r.nextReviewAt} ${r.id} → ${r.analysisOwnerRole}`,
        );
      }
    }
    return;
  }

  if (args.command === "due") {
    const catalog = loadCatalog(repoRoot);
    const due = listDueItems(catalog);
    if (args.json) console.log(JSON.stringify(due, null, 2));
    else {
      console.log(`due=${due.length}`);
      for (const r of due) {
        console.log(`p${r.priority} ${r.id} analysis=${r.analysisOwnerRole} next=${r.nextReviewAt}`);
        console.log(`  ${r.title}`);
      }
    }
    process.exitCode = due.length > 0 ? 2 : 0;
    return;
  }

  if (args.command === "measure") {
    const m = measureTemporalReview({ repoRoot });
    mkdirSync(path.join(repoRoot, ".openclinxr/temporal-review"), { recursive: true });
    writeFileSync(path.join(repoRoot, STATE_REL), `${JSON.stringify(m, null, 2)}\n`, "utf8");
    if (args.json) console.log(JSON.stringify(m, null, 2));
    else console.log(m.bannerLine);
    process.exitCode = m.forceAttention ? 2 : 0;
    return;
  }

  if (args.command === "queue") {
    const catalog = loadCatalog(repoRoot);
    const md = buildQueueMarkdown(catalog);
    writeFileSync(path.join(repoRoot, QUEUE_REL), md, "utf8");
    const due = listDueItems(catalog);
    console.log(JSON.stringify({ wrote: QUEUE_REL, dueCount: due.length }, null, 2));
    process.exitCode = due.length > 0 ? 2 : 0;
    return;
  }

  if (args.command === "register") {
    if (!args.id || !args.title) {
      console.error("register requires --id and --title");
      process.exitCode = 1;
      return;
    }
    const catalog = loadCatalog(repoRoot);
    if (catalog.items.some((i) => i.id === args.id)) {
      console.error(`id already exists: ${args.id}`);
      process.exitCode = 1;
      return;
    }
    const cadenceDays = args.cadenceDays ?? 90;
    const now = new Date();
    const item: TemporalDecisionItem = {
      id: args.id,
      title: args.title,
      decidedAt: now.toISOString().slice(0, 10),
      context: args.context ?? "(registered via CLI)",
      revisitWhy: args.revisitWhy ?? "(fill on first review)",
      cadenceDays,
      nextReviewAt: addDaysIso(now, cadenceDays),
      priority: args.priority ?? 2,
      status: "open",
      analysisOwnerRole: args.analysisOwnerRole ?? "openclaw-drift-police",
      executeOwnerRole: args.executeOwnerRole ?? "implementation-planning-lead",
      workProductHints: [],
      outcomeCreatesWork: true,
    };
    catalog.items.push(item);
    saveCatalog(repoRoot, catalog);
    console.log(JSON.stringify({ registered: item.id, nextReviewAt: item.nextReviewAt }, null, 2));
    return;
  }

  if (args.command === "mark") {
    if (!args.id || !args.status) {
      console.error("mark requires --id and --status");
      process.exitCode = 1;
      return;
    }
    const catalog = loadCatalog(repoRoot);
    const item = catalog.items.find((i) => i.id === args.id);
    if (!item) {
      console.error(`unknown id: ${args.id}`);
      process.exitCode = 1;
      return;
    }
    item.status = args.status;
    item.lastReviewAt = new Date().toISOString().slice(0, 10);
    item.lastVerdict = args.status;
    if (args.status === "keep") {
      item.nextReviewAt = addDaysIso(new Date(), item.cadenceDays);
      item.status = "open";
    }
    saveCatalog(repoRoot, catalog);
    console.log(
      JSON.stringify(
        { id: item.id, status: item.status, nextReviewAt: item.nextReviewAt, lastVerdict: item.lastVerdict },
        null,
        2,
      ),
    );
    return;
  }

  if (args.command === "reschedule") {
    if (!args.id || args.days == null || !Number.isFinite(args.days)) {
      console.error("reschedule requires --id and --days N");
      process.exitCode = 1;
      return;
    }
    const catalog = loadCatalog(repoRoot);
    const item = catalog.items.find((i) => i.id === args.id);
    if (!item) {
      console.error(`unknown id: ${args.id}`);
      process.exitCode = 1;
      return;
    }
    item.nextReviewAt = addDaysIso(new Date(), args.days);
    if (item.status === "due") item.status = "open";
    saveCatalog(repoRoot, catalog);
    console.log(JSON.stringify({ id: item.id, nextReviewAt: item.nextReviewAt }, null, 2));
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
