import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addDaysIso,
  buildQueueMarkdown,
  effectiveStatus,
  isDue,
  listDueItems,
  loadCatalog,
  measureTemporalReview,
  saveCatalog,
  type TemporalCatalog,
  TEMPORAL_CATALOG_SCHEMA,
} from "./temporal-review-cli.ts";

function seedCatalog(repoRoot: string, items: TemporalCatalog["items"]): void {
  mkdirSync(path.join(repoRoot, "docs/agent-ops"), { recursive: true });
  saveCatalog(repoRoot, {
    schemaVersion: TEMPORAL_CATALOG_SCHEMA,
    updatedAt: new Date().toISOString(),
    ownerRole: "pmo",
    processDoc: "docs/agent-ops/TEMPORAL-DECISIONS.md",
    items,
  });
}

describe("temporal-review-cli", () => {
  it("detects due vs open by nextReviewAt", () => {
    const past = {
      id: "past",
      title: "past",
      decidedAt: "2026-01-01",
      context: "c",
      revisitWhy: "r",
      cadenceDays: 30,
      nextReviewAt: "2026-07-01",
      priority: 1,
      status: "open" as const,
      analysisOwnerRole: "hrbp",
      executeOwnerRole: "architect",
      workProductHints: [],
      outcomeCreatesWork: true,
    };
    const future = { ...past, id: "future", nextReviewAt: "2026-12-01" };
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(isDue(past, now)).toBe(true);
    expect(isDue(future, now)).toBe(false);
    expect(effectiveStatus(past, now)).toBe("due");
    expect(effectiveStatus(future, now)).toBe("open");
  });

  it("closed and retire are never due", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(
      isDue(
        {
          id: "x",
          title: "x",
          decidedAt: "2020-01-01",
          context: "c",
          revisitWhy: "r",
          cadenceDays: 1,
          nextReviewAt: "2020-01-02",
          priority: 1,
          status: "closed",
          analysisOwnerRole: "pmo",
          executeOwnerRole: "pmo",
          workProductHints: [],
          outcomeCreatesWork: false,
        },
        now,
      ),
    ).toBe(false);
  });

  it("measure and queue over temp catalog", () => {
    const root = mkdtempSync(path.join(tmpdir(), "temporal-review-"));
    seedCatalog(root, [
      {
        id: "ccusage-grok-token-workaround",
        title: "ccusage dual path",
        decidedAt: "2026-06-01",
        context: "workaround",
        revisitWhy: "native tokens?",
        cadenceDays: 60,
        nextReviewAt: "2026-07-01",
        priority: 1,
        status: "open",
        analysisOwnerRole: "openclaw-drift-police",
        executeOwnerRole: "implementation-planning-lead",
        workProductHints: ["tools/openclinxr/openclaw/grok-token-io.ts"],
        outcomeCreatesWork: true,
      },
      {
        id: "future-item",
        title: "future",
        decidedAt: "2026-08-01",
        context: "c",
        revisitWhy: "r",
        cadenceDays: 90,
        nextReviewAt: "2027-01-01",
        priority: 9,
        status: "open",
        analysisOwnerRole: "architect",
        executeOwnerRole: "architect",
        workProductHints: [],
        outcomeCreatesWork: true,
      },
    ]);
    const now = new Date("2026-08-02T12:00:00.000Z");
    const catalog = loadCatalog(root);
    expect(listDueItems(catalog, now)).toHaveLength(1);
    const m = measureTemporalReview({ repoRoot: root, now });
    expect(m.dueCount).toBe(1);
    expect(m.forceAttention).toBe(true);
    expect(m.bannerLine).toContain("TEMPORAL DUE");
    expect(m.topDue[0]?.id).toBe("ccusage-grok-token-workaround");
    const md = buildQueueMarkdown(catalog, now);
    expect(md).toContain("ccusage-grok-token-workaround");
    expect(md).toContain("openclaw-drift-police");
    writeFileSync(path.join(root, "docs/agent-ops/temporal-review-queue.md"), md);
    expect(existsSync(path.join(root, "docs/agent-ops/temporal-review-queue.md"))).toBe(true);
  });

  it("addDaysIso advances calendar days", () => {
    expect(addDaysIso(new Date("2026-08-02T00:00:00.000Z"), 60)).toBe("2026-10-01");
  });

  it("loadCatalog empty when missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "temporal-empty-"));
    const c = loadCatalog(root);
    expect(c.items).toEqual([]);
    expect(c.ownerRole).toBe("pmo");
  });
});
