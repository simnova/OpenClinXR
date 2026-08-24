import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readCachedProjectMetadata, resolveProjectMetadata, resolveSingleSelect,
} from "./github-coordination-cache.js";
import { resetCoordinationRootCache } from "./coordination-root.js";

/**
 * **OBSERVABLE: identifiers that never change are fetched once, not once per transition.**
 *
 * MEASURED 2026-08-23: `board-cli.ts` makes FOUR `gh` calls per Factory transition and TWO of them
 * re-resolve constants — the project node id and the field/option ids. A single board sweep did ~70
 * transitions, so ~140 calls asked GitHub to repeat answers it had already given, against a GraphQL
 * budget shared across every agent on the account. That session exhausted it at 0/5000.
 *
 * claimScope: identifier caching. notEvidenceFor: item field VALUES, which are deliberately absent —
 * a stale id fails loudly when GitHub rejects it, a stale VALUE fails silently.
 */
const prev = process.env["OPENCLINXR_COORDINATION_ROOT"];
afterEach(() => {
  if (prev === undefined) delete process.env["OPENCLINXR_COORDINATION_ROOT"];
  else process.env["OPENCLINXR_COORDINATION_ROOT"] = prev;
  resetCoordinationRootCache();
});

const sandbox = (): string => {
  const root = mkdtempSync(join(tmpdir(), "ghcache-"));
  process.env["OPENCLINXR_COORDINATION_ROOT"] = root;
  resetCoordinationRootCache();
  return root;
};
const seed = (root: string, md: Record<string, unknown>) => {
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  writeFileSync(join(root, ".openclinxr/openclaw/github-project-metadata.json"), JSON.stringify(md), "utf8");
};
const REAL = {
  schemaVersion: "openclinxr.github-project-metadata.v1",
  owner: "simnova", projectNumber: 7, projectId: "PVT_kwDOAAIjts4BW0-v",
  fields: {
    Factory: { id: "PVTSSF_lADOAAIjts4BW0-vzhfup8E", options: { Idle: "x", Planted: "53aeb5a6" } },
    Priority: { id: "PVTSSF_lADOAAIjts4BW0-vzhSGJTo", options: { P0: "9d3328e1", P1: "2be632f8", P2: "618f5749" } },
  },
  fetchedAt: new Date().toISOString(),
};

describe("the board client resolves ids once", () => {
  it("(1) a warm cache serves the ids with NO network call", () => {
    const root = sandbox();
    seed(root, REAL);
    const md = resolveProjectMetadata(root, "simnova", 7);
    expect(md.source, "a fresh cache must not hit the network").toBe("cache");
    expect(md.projectId).toBe("PVT_kwDOAAIjts4BW0-v");
    // These are the exact ids the 2026-08-23 sweep resolved from the live board.
    expect(md.fields["Factory"]?.options["Planted"]).toBe("53aeb5a6");
    expect(md.fields["Priority"]?.options["P1"]).toBe("2be632f8");
  });

  it("(2) COUNTERWEIGHT: a cache past its age is NOT served", () => {
    // Without this, a cache that never expires satisfies clause (1) forever and pins a board schema
    // edit nobody announced.
    const root = sandbox();
    seed(root, { ...REAL, fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() });
    const stale = readCachedProjectMetadata(root);
    expect(stale?.ageMs ?? 0, "the reader reports age rather than hiding it").toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("(3) a corrupt or absent cache is a MISS, never an error", () => {
    const root = sandbox();
    expect(readCachedProjectMetadata(root), "absent").toBeNull();
    seed(root, { garbage: true } as never);
    expect(readCachedProjectMetadata(root), "wrong schema").toBeNull();
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    writeFileSync(join(root, ".openclinxr/openclaw/github-project-metadata.json"), "{ not json", "utf8");
    expect(readCachedProjectMetadata(root), "unparseable").toBeNull();
  });

  it("(4) resolveSingleSelect returns the ids a write needs, from cache", () => {
    const root = sandbox();
    seed(root, REAL);
    const r = resolveSingleSelect(root, "simnova", 7, "Priority", "P0");
    expect(r.source).toBe("cache");
    expect(r.optionId).toBe("9d3328e1");
    expect(r.fieldId).toBe("PVTSSF_lADOAAIjts4BW0-vzhSGJTo");
  });

  it("(5) it caches IDENTIFIERS and never item VALUES", () => {
    // The distinction that makes this safe. A stale id fails loudly when GitHub rejects it; a stale
    // Factory/Priority VALUE would let an agent act on a decision someone else already changed.
    const root = sandbox();
    seed(root, REAL);
    const blob = JSON.stringify(readCachedProjectMetadata(root));
    for (const leak of ["issueNumber", "boardItems", "Planted\":\"Planted", "status", "content"]) {
      expect(blob.includes(leak), `the cache must not carry ${leak}`).toBe(false);
    }
  });

  it("(6) two worktrees share ONE cache — a private cache saves nothing on a shared quota", () => {
    const root = sandbox();
    seed(root, REAL);
    // A different repoRoot must still resolve to the same shared file.
    const fromWorktree = resolveProjectMetadata("/some/other/worktree", "simnova", 7);
    expect(fromWorktree.source, "the worktree must hit the SAME warm cache").toBe("cache");
    expect(existsSync(join(root, ".openclinxr/openclaw/github-project-metadata.json"))).toBe(true);
  });
});
