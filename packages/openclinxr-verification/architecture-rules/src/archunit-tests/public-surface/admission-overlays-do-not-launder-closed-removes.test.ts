import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_GROUPS, resolveApplyId } from "../../checks/public-surface/apply-map.js";
import { groupHash, inventoryHash, requireApplied, requireAppliedWith } from "../../checks/public-surface/gates.js";
import { measureSurface, workspaceRoot } from "../../checks/public-surface/resolve.js";

/**
 * Admission overlays must not launder a closed remove, and unknown apply ids stay unknown.
 *
 * Plant (clauses 1–3) imports only today's apply/review surface: requireApplied,
 * resolveApplyId, REVIEW_GROUPS. Overlay clauses land in the implementation commit.
 */

const ROOT = workspaceRoot();
const FROZEN = {
  raw: "c37bea4199168cb11094db343e449e9da887e43d5c01e2c85fc24c16265446b6",
  "psr-01b": "74e4fb9a76a42899212b79988668ba396e07314b31d0620518430200af37e335",
  "psr-01c": "dfa31d1b9f37d5b54d34c3d2ecdd22abd97e6ddec808e48c4d307c2ee9afe1b1",
  "psr-01d": "bd4d89908a9e5f64d7a29d3b13b2ba2b285de0ece210d41482cb9eee5073019a",
  "psr-01e": "59b530c7490e2e6b095e42e47af160176964cb2594fa5952746d7477c542a228",
} as const;
const PSR_DIR = "docs/openclinxr/package-public-surface-reduction";
const APPROVALS_DIR = `${PSR_DIR}/approvals`;
const ADMISSIONS_DIR = `${PSR_DIR}/admissions`;
const RAW_INVENTORY_REL = `${PSR_DIR}/raw-inventory.json`;
const GATES_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/gates.ts";
const APPLY_MAP_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/apply-map.ts";
const RUNNER_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/runner.ts";
const ACCEPTANCE_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/acceptance-criteria.ts";
const PKG_JSON_REL = "packages/openclinxr-verification/architecture-rules/package.json";

function withTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "psr-admission-"));
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
  mkdirSync(join(root, PSR_DIR), { recursive: true });
  writeFileSync(join(root, RAW_INVENTORY_REL), JSON.stringify({ inventoryHash: inventoryHash(root, report), rows }, null, 2));
}

function writeGroup(
  root: string,
  group: string,
  rows: { package: string; entrypoint: string; symbol: string; kind: string; disposition: string }[],
): void {
  mkdirSync(join(root, APPROVALS_DIR), { recursive: true });
  const report = measureSurface(root);
  const table: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        table.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  const packages = new Set(rows.map((row) => row.package));
  writeFileSync(
    join(root, `${APPROVALS_DIR}/${group}.json`),
    JSON.stringify(
      {
        id: group,
        rawInventoryHash: inventoryHash(root, report),
        groupHash: groupHash(table, packages),
        rows: rows.map((row) => ({ ...row, owner: "fixture", rationale: "falsifier row" })),
      },
      null,
      2,
    ),
  );
}

function sha256File(rel: string): string {
  return createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
}

type OverlayRow = {
  package: string;
  entrypoint: string;
  symbol: string;
  kind: string;
  disposition: string;
  owner: string;
  rationale: string;
  reviewedBy: string;
};

function overlayAdmissionHash(reviewedBy: string, rows: OverlayRow[]): string {
  const lines = [...rows]
    .sort((a, b) =>
      `${a.package}\t${a.entrypoint}\t${a.symbol}\t${a.kind}`.localeCompare(
        `${b.package}\t${b.entrypoint}\t${b.symbol}\t${b.kind}`,
      ),
    )
    .map(
      (row) =>
        `${row.package}\t${row.entrypoint}\t${row.symbol}\t${row.kind}\t${row.disposition}\t${row.owner}\t${row.reviewedBy}`,
    );
  return createHash("sha256").update([reviewedBy, ...lines].join("\n")).digest("hex");
}

function writeAdmission(
  root: string,
  id: string,
  rows: OverlayRow[],
  opts?: {
    reviewedBy?: string;
    baseRawInventoryHash?: string;
    admissionHash?: string;
    packages?: string[];
    schema?: string;
    fileId?: string;
  },
): void {
  const reviewedBy = opts?.reviewedBy ?? rows[0]?.reviewedBy ?? "reviewer";
  mkdirSync(join(root, ADMISSIONS_DIR), { recursive: true });
  const raw = JSON.parse(readFileSync(join(root, RAW_INVENTORY_REL), "utf8")) as { inventoryHash: string };
  writeFileSync(
    join(root, `${ADMISSIONS_DIR}/${id}.json`),
    JSON.stringify(
      {
        schema: opts?.schema ?? "openclinxr.psr-admission.v1",
        id: opts?.fileId ?? id,
        reviewedBy,
        baseRawInventoryHash: opts?.baseRawInventoryHash ?? raw.inventoryHash,
        admissionHash: opts?.admissionHash ?? overlayAdmissionHash(reviewedBy, rows),
        packages: opts?.packages ?? [...new Set(rows.map((row) => row.package))],
        rows,
      },
      null,
      2,
    ),
  );
}

