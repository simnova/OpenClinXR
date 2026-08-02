import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildArchiveStub,
  buildManifest,
  CRUFT_FREEZE_CATALOG,
  DOCS_ARCHIVE_SCHEMA,
  freezeArchiveBatch,
  freezeExplicitEntries,
  isFreezeCandidateBasename,
  listFreezeCandidates,
  parseDocsArchiveArgs,
  planArchiveBatch,
  planCruftArchiveBatch,
  rebuildArchiveWiki,
  resolveSuccessor,
  NEVER_ARCHIVE_BASENAMES,
  NEVER_ARCHIVE_PATHS,
} from "./docs-archive-cli.ts";
import { classify, HOT_AGENT_OPS_SSOT } from "../../agent-factory/build-doc-authority-registry.ts";

describe("docs-archive-cli pure helpers", () => {
  it("never archives living SSOT basenames", () => {
    for (const name of [
      "PATH-SCOPE.md",
      "CEO-VOICE.md",
      "COMPOSITION-ROOTS.md",
      "DOC-WAREHOUSE.md",
      "MAIN-SESSION-ORCHESTRATOR-ONLY.md",
      "WORKTREE-PROMOTE.md",
      "RACI.md",
      "REVIEW-CADENCE.md",
      "CAPABILITY-EVOLUTION.md",
      "REVISION-INDEX.md",
      "DOC-HYGIENE-CADENCE.md",
      "README.md",
    ]) {
      expect(NEVER_ARCHIVE_BASENAMES.has(name)).toBe(true);
      expect(isFreezeCandidateBasename(name)).toBe(false);
    }
  });

  it("accepts any dated YYYY-MM-DD agent-ops revision basename", () => {
    expect(isFreezeCandidateBasename("2026-08-02-path-scope-policy-v1.md")).toBe(true);
    expect(isFreezeCandidateBasename("2026-08-02-context-opt-wave-c.md")).toBe(true);
    expect(isFreezeCandidateBasename("2026-08-01-path-scope.md")).toBe(true);
    expect(isFreezeCandidateBasename("path-scope-policy-v1.md")).toBe(false);
  });

  it("maps successors for freeze set", () => {
    expect(resolveSuccessor("2026-08-02-path-scope-policy-v1.md")).toBe(
      "docs/agent-ops/PATH-SCOPE.md",
    );
    expect(resolveSuccessor("2026-08-02-ceo-bod-voice-revision.md")).toBe(
      "docs/agent-ops/CEO-VOICE.md",
    );
    expect(resolveSuccessor("2026-08-02-roster-review.md")).toBe(
      "docs/agent-ops/REVIEW-CADENCE.md",
    );
    expect(resolveSuccessor("2026-08-02-context-opt-wave-c.md")).toContain("WORKTREE-PROMOTE");
    expect(resolveSuccessor("2026-08-02-context-opt-higher-v1.md")).toBe(
      "docs/agent-ops/PATH-SCOPE.md",
    );
    expect(resolveSuccessor("2026-08-02-docs-warehouse-v1.md")).toBe(
      "docs/agent-ops/DOC-WAREHOUSE.md",
    );
  });

  it("plans archive batch from temp agent-ops tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "docs-archive-plan-"));
    const agentOps = path.join(root, "docs/agent-ops");
    mkdirSync(agentOps, { recursive: true });
    writeFileSync(path.join(agentOps, "PATH-SCOPE.md"), "# living\n");
    writeFileSync(path.join(agentOps, "2026-08-02-path-scope-policy-v1.md"), "# rev\n");
    writeFileSync(path.join(agentOps, "2026-08-02-ceo-bod-voice-revision.md"), "# voice\n");
    writeFileSync(path.join(agentOps, "notes.md"), "# other\n");

    const basenames = listFreezeCandidates(agentOps);
    expect(basenames).toEqual([
      "2026-08-02-ceo-bod-voice-revision.md",
      "2026-08-02-path-scope-policy-v1.md",
    ]);

    const { candidates, warehouseDir } = planArchiveBatch({
      repoRoot: root,
      batchId: "context-opt-2026-08-02",
    });
    expect(warehouseDir).toBe("docs/_archive/agent-ops/2026-08");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.source).toBe("docs/agent-ops/2026-08-02-ceo-bod-voice-revision.md");
    expect(candidates[0]?.successor).toBe("docs/agent-ops/CEO-VOICE.md");
  });

  it("builds stub and manifest schema", () => {
    const entry = {
      source: "docs/agent-ops/2026-08-02-path-scope-policy-v1.md",
      basename: "2026-08-02-path-scope-policy-v1.md",
      warehouse: "docs/_archive/agent-ops/2026-08/2026-08-02-path-scope-policy-v1.md",
      successor: "docs/agent-ops/PATH-SCOPE.md",
      reason: "dated revision freeze; living SSOT supersedes",
    };
    const stub = buildArchiveStub(entry, "context-opt-2026-08-02");
    expect(stub.startsWith("# ARCHIVED")).toBe(true);
    expect(stub).toContain(entry.warehouse);
    expect(stub).toContain(entry.successor);
    expect(stub.split("\n").filter(Boolean).length).toBeLessThanOrEqual(12);

    const manifest = buildManifest({
      batchId: "context-opt-2026-08-02",
      warehouseDir: "docs/_archive/agent-ops/2026-08",
      files: [entry],
      dryRun: true,
      archivedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(manifest.schemaVersion).toBe(DOCS_ARCHIVE_SCHEMA);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.dryRun).toBe(true);
  });

  it("freeze dry-run does not write; freeze real moves + stubs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "docs-archive-freeze-"));
    const agentOps = path.join(root, "docs/agent-ops");
    mkdirSync(agentOps, { recursive: true });
    const srcRel = "docs/agent-ops/2026-08-02-path-scope-policy-v1.md";
    writeFileSync(path.join(root, srcRel), "# Path-scope policy v1 revision\nfull body\n");

    const dry = freezeArchiveBatch({
      repoRoot: root,
      batchId: "context-opt-2026-08-02",
      dryRun: true,
    });
    expect(dry.moved).toEqual([srcRel]);
    expect(readFileSync(path.join(root, srcRel), "utf8")).toContain("full body");
    expect(existsSync(path.join(root, "docs/_archive"))).toBe(false);

    const real = freezeArchiveBatch({
      repoRoot: root,
      batchId: "context-opt-2026-08-02",
      dryRun: false,
    });
    expect(real.moved).toEqual([srcRel]);
    const stub = readFileSync(path.join(root, srcRel), "utf8");
    expect(stub.startsWith("# ARCHIVED")).toBe(true);
    const warehouse = path.join(
      root,
      "docs/_archive/agent-ops/2026-08/2026-08-02-path-scope-policy-v1.md",
    );
    expect(readFileSync(warehouse, "utf8")).toContain("full body");
    const manifestPath = path.join(root, "docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion: string;
      files: unknown[];
    };
    expect(manifest.schemaVersion).toBe(DOCS_ARCHIVE_SCHEMA);
    expect(manifest.files).toHaveLength(1);

    // Idempotent second freeze skips stubbed files.
    const again = freezeArchiveBatch({
      repoRoot: root,
      batchId: "context-opt-2026-08-02",
      dryRun: false,
    });
    expect(again.moved).toEqual([]);
    expect(again.skipped.some((s) => s.reason === "already stubbed")).toBe(true);
  });

  it("parses CLI args including --set cruft", () => {
    expect(parseDocsArchiveArgs(["plan"])).toMatchObject({
      command: "plan",
      batchId: "context-opt-2026-08-02",
      dryRun: false,
      set: "agent-ops",
    });
    expect(
      parseDocsArchiveArgs(["freeze", "--", "--batch", "context-opt-2026-08-02", "--dry-run"]),
    ).toMatchObject({
      command: "freeze",
      batchId: "context-opt-2026-08-02",
      dryRun: true,
      set: "agent-ops",
    });
    expect(parseDocsArchiveArgs(["plan", "--set", "cruft"])).toMatchObject({
      command: "plan",
      set: "cruft",
      batchId: "cruft-audit-2026-08-02",
    });
    expect(parseDocsArchiveArgs(["wiki"])).toMatchObject({ command: "wiki" });
    expect(parseDocsArchiveArgs(["status"])).toMatchObject({ command: "status" });
  });

  it("cruft catalog never includes protected skills or .openclinxr README", () => {
    const sources = CRUFT_FREEZE_CATALOG.map((c) => c.source);
    expect(sources).toContain("AUTONOMOUS_WORK_PLAN.md");
    expect(sources).toContain("PROJECT_COORDINATION_INDEX.md");
    expect(sources.some((s) => s.startsWith("docs/openclinxr/"))).toBe(true);
    expect(sources.some((s) => s.startsWith("iterations/"))).toBe(true);
    for (const p of NEVER_ARCHIVE_PATHS) {
      expect(sources).not.toContain(p);
    }
  });

  it("plans cruft batch with multi-area warehouse dirs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "docs-archive-cruft-plan-"));
    const { candidates, warehouseDirs, batchId } = planCruftArchiveBatch({ repoRoot: root });
    expect(batchId).toBe("cruft-audit-2026-08-02");
    expect(candidates.length).toBeGreaterThan(10);
    expect(warehouseDirs.some((d) => d.includes("coordination"))).toBe(true);
    expect(warehouseDirs.some((d) => d.includes("openclinxr"))).toBe(true);
    expect(warehouseDirs.some((d) => d.includes("iterations"))).toBe(true);
  });

  it("freezes cruft-style explicit entries into multi-area wiki layout", () => {
    const root = mkdtempSync(path.join(tmpdir(), "docs-archive-cruft-freeze-"));
    writeFileSync(path.join(root, "AUTONOMOUS_WORK_PLAN.md"), "# old plan\nledger body\n");
    mkdirSync(path.join(root, "docs/openclinxr"), { recursive: true });
    writeFileSync(
      path.join(root, "docs/openclinxr/turbo-remote-cache-setup.md"),
      "# turbo note\n",
    );

    const candidates = [
      {
        source: "AUTONOMOUS_WORK_PLAN.md",
        basename: "AUTONOMOUS_WORK_PLAN.md",
        warehouse: "docs/_archive/coordination/2026-08/AUTONOMOUS_WORK_PLAN.md",
        successor: "PROJECT_STATUS.md",
        reason: "historical audit ledger",
        topic: "coordination-ledgers",
      },
      {
        source: "docs/openclinxr/turbo-remote-cache-setup.md",
        basename: "turbo-remote-cache-setup.md",
        warehouse: "docs/_archive/openclinxr/2026-06/turbo-remote-cache-setup.md",
        successor: "docs/TOOLING.md",
        reason: "archive-candidate",
        topic: "openclinxr-product-docs",
      },
    ];

    const result = freezeExplicitEntries({
      repoRoot: root,
      batchId: "cruft-audit-2026-08-02",
      candidates,
      dryRun: false,
      rebuildWiki: true,
    });
    expect(result.moved).toHaveLength(2);
    expect(readFileSync(path.join(root, "AUTONOMOUS_WORK_PLAN.md"), "utf8")).toMatch(/^# ARCHIVED/);
    expect(
      readFileSync(
        path.join(root, "docs/_archive/coordination/2026-08/AUTONOMOUS_WORK_PLAN.md"),
        "utf8",
      ),
    ).toContain("ledger body");
    expect(existsSync(path.join(root, "docs/_archive/README.md"))).toBe(true);
    expect(existsSync(path.join(root, "docs/_archive/wiki/index.md"))).toBe(true);
    expect(
      existsSync(path.join(root, "docs/_archive/wiki/topics/coordination-ledgers.md")),
    ).toBe(true);
    const wiki = rebuildArchiveWiki(root);
    expect(wiki.filesIndexed).toBeGreaterThanOrEqual(2);
    expect(wiki.topics).toEqual(
      expect.arrayContaining(["coordination-ledgers", "openclinxr-product-docs"]),
    );
  });
});

