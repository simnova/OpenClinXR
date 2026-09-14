import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAcceptance } from "../../checks/public-surface/acceptance-criteria.js";
import { measureSurface, workspaceRoot } from "../../checks/public-surface/resolve.js";

/**
 * Commit-time gate: the reviewed surface (psr-01d and psr-01e) must hold at commit time.
 *
 * This test exists because criterion 5 (reviewed-execution) caught nothing on the land path
 * — two post-review entrypoint additions landed unnoticed in one day (publishFrozenScenePlanAdmission
 * and ./counterfactual-debrief). The acceptance gate exists but no land step invokes it.
 *
 * This test invokes the criterion-5 check for psr-01d and psr-01e and asserts it passes.
 * If an unapproved name is published on a supported entrypoint, this test FAILS.
 *
 * COUNTERWEIGHT: plant an unapproved name on a supported entrypoint, watch this test FAIL,
 * revert it, watch it PASS. Report both observations.
 *
 * REAL SCENARIO SIMULATED:
 * 1. At review time: raw-inventory.json was generated from the tree (frozen snapshot)
 * 2. Approvals were written against that frozen raw-inventory
 * 3. After review: new symbols added to the tree (publishFrozenScenePlanAdmission, counterfactual-debrief)
 * 4. Current tree has extra symbols not in frozen raw-inventory
 * 5. Criterion 5 fails because current tree publishes symbols not approved
 */

function withTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "commit-time-gate-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const manifest = (name: string): string =>
  JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } });

const approvalDir = "docs/openclinxr/package-public-surface-reduction/approvals";
const rawInventoryRel = "docs/openclinxr/package-public-surface-reduction/raw-inventory.json";

const GROUP_DIRS = {
  "psr-01b": "packages/openclinxr/g-b",
  "psr-01c": "packages/openclinxr/g-c",
  "psr-01d": "packages/openclinxr/g-d",
  "psr-01e": "packages/openclinxr/g-e",
} as const;

function writeFrozenRawInventory(root: string, frozenRows: { package: string; entrypoint: string; symbol: string; kind: string }[]): void {
  // Write raw-inventory.json as it was at REVIEW TIME (frozen, no extra symbols)
  mkdirSync(join(root, "docs/openclinxr/package-public-surface-reduction"), { recursive: true });
  const hash = createHash("sha256")
    .update(frozenRows.map(r => `${r.package}\t${r.entrypoint}\t${r.symbol}\t${r.kind}`).sort().join("\n"))
    .digest("hex");
  writeFileSync(join(root, rawInventoryRel), JSON.stringify({ inventoryHash: hash, rows: frozenRows }, null, 2));
}

function writeApproval(root: string, group: string, dir: string, rows: { symbol: string; disposition: string }[], frozenRawRows: { package: string; entrypoint: string; symbol: string; kind: string }[]): void {
  // Write approval as it was at REVIEW TIME (only covers frozen symbols)
  mkdirSync(join(root, approvalDir), { recursive: true });
  // Compute groupHash from frozen raw rows (filtered to this group's packages)
  const groupPackages = [dir];
  const groupFrozenRows = frozenRawRows.filter(r => groupPackages.includes(r.package));
  const groupHashVal = createHash("sha256")
    .update(groupFrozenRows.map(r => `${r.package}\t${r.entrypoint}\t${r.symbol}\t${r.kind}`).sort().join("\n"))
    .digest("hex");
  
  const rawHash = createHash("sha256")
    .update(frozenRawRows.map(r => `${r.package}\t${r.entrypoint}\t${r.symbol}\t${r.kind}`).sort().join("\n"))
    .digest("hex");
  
  const approvalRows = rows.map((row) => ({
    package: dir,
    entrypoint: ".",
    symbol: row.symbol,
    kind: "runtime",
    disposition: row.disposition,
    owner: "fixture",
    rationale: "test row",
  }));
  writeFileSync(
    join(root, `${approvalDir}/${group}.json`),
    JSON.stringify(
      {
        id: group,
        rawInventoryHash: rawHash,
        groupHash: groupHashVal,
        rows: approvalRows,
      },
      null,
      2,
    ),
  );
}

