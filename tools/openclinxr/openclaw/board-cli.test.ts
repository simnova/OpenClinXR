import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cmdReview,
  BOARD_FIXED_CHECKLIST,
  BOARD_SCHEMA,
  DEFAULT_BOARD_REPO,
  NO_PRODUCT_DATA_BANNER,
  appendBoardStatusDirective,
  assertCoordinationOnlyBody,
  boardRecordPath,
  boardStatusDirective,
  buildCloseCommentBody,
  buildRoleTaskList,
  buildSliceIssueBody,
  buildStatusCommentBody,
  cmdClose,
  cmdSliceOpen,
  cmdStatus,
  formatArgvForDisplay,
  loadBoardRecord,
  parseBoardArgs,
  parseIssueCreateUrl,
  planGhIssueClose,
  planGhIssueComment,
  planGhIssueCreate,
  saveBoardRecord,
  type BoardSliceRecord,
} from "./board-cli.ts";

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "openclaw-board-"));
}

function seedBoard(
  root: string,
  partial: Partial<BoardSliceRecord> & Pick<BoardSliceRecord, "sliceId" | "issueNumber">,
): BoardSliceRecord {
  const record: BoardSliceRecord = {
    schemaVersion: BOARD_SCHEMA,
    url: partial.url ?? `https://github.com/${DEFAULT_BOARD_REPO}/issues/${partial.issueNumber}`,
    roles: partial.roles ?? ["asset-pipeline-lead", "xr-systems-architect"],
    title: partial.title ?? "test slice",
    repo: partial.repo ?? DEFAULT_BOARD_REPO,
    dryRun: partial.dryRun ?? false,
    createdAt: partial.createdAt ?? "2026-08-04T00:00:00.000Z",
    sliceId: partial.sliceId,
    issueNumber: partial.issueNumber,
  };
  saveBoardRecord(root, record);
  return record;
}