describe("doc authority classify warehouse rules", () => {
  it("classifies hot agent-ops SSOT as current-reference high", () => {
    for (const base of HOT_AGENT_OPS_SSOT) {
      const entry = classify(`docs/agent-ops/${base}`);
      expect(entry.authority).toBe("current-reference");
      expect(entry.agentInstructionWeight).toBe("high");
    }
    expect(classify("docs/TOOLING.md").authority).toBe("current-reference");
    expect(classify("docs/agent-ops/README.md").agentInstructionWeight).toBe("high");
  });

  it("classifies dated agent-ops as historical-synthesis", () => {
    const entry = classify("docs/agent-ops/2026-08-02-path-scope-policy-v1.md");
    expect(entry.authority).toBe("historical-synthesis");
  });

  it("classifies warehouse cold as historical-synthesis", () => {
    const entry = classify(
      "docs/_archive/agent-ops/2026-08/2026-08-02-path-scope-policy-v1.md",
    );
    expect(entry.authority).toBe("historical-synthesis");
    expect(entry.agentInstructionWeight).toBe("none");
    expect(entry.rationale.toLowerCase()).toContain("warehouse");
  });

  it("classifies agentic-io-contract as current-reference", () => {
    const entry = classify(".grok/prompts/agentic-io-contract.md");
    expect(entry.authority).toBe("current-reference");
    expect(entry.agentInstructionWeight).toBe("high");
  });

  it("classifies capability-requests as current-reference warm", () => {
    const entry = classify("docs/agent-ops/capability-requests/TEMPLATE.md");
    expect(entry.authority).toBe("current-reference");
  });
});
