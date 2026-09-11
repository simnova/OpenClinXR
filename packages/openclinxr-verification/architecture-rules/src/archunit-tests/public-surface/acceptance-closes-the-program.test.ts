import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAcceptance, METRIC_TO_TARGET, REVIEW_TARGETS } from "../../checks/public-surface/acceptance-criteria.js";
import { groupHash, inventoryHash } from "../../checks/public-surface/gates.js";
import { measureSurface, workspaceRoot } from "../../checks/public-surface/resolve.js";
import type { RunnerIo } from "../../checks/public-surface/runner.js";
import { runAcceptance } from "../../checks/public-surface/runner.js";

/**
 * PSR-00B: acceptance evaluates plan criteria 3, 4, 5, 6 and 12 so PSR-09 can
 * close the program or refuse it for a named reason. A self-authored success
 * flag cannot close it. Diagnosis tables stay immutable; this file is the FIX.
 */

function withTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "psr-00b-"));
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
const exceptionsDir = "docs/openclinxr/package-public-surface-reduction/exceptions";

const GROUPS = ["psr-01b", "psr-01c", "psr-01d", "psr-01e"] as const;
const GROUP_DIRS = {
  "psr-01b": "packages/openclinxr/g-b",
  "psr-01c": "packages/openclinxr/g-c",
  "psr-01d": "packages/openclinxr/g-d",
  "psr-01e": "packages/openclinxr/g-e",
} as const;

function writeRawInventory(root: string): void {
  const report = measureSurface(root);
  const rows: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  mkdirSync(join(root, "docs/openclinxr/package-public-surface-reduction"), { recursive: true });
  writeFileSync(join(root, rawInventoryRel), JSON.stringify({ inventoryHash: inventoryHash(root, report), rows }, null, 2));
}