const STRAY_KEEP: OverlayRow = {
  package: "packages/openclinxr/fixture-closed-remove",
  entrypoint: ".",
  symbol: "stray",
  kind: "runtime",
  disposition: "keep",
  owner: "author",
  rationale: "reviewed readmission",
  reviewedBy: "reviewer",
};

function closedRemoveTree(extraExport = "export const listed = 1;\nexport const stray = 2;\n"): Record<string, string> {
  return {
    "packages/openclinxr/fixture-closed-remove/package.json": manifest("@openclinxr/fixture-closed-remove"),
    "packages/openclinxr/fixture-closed-remove/src/index.ts": extraExport,
  };
}

function writeClosedRemoveGroup(
  root: string,
  extraRows: { symbol: string; disposition: string }[] = [{ symbol: "stray", disposition: "remove" }],
): void {
  writeRawInventory(root);
  writeGroup(root, "psr-01c", [
    {
      package: "packages/openclinxr/fixture-closed-remove",
      entrypoint: ".",
      symbol: "listed",
      kind: "runtime",
      disposition: "keep",
    },
    ...extraRows.map((row) => ({
      package: "packages/openclinxr/fixture-closed-remove",
      entrypoint: ".",
      symbol: row.symbol,
      kind: "runtime",
      disposition: row.disposition,
    })),
  ]);
}

