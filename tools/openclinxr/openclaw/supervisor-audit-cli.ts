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
import { getBoardSnapshot } from "./board-snapshot-cache.js";
import {
  appendHistory, classifyDoneClaims, markChronic, PERSISTENCE_WINDOW, priorFindingKeys, readyDepth, resolvedSince, verifyDoneClaim,
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

  /**
   * Tolerant TTL and stale-on-failure ON. This runs hourly, the board changes slowly, and a labelled
   * stale answer beats no audit at all — the live read failed twice on 2026-08-24 when the GraphQL
   * budget was spent. The dequeue makes the opposite choice for the opposite reason.
   *
   * Truncation is refused inside the cache, so `items.length === totalCount` holds by construction
   * and the explicit check this replaced is no longer reachable from here.
   */
  /**
   * TTL 0 — the audit always reads fresh. It may still serve a STALE snapshot when the live read
   * FAILS, which is the case the cache is genuinely for here.
   *
   * MEASURED on iteration 5, by the loop against itself: a 30-minute TTL made the audit report
   * ready=6 immediately after a correction that made it 7. The snapshot was 7.5 minutes old and
   * predated the change. So duty 2 under-reported precisely when the loop was working, and an
   * iteration could not see its own correction.
   *
   * The cost is one board read per hourly run — which is what it was before caching. The cache's
   * real beneficiary is the DEQUEUE (60s TTL, many calls per cycle), and that is untouched.
   */
  const snapshot = getBoardSnapshot(REPO, { ttlMs: 0, allowStaleOnFailure: true });
  const items = snapshot.items as Array<{ status?: string; priority?: string; factory?: string; content?: { number?: number } }>;
  const findings: Finding[] = [];

  if (snapshot.staleReason) {
    findings.push({ duty: 1, key: "board-snapshot-stale", detail: snapshot.staleReason });
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
    // Landed-and-open is the NORMAL state between merge and grade, not drift; only Graded-and-open
    // is drift. Extracted to `classifyDoneClaims` so the distinction is unit-testable — it was
    // inline and untested, and reported duty 3's own happy path as a defect. Clauses (24) and (25).
    const classified = classifyDoneClaims(doneClaims);
    findings.push(...classified.findings);
    // pendingReviews is TELEMETRY: reported in the artifact, never a finding, never chronic-eligible.
    const pendingReviews = classified.pendingReviews;

  /**
   * Residue is reported SEPARATELY from ok, and it is the finding `ok` structurally cannot make.
   * MEASURED on #181: merge artifact `proofsOk: true`, check `passed: true`, and the principal
   * assertion still `it.fails` — Vitest counts an expected failure as a pass.
   */
  // Filtered to ok claims: an ALREADY-unverified claim generates redundant noise, and the reader
  // has a stronger finding for it already.
  for (const c of doneClaims.filter((x) => x.ok && x.residue && x.residue.status !== "none")) {
    const r0 = c.residue!;
    const where = r0.files.map((r) => `${r.file} (${r.count})`).join(", ");
    if (r0.status === "not_determined") {
      findings.push({ duty: 3, key: `expected-failure-residue-unreadable-${c.issue}`,
        detail: `#${c.issue}: a proof file named by its artifact could not be read (${where}) — residue NOT DETERMINED, not clean` });
      continue;
    }
    findings.push({ duty: 3, key: `expected-failure-residue-${c.issue}`,
      detail: `#${c.issue} (${c.stage}) reports verified, but a proof file named by its artifact still carries an `
        + `unflipped it.fails: ${where}. A green merge artifact cannot see this — vitest counts an `
        + `expected failure as a pass. Look before believing the claim. `
        + `(artifact headSha ${String(r0.artifactHeadSha).slice(0, 8)}; residue counted in the CURRENT tree — `
        + `a later card planting a RED in the same file would look identical.)` });
  }

  const prior = priorFindingKeys(REPO);
  // Two windows, two questions: `prior` is the tight chronic predicate, `persistence` is how long it
  // has gone without clearing. Feeding one window to both pinned severity at CHRONIC_AFTER + 1.
  const persistence = priorFindingKeys(REPO, PERSISTENCE_WINDOW);
  const marked = markChronic(findings, prior, persistence);
  const audit: SupervisorAudit = {
    schemaVersion: "openclinxr.supervisor-audit.v1",
    at: new Date().toISOString(), head,
    readyDepth: depth, doneClaims, pendingReviews, findings: marked,
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
