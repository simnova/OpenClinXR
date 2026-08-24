/**
 * Runs one supervisor iteration's MEASUREMENT and writes `openclinxr.supervisor-audit.v1`.
 *
 * Reads the live board and the open issues once each, joins them through `briefFromIssue`, verifies
 * every card claiming Landed/Graded, diffs findings against prior runs, and appends to history.
 *
 * It deliberately performs no corrections. Duty 4 is judgement — file a card, or change agent
 * configuration — and belongs to the reviewers. A supervisor that fixes what it measures cannot be
 * trusted to report honestly on its own work.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { briefFromIssue } from "./board-brief.js";
import {
  appendHistory, markChronic, priorFindingKeys, readyDepth, resolvedSince, verifyDoneClaim,
} from "./supervisor-audit.js";
import type { Finding, SupervisorAudit } from "./supervisor-audit.js";

const REPO = join(dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = join(REPO, ".openclinxr/openclaw/supervisor-audit-latest.json");

const gh = (argv: string[]): string =>
  execFileSync("gh", argv, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

const factoryStepOf = (body: string): string | null =>
  /^##\s*factory_step:\s*([a-z_]+)\s*$/imu.exec(body ?? "")?.[1] ?? null;

async function main(): Promise<void> {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();

  const board = JSON.parse(gh(["project", "item-list", "7", "--owner", "simnova", "--limit", "5000", "--format", "json"])) as
    { totalCount?: number; items?: Array<{ status?: string; priority?: string; factory?: string; content?: { number?: number } }> };
  const items = board.items ?? [];
  const findings: Finding[] = [];

  // A truncated read must never be ranked or counted — the same refusal the dequeue makes.
  if ((board.totalCount ?? -1) !== items.length) {
    findings.push({ duty: 1, key: "board-read-truncated",
      detail: `read ${items.length} of ${board.totalCount} board items — counts below would be wrong` });
  }

  const issues = JSON.parse(gh(["issue", "list", "--repo", "simnova/OpenClinXR", "--state", "open",
    "--limit", "500", "--json", "number,title,body"])) as Array<{ number: number; title: string; body: string }>;
  const byNumber = new Map(issues.map((i) => [i.number, i]));

  const cards = issues.map((i) => {
    const row = items.find((it) => it.content?.number === i.number);
    return {
      number: i.number,
      dispatchable: Boolean(briefFromIssue(i as never).dispatchable),
      factoryStep: factoryStepOf(i.body),
      planted: row?.factory === "Planted",
      prioritized: typeof row?.priority === "string" && row.priority.length > 0,
    };
  });

  const depth = readyDepth(cards);
  if (depth.shortfall > 0) {
    findings.push({ duty: 2, key: "ready-depth-below-floor",
      detail: `${depth.productForward} product-forward ready cards against a floor of ${depth.target} `
        + `(${depth.includingInstrument} ready including instrument). Short by ${depth.shortfall}.` });
  }

  // Duty 3: every card the board says is finished.
  const doneClaims = items
    .filter((it) => (it.factory === "Landed" || it.factory === "Graded") && typeof it.content?.number === "number")
    .filter((it) => byNumber.has(it.content!.number!))
    .map((it) => verifyDoneClaim(REPO, it.content!.number!, String(it.factory)));
  for (const c of doneClaims.filter((x) => !x.ok)) {
    findings.push({ duty: 3, key: `done-unverified-${c.issue}`, detail: `#${c.issue} (${c.stage}): ${c.why}` });
  }

  // An OPEN issue marked Landed/Graded is board drift — the work is claimed done and the card is not
  // closed. Reported separately from a failed verification: they need different corrections.
  for (const c of doneClaims.filter((x) => x.ok)) {
    findings.push({ duty: 3, key: `done-but-open-${c.issue}`,
      detail: `#${c.issue} verified ${c.stage} on main but the issue is still OPEN` });
  }

  const prior = priorFindingKeys(REPO);
  const marked = markChronic(findings, prior);
  const audit: SupervisorAudit = {
    schemaVersion: "openclinxr.supervisor-audit.v1",
    at: new Date().toISOString(), head,
    readyDepth: depth, doneClaims, findings: marked,
    resolved: resolvedSince(marked, prior),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  appendHistory(REPO, audit);

  const chronic = marked.filter((f) => f.chronic);
  console.log(`SUPERVISOR AUDIT  ready=${depth.productForward}/${depth.target} product-forward `
    + `(${depth.includingInstrument} incl. instrument)  findings=${marked.length} chronic=${chronic.length} `
    + `resolved=${audit.resolved.length}  done-claims=${doneClaims.length} failing=${doneClaims.filter((c) => !c.ok).length}`);
  for (const f of chronic) console.log(`  CHRONIC (duty ${f.duty}, seen ${f.occurrences}x): ${f.detail}`);
  console.log(`  report: ${OUT}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main();
}