function fourKeepPackages(source = "export const kept = 1;\n"): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of Object.values(GROUP_DIRS)) {
    const name = dir.split("/").pop() ?? "pkg";
    files[`${dir}/package.json`] = manifest(`@openclinxr/${name}`);
    files[`${dir}/src/index.ts`] = source;
  }
  return files;
}

describe("commit-time gate: reviewed surface holds for psr-01d and psr-01e", () => {
  it("passes when no unapproved names are published on supported entrypoints", () => {
    const files = fourKeepPackages();
    withTree(files, (root) => {
      // Frozen raw inventory matches current tree (no extra symbols)
      const frozenRawRows = [
        { package: "packages/openclinxr/g-d", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-b", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-c", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-e", entrypoint: ".", symbol: "kept", kind: "runtime" },
      ];
      writeFrozenRawInventory(root, frozenRawRows);
      for (const [group, dir] of Object.entries(GROUP_DIRS)) {
        writeApproval(root, group, dir, [{ symbol: "kept", disposition: "keep" }], frozenRawRows);
      }
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["5"].ok).toBe(true);
      expect(evaluation.record.verdict).toBe("close");
    });
  });

  it("FAILS when an unapproved name is published on a psr-01d supported entrypoint (counterweight)", () => {
    // CURRENT TREE has extra symbol (added after review)
    // FROZEN RAW INVENTORY does NOT have it (review snapshot)
    // APPROVAL only covers frozen symbols
    const files = {
      ...fourKeepPackages(),
      "packages/openclinxr/g-d/src/index.ts": "export const kept = 1;\nexport const unapprovedSymbol = 2;\n",
    };
    withTree(files, (root) => {
      // Frozen raw inventory from review time (NO unapprovedSymbol)
      const frozenRawRows = [
        { package: "packages/openclinxr/g-d", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-b", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-c", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-e", entrypoint: ".", symbol: "kept", kind: "runtime" },
      ];
      writeFrozenRawInventory(root, frozenRawRows);
      
      // Approvals only cover frozen symbols
      for (const [group, dir] of Object.entries(GROUP_DIRS)) {
        writeApproval(root, group, dir, [{ symbol: "kept", disposition: "keep" }], frozenRawRows);
      }
      
      const evaluation = evaluateAcceptance(root);
      // Criterion 5 must FAIL because current tree has unapprovedSymbol not in frozen raw-inventory
      expect(evaluation.record.criteria["5"].ok).toBe(false);
      expect(evaluation.record.verdict).toBe("refuse");
      expect(evaluation.record.refuseReasons.some((reason) => reason.includes("reviewed-execution"))).toBe(true);
      expect(evaluation.record.criteria["5"].detail).toContain("unapprovedSymbol");
    });
  });

  it("FAILS when an unapproved name is published on a psr-01e supported entrypoint (counterweight)", () => {
    const files = {
      ...fourKeepPackages(),
      "packages/openclinxr/g-e/src/index.ts": "export const kept = 1;\nexport const anotherUnapproved = 2;\n",
    };
    withTree(files, (root) => {
      const frozenRawRows = [
        { package: "packages/openclinxr/g-d", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-b", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-c", entrypoint: ".", symbol: "kept", kind: "runtime" },
        { package: "packages/openclinxr/g-e", entrypoint: ".", symbol: "kept", kind: "runtime" },
      ];
      writeFrozenRawInventory(root, frozenRawRows);
      
      for (const [group, dir] of Object.entries(GROUP_DIRS)) {
        writeApproval(root, group, dir, [{ symbol: "kept", disposition: "keep" }], frozenRawRows);
      }
      
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["5"].ok).toBe(false);
      expect(evaluation.record.verdict).toBe("refuse");
      expect(evaluation.record.refuseReasons.some((reason) => reason.includes("reviewed-execution"))).toBe(true);
      expect(evaluation.record.criteria["5"].detail).toContain("anotherUnapproved");
    });
  });

  it("passes on the integrated tree (real repo) for psr-01d and psr-01e", () => {
    const evaluation = evaluateAcceptance(workspaceRoot());
    expect(evaluation.record.criteria["5"].ok).toBe(true);
    expect(evaluation.record.verdict).toBe("close");
    // The detail says "all review groups resolved; applied psr-01b, psr-01c, psr-01d, psr-01e"
    expect(evaluation.record.criteria["5"].detail).toContain("applied psr-01b, psr-01c, psr-01d, psr-01e");
  });
});