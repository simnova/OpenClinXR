import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendDocAuthorityPaths, parseDocAuthorityAppends } from "./build-doc-authority-registry.ts";

/**
 * `--append` registers named Markdown without a rescan. A full `pnpm docs:authority` from a worktree
 * refuses (gitignored documents classify as missing), and from main it rewrites deliberate rows,
 * including the three `handoff.md` evidence rows that drift-check refuses as `temporary`.
 */
const registryRel = "docs/openclinxr/doc-authority-registry-2026-05-27.json";
let dirs: string[] = [];

function fixture(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "doc-authority-append-"));
  dirs.push(cwd);
  mkdirSync(path.join(cwd, "docs/openclinxr"), { recursive: true });
  mkdirSync(path.join(cwd, "tools/openclinxr/evidence/hair-x"), { recursive: true });
  mkdirSync(path.join(cwd, "docs/openclinxr/deleg"), { recursive: true });
  writeFileSync(path.join(cwd, "tools/openclinxr/evidence/hair-x/STATE.md"), "# state\n");
  writeFileSync(path.join(cwd, "docs/openclinxr/deleg/handoff.md"), "# handoff\n");
  const registry = {
    schemaVersion: "2026-05-27",
    counts: { evidence: 1 },
    entries: [
      {
        path: "docs/openclinxr/deleg/handoff.md",
        authority: "evidence",
        agentInstructionWeight: "low",
        action: "treat-as-evidence",
        rationale: "set by hand; classify() would say temporary",
      },
    ],
  };
  writeFileSync(path.join(cwd, registryRel), `${JSON.stringify(registry, null, 2)}\n`);
  return cwd;
}

function read(cwd: string): { counts: Record<string, number>; entries: { path: string; authority: string }[] } {
  return JSON.parse(readFileSync(path.join(cwd, registryRel), "utf8"));
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("doc-authority --append", () => {
  it("adds a new evidence note and leaves an existing hand-set row untouched", () => {
    const cwd = fixture();
    const result = appendDocAuthorityPaths({
      cwd,
      paths: ["tools/openclinxr/evidence/hair-x/STATE.md", "docs/openclinxr/deleg/handoff.md"],
    });
    expect(result.ok).toBe(true);
    expect(result.added).toEqual(["tools/openclinxr/evidence/hair-x/STATE.md"]);
    const after = read(cwd);
    expect(after.entries.map((e) => e.path)).toEqual([
      "docs/openclinxr/deleg/handoff.md",
      "tools/openclinxr/evidence/hair-x/STATE.md",
    ]);
    expect(after.entries[0]?.authority).toBe("evidence");
    expect(after.counts).toEqual({ evidence: 2 });
  });

  it("COUNTERWEIGHT: refuses a path that is not on disk and writes nothing", () => {
    const cwd = fixture();
    const before = readFileSync(path.join(cwd, registryRel), "utf8");
    const result = appendDocAuthorityPaths({
      cwd,
      paths: ["tools/openclinxr/evidence/hair-x/STATE.md", "tools/openclinxr/evidence/hair-x/GONE.md"],
    });
    expect(result.ok).toBe(false);
    expect(result.refused).toEqual(["tools/openclinxr/evidence/hair-x/GONE.md"]);
    expect(readFileSync(path.join(cwd, registryRel), "utf8")).toBe(before);
  });

  it("collects every repeated --append value", () => {
    expect(parseDocAuthorityAppends(["node", "x", "--append", "a.md", "--append", "b.md"])).toEqual(["a.md", "b.md"]);
    expect(() => parseDocAuthorityAppends(["node", "x", "--append"])).toThrow();
  });
});