describe("admission overlays do not launder closed removes", () => {
  it("(1) RED: a well-formed approvals/psr-99z.json still yields unknown apply id", () => {
    withTree(
      {
        "packages/openclinxr/fixture-99z/package.json": manifest("@openclinxr/fixture-99z"),
        "packages/openclinxr/fixture-99z/src/index.ts": "export const listed = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-99z", [
          {
            package: "packages/openclinxr/fixture-99z",
            entrypoint: ".",
            symbol: "listed",
            kind: "runtime",
            disposition: "keep",
          },
        ]);
        const result = requireApplied(root, "psr-99z");
        expect(result.ok).toBe(false);
        expect(result.detail).toBe("unknown apply id psr-99z");
      },
    );
  });

  it("(2) a closed-group remove of a still-published fixture symbol remains extra without an overlay", () => {
    withTree(
      {
        "packages/openclinxr/fixture-closed-remove/package.json": manifest("@openclinxr/fixture-closed-remove"),
        "packages/openclinxr/fixture-closed-remove/src/index.ts": "export const listed = 1;\nexport const stray = 2;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-01c", [
          {
            package: "packages/openclinxr/fixture-closed-remove",
            entrypoint: ".",
            symbol: "listed",
            kind: "runtime",
            disposition: "keep",
          },
          {
            package: "packages/openclinxr/fixture-closed-remove",
            entrypoint: ".",
            symbol: "stray",
            kind: "runtime",
            disposition: "remove",
          },
        ]);
        const result = requireApplied(root, "psr-01c");
        expect(result.ok).toBe(false);
        expect(result.detail).toMatch(/extra:.*stray/u);
      },
    );
  });

  it("(3) resolveApplyId never learns admission ids; frozen byte pins hold", () => {
    expect(resolveApplyId("psr-01f")).toBeUndefined();
    expect(resolveApplyId("psr-99z")).toBeUndefined();
    expect([...REVIEW_GROUPS]).toEqual(["psr-01b", "psr-01c", "psr-01d", "psr-01e"]);
    expect(sha256File(RAW_INVENTORY_REL)).toBe(FROZEN.raw);
    expect(sha256File(`${APPROVALS_DIR}/psr-01b.json`)).toBe(FROZEN["psr-01b"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01c.json`)).toBe(FROZEN["psr-01c"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01d.json`)).toBe(FROZEN["psr-01d"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01e.json`)).toBe(FROZEN["psr-01e"]);
  });

  it("(4) an independently reviewed overlay keep removes only that named extra", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP]);
      const production = requireApplied(root, "psr-01c");
      expect(production.ok).toBe(false);
      expect(production.detail).toMatch(/extra:.*stray/u);
      const admitted = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(admitted.ok, admitted.detail).toBe(true);
    });
  });

  it("(5) two extras and one overlay keep: the omitted extra still fails", () => {
    withTree(
      closedRemoveTree("export const listed = 1;\nexport const stray = 2;\nexport const other = 3;\n"),
      (root) => {
        writeClosedRemoveGroup(root, [
          { symbol: "stray", disposition: "remove" },
          { symbol: "other", disposition: "remove" },
        ]);
        writeAdmission(root, "psr-ghost", [STRAY_KEEP]);
        const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
        expect(result.ok).toBe(false);
        expect(result.detail).toMatch(/extra:.*other/u);
        expect(result.detail).not.toMatch(/extra:.*stray/u);
      },
    );
  });

  it("(6a) overlay keep over a closed keep is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [
        {
          ...STRAY_KEEP,
          symbol: "listed",
          rationale: "illegal re-review of a closed keep",
        },
      ]);
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("closed keep cannot be overlaid");
    });
  });

  it("(6b) overlay owner equals reviewer is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [{ ...STRAY_KEEP, owner: "reviewer", reviewedBy: "reviewer" }], {
        reviewedBy: "reviewer",
      });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay owner equals reviewer");
    });
  });

  it("(6c) overlay wrong base hash is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP], { baseRawInventoryHash: "0".repeat(64) });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay baseRawInventoryHash does not match");
    });
  });

  it("(6d) overlay wrong admissionHash is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP], { admissionHash: "0".repeat(64) });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay admissionHash does not match");
    });
  });

  it("(6e) overlay id/filename mismatch is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP], { fileId: "psr-other" });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay id/filename mismatch");
    });
  });

  it("(6f) overlay traversal, absolute, and backslash paths are refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      for (const id of ["../approvals/psr-01c", "/tmp/x", "foo\\bar"]) {
        const result = requireAppliedWith(root, "psr-01c", { admissionGroups: [id] });
        expect(result.ok, id).toBe(false);
        expect(result.detail, id).toBe("overlay path refused");
      }
    });
  });

  it("(6g) a well-formed overlay file not in ADMISSION_GROUPS does not admit, and the id stays unknown", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP]);
      const production = requireApplied(root, "psr-01c");
      expect(production.ok).toBe(false);
      expect(production.detail).toMatch(/extra:.*stray/u);
      const unknown = requireApplied(root, "psr-ghost");
      expect(unknown.ok).toBe(false);
      expect(unknown.detail).toBe("unknown apply id psr-ghost");
      const admitted = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(admitted.ok, admitted.detail).toBe(true);
    });
  });

  it("(7) frozen closed approvals and raw inventory retain their pinned byte hashes", () => {
    expect(sha256File(RAW_INVENTORY_REL)).toBe(FROZEN.raw);
    expect(sha256File(`${APPROVALS_DIR}/psr-01b.json`)).toBe(FROZEN["psr-01b"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01c.json`)).toBe(FROZEN["psr-01c"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01d.json`)).toBe(FROZEN["psr-01d"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01e.json`)).toBe(FROZEN["psr-01e"]);
  });

  it("(counterweight) production unknown id with a matching approvals file remains unknown", () => {
    withTree(
      {
        "packages/openclinxr/fixture-99z/package.json": manifest("@openclinxr/fixture-99z"),
        "packages/openclinxr/fixture-99z/src/index.ts": "export const listed = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-99z", [
          {
            package: "packages/openclinxr/fixture-99z",
            entrypoint: ".",
            symbol: "listed",
            kind: "runtime",
            disposition: "keep",
          },
        ]);
        const result = requireApplied(root, "psr-99z");
        expect(result.ok).toBe(false);
        expect(result.detail).toBe("unknown apply id psr-99z");
      },
    );
  });

  it("(counterweight) redirecting fixture group or subset/complement fixture scope is refused by name", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      const redirect = requireAppliedWith(root, "psr-fake", {
        resolution: { group: "psr-01c", scope: { kind: "group" } },
      });
      expect(redirect.ok).toBe(false);
      expect(redirect.detail).toBe("invalid fixture resolution");
      const subset = requireAppliedWith(root, "psr-01c", {
        resolution: {
          group: "psr-01c",
          scope: { kind: "packages", packages: ["packages/openclinxr/fixture-closed-remove"] },
        },
      });
      expect(subset.ok).toBe(false);
      expect(subset.detail).toBe("invalid fixture resolution");
      const complement = requireAppliedWith(root, "psr-01c", {
        resolution: { group: "psr-01c", scope: { kind: "complement", exclude: [] } },
      });
      expect(complement.ok).toBe(false);
      expect(complement.detail).toBe("invalid fixture resolution");
    });
  });

  it("(source) requireAppliedWith is not exported by package index or used by production callers", () => {
    expect(readFileSync(join(ROOT, PKG_JSON_REL), "utf8")).not.toMatch(/requireAppliedWith/u);
    expect(readFileSync(join(ROOT, RUNNER_REL), "utf8")).not.toMatch(/requireAppliedWith/u);
    expect(readFileSync(join(ROOT, ACCEPTANCE_REL), "utf8")).not.toMatch(/requireAppliedWith/u);
    const applyMap = readFileSync(join(ROOT, APPLY_MAP_REL), "utf8");
    expect(applyMap).not.toMatch(/requireAppliedWith/u);
    expect(applyMap).toMatch(/export const ADMISSION_GROUPS: readonly string\[\] = \[\]/u);
    const resolveStart = applyMap.indexOf("export function resolveApplyId");
    const resolveBody = applyMap.slice(resolveStart);
    expect(resolveBody).not.toMatch(/ADMISSION_GROUPS/u);
    expect(resolveBody).not.toMatch(/admission/iu);
    const gates = readFileSync(join(ROOT, GATES_REL), "utf8");
    expect(gates).toMatch(/export function requireAppliedWith/u);
    expect(gates).toMatch(
      /export function requireApplied\(root: string, id: string, report\?: SurfaceReport\): GateResult/u,
    );
  });
});
