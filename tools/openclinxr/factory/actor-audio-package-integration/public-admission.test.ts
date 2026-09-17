import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ADMISSION_GROUPS } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/apply-map.js";
import { groupHash, inventoryHash, requireAppliedWith } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/gates.js";
import { measureSurface } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/resolve.js";
const PSR_DIR = "docs/openclinxr/package-public-surface-reduction";
const APPROVALS_DIR = `${PSR_DIR}/approvals`;
const ADMISSIONS_DIR = `${PSR_DIR}/admissions`;
const RAW_INVENTORY_REL = `${PSR_DIR}/raw-inventory.json`;
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

const ID = "actor-audio-runtime-v1";
const PKG = "packages/openclinxr/fixture-actor-audio";
const admittedRow: OverlayRow = { package: PKG, entrypoint: ".", symbol: "createActorAudioRuntime", kind: "runtime", disposition: "keep", owner: "implementation-producer", reviewedBy: "independent-source-reviewer", rationale: "closed-owned factory" };
function fixture(run: (root: string) => void) {
  withTree({ [`${PKG}/package.json`]: manifest("@openclinxr/fixture-actor-audio"), [`${PKG}/src/index.ts`]: "export const existing = 1;\n" }, root => {
    writeRawInventory(root);
    writeGroup(root, "psr-01c", [{ package: PKG, entrypoint: ".", symbol: "existing", kind: "runtime", disposition: "keep" }]);
    writeFileSync(join(root, PKG, "src/index.ts"), "export const existing = 1;\nexport function createActorAudioRuntime() { return {}; }\n");
    writeAdmission(root, ID, [admittedRow]);
    run(root);
  });
}
it("production allowlist admits precisely the existing reviewed group and new runtime overlay", () => {
  expect(ADMISSION_GROUPS).toEqual(["psr-01f", ID]);
});
it("a new root factory is refused without admission and accepted by the exact independently reviewed overlay", () => {
  fixture(root => {
    const refused = requireAppliedWith(root, "psr-01c", { admissionGroups: [] });
    expect(refused.ok).toBe(false);
    expect(refused.detail).toMatch(/extra:.*createActorAudioRuntime/);
    const accepted = requireAppliedWith(root, "psr-01c", { admissionGroups: [ID] });
    expect(accepted.ok, accepted.detail).toBe(true);
  });
});
it("wrong hash and self-reviewed ownership both fail the actual admission engine", () => {
  fixture(root => {
    writeAdmission(root, ID, [admittedRow], { admissionHash: "0".repeat(64) });
    expect(requireAppliedWith(root, "psr-01c", { admissionGroups: [ID] })).toEqual({ ok: false, detail: "overlay admissionHash does not match" });
    writeAdmission(root, ID, [{ ...admittedRow, owner: admittedRow.reviewedBy }]);
    expect(requireAppliedWith(root, "psr-01c", { admissionGroups: [ID] })).toEqual({ ok: false, detail: "overlay owner equals reviewer" });
  });
});