describe("board-cli parse + pure builders", () => {
  it("parses slice-open flags including dry-run and roles list", () => {
    const f = parseBoardArgs([
      "slice-open",
      "--slice-id",
      "demo-slice",
      "--title",
      "Demo board open",
      "--roles",
      "asset-pipeline-lead,xr-systems-architect",
      "--repo",
      "simnova/OpenClinXR",
      "--dry-run",
    ]);
    expect(f.command).toBe("slice-open");
    expect(f.sliceId).toBe("demo-slice");
    expect(f.title).toBe("Demo board open");
    expect(f.roles).toEqual(["asset-pipeline-lead", "xr-systems-architect"]);
    expect(f.repo).toBe(DEFAULT_BOARD_REPO);
    expect(f.dryRun).toBe(true);
  });

  it("builds role task-list with verify/review/orchestrator", () => {
    const items = buildRoleTaskList(["asset-pipeline-lead", "productivity-skeptic"]);
    expect(items).toContain("- [ ] role: asset-pipeline-lead");
    expect(items).toContain("- [ ] role: productivity-skeptic");
    for (const step of BOARD_FIXED_CHECKLIST) {
      expect(items).toContain(`- [ ] ${step}`);
    }
    expect(items.at(-1)).toBe("- [ ] orchestrator");
  });

  it("builds issue body with task-list + no-product-data guard", () => {
    const body = buildSliceIssueBody({
      sliceId: "garment-v2",
      title: "Garment vertical (coord)",
      roles: ["asset-pipeline-lead", "xr-systems-architect"],
    });
    expect(body).toContain("**sliceId:** `garment-v2`");
    expect(body).toContain("- [ ] role: asset-pipeline-lead");
    expect(body).toContain("- [ ] verify");
    expect(body).toContain("- [ ] review");
    expect(body).toContain("- [ ] orchestrator");
    expect(body).toContain(NO_PRODUCT_DATA_BANNER);
    expect(body).toContain("pnpm openclaw:board status");
    // No product payload fields
    expect(body.toLowerCase()).not.toContain("phi:");
    expect(body.toLowerCase()).not.toContain("clinical diagnosis");
  });

  it("plans well-formed gh issue create argv with task-list body", () => {
    const body = buildSliceIssueBody({
      sliceId: "s1",
      title: "S1 board",
      roles: ["chief-coordinator"],
    });
    const plan = planGhIssueCreate({
      repo: DEFAULT_BOARD_REPO,
      title: "S1 board",
      body,
    });
    expect(plan.argv[0]).toBe("gh");
    expect(plan.argv[1]).toBe("issue");
    expect(plan.argv[2]).toBe("create");
    expect(plan.argv).toContain("--repo");
    expect(plan.argv).toContain(DEFAULT_BOARD_REPO);
    expect(plan.argv).toContain("--title");
    expect(plan.argv).toContain("S1 board");
    expect(plan.argv).toContain("--body");
    const bodyIdx = plan.argv.indexOf("--body");
    expect(plan.argv[bodyIdx + 1]).toContain("- [ ] role: chief-coordinator");
    expect(plan.argv[bodyIdx + 1]).toContain("- [ ] verify");
    expect(plan.display).toContain("gh issue create");
  });

  it("plans gh issue comment / close from resolved issue number", () => {
    const commentBody = buildStatusCommentBody("asset-pipeline-lead", "BLUF: handoff written; evidence ok");
    const commentPlan = planGhIssueComment({
      issueNumber: 42,
      repo: DEFAULT_BOARD_REPO,
      body: commentBody,
    });
    expect(commentPlan.argv).toEqual([
      "gh",
      "issue",
      "comment",
      "42",
      "--repo",
      DEFAULT_BOARD_REPO,
      "--body",
      commentBody,
    ]);
    expect(commentBody).toContain("**role:** `asset-pipeline-lead`");
    expect(commentBody).toContain(NO_PRODUCT_DATA_BANNER);

    const closeBody = buildCloseCommentBody("verify ok; slice closed");
    const closePlan = planGhIssueClose({
      issueNumber: 42,
      repo: DEFAULT_BOARD_REPO,
      comment: closeBody,
    });
    expect(closePlan.argv[0]).toBe("gh");
    expect(closePlan.argv).toContain("close");
    expect(closePlan.argv).toContain("42");
    expect(closePlan.argv).toContain("--comment");
    expect(closePlan.display).toContain("gh issue close");
  });

  it("rejects product/clinical leakage tokens", () => {
    expect(() => assertCoordinationOnlyBody("patient name: Maya")).toThrow(/product\/clinical/);
    expect(() => assertCoordinationOnlyBody("contains PHI: yes")).toThrow(/product\/clinical/);
    expect(() => assertCoordinationOnlyBody("clinical diagnosis asthma")).toThrow(/product\/clinical/);
    expect(() => buildStatusCommentBody("r", "ok handoff")).not.toThrow();
  });

  it("parses issue URL from gh create stdout", () => {
    const { issueNumber, url } = parseIssueCreateUrl(
      "https://github.com/simnova/OpenClinXR/issues/99\n",
    );
    expect(issueNumber).toBe(99);
    expect(url).toBe("https://github.com/simnova/OpenClinXR/issues/99");
  });

  it("formats board status directive for spawn prompts", () => {
    const line = boardStatusDirective("demo-slice", "xr-systems-architect");
    expect(line).toContain("pnpm openclaw:board status");
    expect(line).toContain("--slice-id demo-slice");
    expect(line).toContain("--role xr-systems-architect");
    const prompt = appendBoardStatusDirective("Do the work.", "demo-slice", "xr-systems-architect");
    expect(prompt).toContain("Do the work.");
    expect(prompt).toContain(line);
    // idempotent
    expect(appendBoardStatusDirective(prompt, "demo-slice", "xr-systems-architect")).toBe(prompt);
  });
});