function writeKeepGroups(root: string, extraRows: { group: string; symbol: string; disposition: string; dir: string }[] = []): void {
  mkdirSync(join(root, approvalDir), { recursive: true });
  const report = measureSurface(root);
  const table: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        table.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  for (const group of GROUPS) {
    const dir = GROUP_DIRS[group];
    const rows = [
      {
        package: dir,
        entrypoint: ".",
        symbol: "kept",
        kind: "runtime",
        disposition: "keep",
        owner: "fixture",
        rationale: "close-fixture keep",
      },
      ...extraRows
        .filter((row) => row.group === group)
        .map((row) => ({
          package: row.dir,
          entrypoint: ".",
          symbol: row.symbol,
          kind: "runtime",
          disposition: row.disposition,
          owner: "fixture",
          rationale: "extra row",
        })),
    ];
    writeFileSync(
      join(root, `${approvalDir}/${group}.json`),
      JSON.stringify(
        {
          id: group,
          rawInventoryHash: inventoryHash(root, report),
          groupHash: groupHash(table, [dir]),
          rows,
        },
        null,
        2,
      ),
    );
  }
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

const memIo: RunnerIo = { readBaseline: () => undefined, writeFile: () => {} };

describe("acceptance closes the program or refuses for a named reason", () => {
  it("closes when criteria 3, 4, 5, 6 and 12 hold on a classified applied tree", () => {
    withTree(fourKeepPackages(), (root) => {
      writeRawInventory(root);
      writeKeepGroups(root);
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["3"].ok).toBe(true);
      expect(evaluation.record.criteria["4"].ok).toBe(true);
      expect(evaluation.record.criteria["5"].ok).toBe(true);
      expect(evaluation.record.criteria["6"].ok).toBe(true);
      expect(evaluation.record.criteria["12"].ok).toBe(true);
      expect(evaluation.record.verdict).toBe("close");
      expect(evaluation.failed).toBe(false);
      expect("success" in evaluation.record).toBe(false);
    });
  });

  it("refuses criterion 3 when a supported entrypoint still has export * from", () => {
    const files = fourKeepPackages("export const kept = 1;\nexport * from './empty.js';\n");
    files["packages/openclinxr/g-b/src/empty.ts"] = "export {};\n";
    withTree(files, (root) => {
      writeRawInventory(root);
      writeKeepGroups(root);
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["3"].ok).toBe(false);
      expect(evaluation.record.verdict).toBe("refuse");
      expect(evaluation.record.refuseReasons.some((reason) => reason.includes("no-wildcard-publication"))).toBe(true);
    });
  });

  it("refuses criterion 4 when an inventory symbol has no keep/remove/migrate row", () => {
    withTree(
      {
        ...fourKeepPackages(),
        "packages/openclinxr/g-b/src/index.ts": "export const kept = 1;\nexport const stray = 2;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeKeepGroups(root);
        const evaluation = evaluateAcceptance(root);
        expect(evaluation.record.criteria["4"].ok).toBe(false);
        expect(evaluation.record.verdict).toBe("refuse");
        expect(evaluation.record.refuseReasons.some((reason) => reason.includes("complete-contract-inventory"))).toBe(true);
      },
    );
  });

  it("refuses criterion 5 when an approved remove is present but unapplied", () => {
    withTree(
      {
        ...fourKeepPackages(),
        "packages/openclinxr/g-b/src/index.ts": "export const kept = 1;\nexport const doomed = 2;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeKeepGroups(root, [{ group: "psr-01b", symbol: "doomed", disposition: "remove", dir: GROUP_DIRS["psr-01b"] }]);
        const evaluation = evaluateAcceptance(root);
        expect(evaluation.record.criteria["5"].ok).toBe(false);
        expect(evaluation.record.verdict).toBe("refuse");
        expect(evaluation.record.refuseReasons.some((reason) => reason.includes("reviewed-execution"))).toBe(true);
      },
    );
  });

  const bulkyKeep = `${Array.from({ length: 60 }, (_, index) => `export const n${index} = ${index};\n`).join("")}export const kept = 1;\n`;
  const bulkyExtras = Array.from({ length: 60 }, (_, index) => ({
    group: "psr-01e" as const,
    symbol: `n${index}`,
    disposition: "keep",
    dir: GROUP_DIRS["psr-01e"],
  }));

  function withBulkyClassified(run: (root: string) => void): void {
    withTree({ ...fourKeepPackages(), "packages/openclinxr/g-e/src/index.ts": bulkyKeep }, (root) => {
      writeRawInventory(root);
      writeKeepGroups(root, bulkyExtras);
      run(root);
    });
  }

  function writeExceptionEntries(root: string, fileName: string, exceptions: unknown[]): void {
    mkdirSync(join(root, exceptionsDir), { recursive: true });
    writeFileSync(join(root, `${exceptionsDir}/${fileName}`), JSON.stringify({ id: fileName.replace(/\.json$/u, ""), exceptions }));
  }

  function conformingEntries(root: string): Record<string, unknown>[] {
    return evaluateAcceptance(root).record.quantitativeMisses.map((miss) => ({
      target: METRIC_TO_TARGET[miss.metric],
      measured: miss.measured,
      threshold: miss.target,
      owner: "psr-08",
      reason: "fixture residual",
      reviewedBy: "independent-reviewer",
    }));
  }

  it("refuses criterion 6 when a review target is missed with no exception", () => {
    withBulkyClassified((root) => {
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["6"].ok).toBe(false);
      expect(evaluation.record.verdict).toBe("refuse");
      expect(evaluation.record.criteria["6"].detail).toContain("no independently reviewed exception");
    });
  });

  it("refuses criterion 6 when reviewedBy equals owner", () => {
    withBulkyClassified((root) => {
      writeExceptionEntries(
        root,
        "psr-same-owner.json",
        conformingEntries(root).map((entry) => ({ ...entry, reviewedBy: entry["owner"] })),
      );
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["6"].ok).toBe(false);
      expect(evaluation.record.criteria["6"].detail).toContain("reviewedBy equals owner");
    });
  });

  it("refuses criterion 6 when reviewedBy is absent", () => {
    withBulkyClassified((root) => {
      writeExceptionEntries(
        root,
        "psr-no-reviewer.json",
        conformingEntries(root).map((entry) => {
          const { reviewedBy: _reviewedBy, ...rest } = entry;
          void _reviewedBy;
          return rest;
        }),
      );
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["6"].ok).toBe(false);
      expect(evaluation.record.criteria["6"].detail).toContain("no reviewedBy");
    });
  });

  it("refuses criterion 6 when exception measured differs from the tree", () => {
    withBulkyClassified((root) => {
      writeExceptionEntries(
        root,
        "psr-stale.json",
        conformingEntries(root).map((entry) => ({ ...entry, measured: 1 })),
      );
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["6"].ok).toBe(false);
      expect(evaluation.record.criteria["6"].detail).toContain("measured differs from the tree");
    });
  });

  it("refuses criterion 6 when the exception file still uses the retired kind shape", () => {
    withBulkyClassified((root) => {
      writeExceptionEntries(root, "psr-08-residual.json", [
        { kind: "program-p90-root-symbols", measuredAfterPsr08: 61, target: 25, owner: "psr-08", reason: "old shape" },
        { kind: "program-no-root-above", measuredAfterPsr08: 61, target: 50, owner: "psr-08", reason: "old shape" },
      ]);
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["6"].ok).toBe(false);
      expect(evaluation.record.criteria["6"].detail).toContain("psr-08-residual.json");
      expect(evaluation.record.criteria["6"].detail).toContain("retired kind shape");
    });
  });

  it("accepts criterion 6 when every miss has an independently reviewed exception", () => {
    withBulkyClassified((root) => {
      writeExceptionEntries(root, "psr-reviewed.json", conformingEntries(root));
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["6"].ok).toBe(true);
      expect(evaluation.record.criteria["6"].detail).toContain("independently reviewed exceptions");
      expect(evaluation.record.verdict).toBe("close");
    });
  });

  it("REVIEW_TARGETS stay the plan line 122 numbers", () => {
    expect(REVIEW_TARGETS).toEqual({
      rootExportsAtMost: 1000,
      medianAtMost: 15,
      p90AtMost: 25,
      noRootAbove: 50,
      duplicateNamesAtMost: 200,
    });
  });

  it("refuses criterion 12 on an empty sample", () => {
    withTree({}, (root) => {
      const evaluation = evaluateAcceptance(root);
      expect(evaluation.record.criteria["12"].ok).toBe(false);
      expect(evaluation.record.verdict).toBe("refuse");
      expect(evaluation.record.refuseReasons.some((reason) => reason.includes("empty sample"))).toBe(true);
    });
  });

  it("runAcceptance writes the machine-readable record and never a success flag", () => {
    withTree(fourKeepPackages(), (root) => {
      writeRawInventory(root);
      writeKeepGroups(root);
      const written: Record<string, string> = {};
      const outcome = runAcceptance({
        root,
        args: ["--report", "docs/openclinxr/package-public-surface-reduction/evidence/psr-00b-acceptance-dry-run.json"],
        io: {
          ...memIo,
          writeFile: (rel, bytes) => {
            written[rel] = bytes;
          },
        },
      });
      expect(outcome.record.verdict).toBe("close");
      const report = written["docs/openclinxr/package-public-surface-reduction/evidence/psr-00b-acceptance-dry-run.json"];
      expect(report).toBeDefined();
      const parsed = JSON.parse(report ?? "{}") as { verdict?: string; success?: unknown };
      expect(parsed.verdict).toBe("close");
      expect(parsed.success).toBeUndefined();
    });
  });

  it("the integrated tree is evaluated for criteria 3, 4, 5, 6 and 12 (close or named refuse)", () => {
    const outcome = runAcceptance({ root: workspaceRoot(), args: [], io: memIo });
    for (const criterion of ["3", "4", "5", "6", "12"] as const) {
      expect(outcome.record.criteria[criterion]).toBeDefined();
      expect(outcome.record.criteria[criterion].criterion).toBe(criterion);
    }
    expect(outcome.record.cellix.planPin).toBe("adf3bc9deb2d0ca006041d9326215996a2b00e12");
    expect(outcome.record.verdict === "close" || outcome.record.verdict === "refuse").toBe(true);
    if (outcome.record.verdict === "refuse") {
      expect(outcome.record.refuseReasons.length).toBeGreaterThan(0);
    }
  });
});