describe("board-cli dry-run commands (no live gh)", () => {
  it("slice-open --dry-run writes board record and does not require gh", () => {
    const root = tempRoot();
    const { record, plan, recordPath } = cmdSliceOpen(root, {
      sliceId: "dry-slice-a",
      title: "Dry open [coord]",
      roles: ["asset-pipeline-lead", "xr-systems-architect"],
      repo: DEFAULT_BOARD_REPO,
      dryRun: true,
    });
    expect(plan.argv.slice(0, 3)).toEqual(["gh", "issue", "create"]);
    expect(plan.argv).toContain("--body");
    const body = plan.argv[plan.argv.indexOf("--body") + 1]!;
    expect(body).toContain("- [ ] role: asset-pipeline-lead");
    expect(body).toContain("- [ ] role: xr-systems-architect");
    expect(body).toContain("- [ ] verify");
    expect(body).toContain(NO_PRODUCT_DATA_BANNER);
    expect(record.dryRun).toBe(true);
    expect(record.issueNumber).toBeNull();
    expect(record.schemaVersion).toBe(BOARD_SCHEMA);
    expect(existsSync(recordPath)).toBe(true);
    const loaded = loadBoardRecord(root, "dry-slice-a");
    expect(loaded.roles).toEqual(["asset-pipeline-lead", "xr-systems-architect"]);
    expect(loaded.sliceId).toBe("dry-slice-a");
    // write-scope: only this slice's board file under openclaw/
    expect(boardRecordPath(root, "dry-slice-a")).toBe(recordPath);
  });

  it("status --dry-run resolves issue# and builds gh issue comment", () => {
    const root = tempRoot();
    seedBoard(root, { sliceId: "dry-slice-b", issueNumber: 77, roles: ["hrbp"] });
    const { plan, issueNumber, commentBody } = cmdStatus(root, {
      sliceId: "dry-slice-b",
      role: "hrbp",
      body: "BLUF: roster path-scope ok; no product edits",
      dryRun: true,
    });
    expect(issueNumber).toBe(77);
    expect(plan.argv.slice(0, 4)).toEqual(["gh", "issue", "comment", "77"]);
    expect(plan.argv).toContain("--repo");
    expect(plan.argv).toContain(DEFAULT_BOARD_REPO);
    expect(commentBody).toContain("hrbp");
    expect(commentBody).toContain("BLUF: roster path-scope ok");
    expect(commentBody).toContain(NO_PRODUCT_DATA_BANNER);
    expect(formatArgvForDisplay(plan.argv)).toContain("gh issue comment");
  });

  it("close --dry-run builds gh issue close + resolution comment", () => {
    const root = tempRoot();
    seedBoard(root, { sliceId: "dry-slice-c", issueNumber: 88 });
    const { closePlan, commentPlan, issueNumber } = cmdClose(root, {
      sliceId: "dry-slice-c",
      body: "verify ok; handoffs complete",
      dryRun: true,
    });
    expect(issueNumber).toBe(88);
    expect(closePlan.argv.slice(0, 4)).toEqual(["gh", "issue", "close", "88"]);
    expect(closePlan.argv).toContain("--comment");
    expect(commentPlan.argv.slice(0, 4)).toEqual(["gh", "issue", "comment", "88"]);
    const comment = closePlan.argv[closePlan.argv.indexOf("--comment") + 1]!;
    expect(comment).toContain("verify ok");
    expect(comment).toContain(NO_PRODUCT_DATA_BANNER);
  });

  it("status rejects clinical leakage in --body before any gh plan", () => {
    const root = tempRoot();
    seedBoard(root, { sliceId: "dry-slice-d", issueNumber: 1 });
    expect(() =>
      cmdStatus(root, {
        sliceId: "dry-slice-d",
        role: "pediatrics-physician",
        body: "clinical diagnosis confirmed",
        dryRun: true,
      }),
    ).toThrow(/product\/clinical/);
  });

  it("status without board file fails closed (no gh)", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, ".openclinxr", "openclaw"), { recursive: true });
    expect(() =>
      cmdStatus(root, {
        sliceId: "missing-slice",
        role: "r",
        body: "x",
        dryRun: true,
      }),
    ).toThrow(/Board record not found/);
  });

  it("round-trips board record JSON shape", () => {
    const root = tempRoot();
    const rec = seedBoard(root, {
      sliceId: "shape-x",
      issueNumber: 3,
      roles: ["a", "b"],
      title: "T",
    });
    const raw = readFileSync(boardRecordPath(root, "shape-x"), "utf8");
    const parsed = JSON.parse(raw) as BoardSliceRecord;
    expect(parsed).toMatchObject({
      schemaVersion: BOARD_SCHEMA,
      issueNumber: 3,
      sliceId: "shape-x",
      roles: ["a", "b"],
      title: "T",
      repo: DEFAULT_BOARD_REPO,
    });
    expect(parsed.url).toContain("/issues/3");
    expect(rec.issueNumber).toBe(3);
  });
});

describe("board review (merge-gate status flow)", () => {
  it("approve → agent-review/<role> success status + PR comment plan (dry-run)", () => {
    const r = cmdReview({ repo: "o/r", pr: 7, verdict: "approve", role: "skeptic", body: "no behavior change", dryRun: true });
    expect(r.state).toBe("success");
    expect(r.statusPlan.argv).toContain("state=success");
    expect(r.statusPlan.argv).toContain("context=agent-review/skeptic");
    expect(r.statusPlan.argv.some((a) => a.includes("statuses/"))).toBe(true);
    expect(r.reviewPlan.argv.slice(0, 5)).toEqual(["gh", "pr", "review", "7", "--repo"]);
    expect(r.reviewPlan.argv).toContain("--comment");
  });
  it("request-changes → failure status", () => {
    const r = cmdReview({ repo: "o/r", pr: 7, verdict: "request-changes", role: "skeptic", body: "bug at x.ts:1", dryRun: true });
    expect(r.state).toBe("failure");
    expect(r.statusPlan.argv).toContain("state=failure");
  });
  it("rejects invalid verdict + product-data body", () => {
    expect(() => cmdReview({ repo: "o/r", pr: 7, verdict: "lgtm", role: "s", body: "x", dryRun: true })).toThrow(/verdict/);
    expect(() => cmdReview({ repo: "o/r", pr: 7, verdict: "approve", role: "s", body: "patient name Jane", dryRun: true })).toThrow(/patient name/);
  });
});
