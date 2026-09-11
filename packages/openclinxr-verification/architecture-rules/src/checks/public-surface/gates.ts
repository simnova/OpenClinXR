import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveApplyId } from "./apply-map.js";
import { discoverConsumers } from "./consumers.js";
import { manifestHash, measureSurface } from "./resolve.js";
import type { SurfaceReport } from "./resolve.js";

/**
 * PSR-00 verifier gates: --require-inventory, --require-reviewed-group, --require-applied,
 * --require-all-reviewed, plus the shrink ratchet in verify.ts.
 *
 * WHY: an implementation card cannot satisfy its semantic proof by editing an approval
 * manifest or setting a completion flag. Every gate recomputes the compiler-derived
 * current surface and compares it against immutable approved dispositions.
 *
 * PROVENANCE, NOT FRESHNESS, AFTER REVIEW. Applying a remove or migrate changes the
 * current surface by design, so no applied group can match a hash of the current tree.
 * An approval therefore records rawInventoryHash (the raw inventory it was reviewed
 * against) and groupHash (its packages' rows at review time). The review gate checks
 * freshness at review time; the apply gate checks exact expected-surface equality.
 */

export type GateResult = { ok: boolean; detail: string };

export type ApplyScope =
  | { kind: "group" }
  | { kind: "packages"; packages: readonly string[] }
  | { kind: "complement"; exclude: readonly string[] };

export type ApprovalRow = {
  package: string;
  entrypoint: string;
  symbol: string;
  kind?: string;
  disposition?: string;
  route?: string;
  owner?: string;
  rationale?: string;
};

export type ApprovalGroup = {
  id?: string;
  rawInventoryHash?: string;
  groupHash?: string;
  inventoryHash?: string;
  rows?: ApprovalRow[];
};

export type RawInventoryRow = {
  package: string;
  entrypoint: string;
  symbol: string;
  kind: string;
};

export type RawInventory = {
  inventoryHash?: string;
  rows?: RawInventoryRow[];
};

export const RAW_INVENTORY_REL = "docs/openclinxr/package-public-surface-reduction/raw-inventory.json";
export const APPROVALS_DIR_REL = "docs/openclinxr/package-public-surface-reduction/approvals";
export const EVIDENCE_DIR_REL = "docs/openclinxr/package-public-surface-reduction/evidence";
export const BASELINE_REL = "docs/openclinxr/package-public-surface-reduction/baseline.json";

function tableKeys(rows: { package: string; entrypoint: string; symbol: string; kind: string }[]): string[] {
  return rows.map((row) => `${row.package}\t${row.entrypoint}\t${row.symbol}\t${row.kind}`).sort();
}

function inventoryTable(report: SurfaceReport): string[] {
  const rows: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  return tableKeys(rows);
}

/** Hash of the full sorted (package, entrypoint, symbol, kind) table, not the totals. */
export function inventoryHash(root: string, report?: SurfaceReport): string {
  const measured = report ?? measureSurface(root);
  return createHash("sha256").update(inventoryTable(measured).join("\n")).digest("hex");
}

/**
 * Group-scoped hash: the sorted (package, entrypoint, symbol, kind) rows for ONLY
 * the named packages. A change in a package outside the group cannot stale the group.
 */
export function groupHash(
  rows: { package: string; entrypoint: string; symbol: string; kind: string }[],
  packages: readonly string[] | Set<string>,
): string {
  const scope = packages instanceof Set ? packages : new Set(packages);
  return createHash("sha256")
    .update(tableKeys(rows.filter((row) => scope.has(row.package))).join("\n"))
    .digest("hex");
}

/** Group hash of the CURRENT tree, restricted to the named packages. */
export function currentGroupHash(root: string, packages: readonly string[] | Set<string>, report?: SurfaceReport): string {
  const measured = report ?? measureSurface(root);
  const rows: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of measured.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  return groupHash(rows, packages);
}

function readJson(root: string, rel: string): unknown | undefined {
  const full = join(root, rel);
  if (!existsSync(full)) return undefined;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isApprovalGroup(value: unknown): value is ApprovalGroup {
  return value !== null && typeof value === "object";
}

function isRawInventory(value: unknown): value is RawInventory {
  return value !== null && typeof value === "object";
}

function readRawInventory(root: string): { raw?: RawInventory; error?: string } {
  const raw = readJson(root, RAW_INVENTORY_REL);
  if (raw === undefined) return { error: `raw inventory ${RAW_INVENTORY_REL} is absent (PSR-01A has not generated it)` };
  if (!isRawInventory(raw) || !Array.isArray(raw.rows)) {
    return { error: `raw inventory ${RAW_INVENTORY_REL} is malformed` };
  }
  for (const row of raw.rows) {
    if (
      typeof row.package !== "string" ||
      typeof row.entrypoint !== "string" ||
      typeof row.symbol !== "string" ||
      (row.kind !== "runtime" && row.kind !== "type")
    ) {
      return { error: `raw inventory ${RAW_INVENTORY_REL} has a malformed row` };
    }
  }
  return { raw };
}

function malformedRows(rows: ApprovalRow[]): number {
  return rows.filter(
    (row) =>
      typeof row.package !== "string" ||
      row.package === "" ||
      typeof row.entrypoint !== "string" ||
      row.entrypoint === "" ||
      typeof row.symbol !== "string" ||
      row.symbol === "" ||
      (row.kind !== "runtime" && row.kind !== "type") ||
      (row.disposition !== "keep" && row.disposition !== "remove" && row.disposition !== "migrate") ||
      typeof row.owner !== "string" ||
      row.owner === "" ||
      typeof row.rationale !== "string" ||
      row.rationale === "" ||
      (row.disposition === "migrate" && (typeof row.route !== "string" || row.route === "")),
  ).length;
}

function approvalPackages(rows: ApprovalRow[]): Set<string> {
  return new Set(rows.map((row) => row.package));
}

function groupPackagesFor(group: ApprovalGroup, rows: ApprovalRow[]): Set<string> {
  void group;
  return approvalPackages(rows);
}

/**
 * --require-inventory: PSR-01A's raw inventory exists and exactly matches the
 * compiler-measured (package, entrypoint, symbol, kind) table. The 46-root,
 * 137-entrypoint, consumer-form, and source-resolution checks are additional clauses.
 */
export function requireInventory(root: string, report?: SurfaceReport): GateResult {
  const { raw, error } = readRawInventory(root);
  if (raw === undefined) return { ok: false, detail: error ?? "raw inventory unreadable" };
  const measured = report ?? measureSurface(root);
  const measuredSet = new Set(inventoryTable(measured));
  const listedSet = new Set(tableKeys(raw.rows ?? []));
  const missing = [...measuredSet].filter((key) => !listedSet.has(key));
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `${missing.length} compiler-measured symbols missing from raw inventory: ${missing.slice(0, 5).join(", ")}`,
    };
  }
  const extra = [...listedSet].filter((key) => !measuredSet.has(key));
  if (extra.length > 0) {
    return {
      ok: false,
      detail: `${extra.length} raw-inventory rows the compiler does not find: ${extra.slice(0, 5).join(", ")}`,
    };
  }
  const current = inventoryHash(root, measured);
  if (raw.inventoryHash !== current) {
    return {
      ok: false,
      detail: `raw inventory hash differs from the current inventoryHash (stale: PSR-01A must regenerate)`,
    };
  }
  if (measured.packages.length < 46) {
    return { ok: false, detail: `inventory finds ${measured.packages.length} packages, need 46` };
  }
  if (measured.totals.entrypoints < 137) {
    return { ok: false, detail: `inventory finds ${measured.totals.entrypoints} entrypoints, need 137` };
  }
  const hits = discoverConsumers(root);
  const forms = new Set<string>();
  for (const list of hits.values()) for (const hit of list) forms.add(hit.form);
  for (const form of ["static", "dynamic", "require", "re-export", "computed"] as const) {
    if (!forms.has(form)) return { ok: false, detail: `inventory finds no ${form} consumer form` };
  }
  const missingSource = measured.packages.flatMap((pkg) =>
    pkg.entrypoints.filter((entry) => entry.source === "").map((entry) => `${pkg.name}${entry.specifier}`),
  );
  if (missingSource.length > 0) {
    return { ok: false, detail: `inventory cannot resolve sources: ${missingSource.slice(0, 5).join(", ")}` };
  }
  return { ok: true, detail: `inventory complete: ${measured.packages.length} packages, ${measured.totals.entrypoints} entrypoints` };
}

/** Read and validate an approval manifest structurally (rows resolved), without hash checks. */
function readResolvedApproval(root: string, group: string): { value?: ApprovalGroup; rows?: ApprovalRow[]; error?: string } {
  const value = readJson(root, `${APPROVALS_DIR_REL}/${group}.json`);
  if (value === undefined) return { error: `approval manifest for ${group} is absent` };
  if (!isApprovalGroup(value)) return { error: `approval manifest for ${group} is malformed` };
  const rows = value.rows;
  if (rows === undefined || rows.length === 0) return { error: `approval manifest for ${group} is empty` };
  const bad = malformedRows(rows);
  if (bad > 0) return { error: `${bad} unresolved or malformed rows in ${group}` };
  return { value, rows };
}

/**
 * --require-reviewed-group: rows resolved; rawInventoryHash equals the checked-in
 * raw-inventory.json hash; groupHash equals the group hash of the CURRENT tree.
 * Fresh at review time, so a review cannot approve a surface that has since moved.
 */
export function requireReviewedGroup(root: string, group: string): GateResult {
  const read = readResolvedApproval(root, group);
  if (read.value === undefined || read.rows === undefined) {
    return { ok: false, detail: read.error ?? `approval manifest for ${group} is unreadable` };
  }
  const { raw, error } = readRawInventory(root);
  if (raw === undefined) return { ok: false, detail: error ?? "raw inventory unreadable" };
  const rawHash = raw.inventoryHash;
  if (typeof read.value.rawInventoryHash !== "string" || read.value.rawInventoryHash === "") {
    if (typeof read.value.inventoryHash === "string" && read.value.inventoryHash !== "") {
      return {
        ok: false,
        detail: `approval manifest for ${group} uses the retired inventoryHash field; re-issue with rawInventoryHash and groupHash`,
      };
    }
    return { ok: false, detail: `approval manifest for ${group} has no rawInventoryHash` };
  }
  if (read.value.rawInventoryHash !== rawHash) {
    return { ok: false, detail: `approval manifest for ${group} is stale: raw inventory hash moved` };
  }
  if (typeof read.value.groupHash !== "string" || read.value.groupHash === "") {
    return { ok: false, detail: `approval manifest for ${group} has no groupHash` };
  }
  const packages = groupPackagesFor(read.value, read.rows);
  const current = currentGroupHash(root, packages);
  if (read.value.groupHash !== current) {
    return { ok: false, detail: `approval manifest for ${group} is stale: group surface moved since review` };
  }
  return { ok: true, detail: `group ${group} reviewed: ${read.rows.length} resolved rows` };
}

const COMPLETION_KEYS = new Set(["migrated", "completedby", "completed", "done", "applied", "complete", "success"]);

/** Evidence files carrying a completion flag are self-attestation, rejected outright. */
function completionFlag(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!COMPLETION_KEYS.has(key.toLowerCase())) continue;
    if (entry === true) return key;
    if (typeof entry === "string" && entry !== "") return key;
    if (typeof entry === "number" && entry !== 0) return key;
  }
  return undefined;
}

function entrypointSymbols(
  report: SurfaceReport,
): Map<string, Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, Map<string, string>>>();
  for (const pkg of report.packages) {
    const entries = new Map<string, Map<string, string>>();
    for (const entry of pkg.entrypoints) {
      const symbols = new Map<string, string>();
      for (const symbol of entry.symbols) symbols.set(symbol.name, symbol.kind);
      entries.set(entry.specifier, symbols);
    }
    out.set(pkg.packageDir, entries);
  }
  return out;
}

/**
 * Expected surface of the group's packages: raw-inventory rows for those packages with
 * every remove deleted, every migrate moved to its route, every keep retained.
 */
export function expectedSurface(
  rawRows: RawInventoryRow[],
  approvalRows: ApprovalRow[],
  packages: Set<string>,
): Map<string, Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, Map<string, string>>>();
  const put = (pkg: string, entry: string, symbol: string, kind: string): void => {
    let entries = out.get(pkg);
    if (entries === undefined) {
      entries = new Map();
      out.set(pkg, entries);
    }
    let symbols = entries.get(entry);
    if (symbols === undefined) {
      symbols = new Map();
      entries.set(entry, symbols);
    }
    symbols.set(symbol, kind);
  };
  for (const row of rawRows) {
    if (!packages.has(row.package)) continue;
    put(row.package, row.entrypoint, row.symbol, row.kind);
  }
  for (const row of approvalRows) {
    if (!packages.has(row.package)) continue;
    if (row.disposition === "remove") {
      out.get(row.package)?.get(row.entrypoint)?.delete(row.symbol);
    } else if (row.disposition === "migrate") {
      out.get(row.package)?.get(row.entrypoint)?.delete(row.symbol);
      put(row.package, row.route ?? "", row.symbol, row.kind ?? "runtime");
    }
  }
  return out;
}

function scopePackages(
  measured: SurfaceReport,
  resolution: { group: string; scope: ApplyScope },
  groupPackages: Set<string>,
): Set<string> {
  const scope = resolution.scope;
  if (scope.kind === "group") return groupPackages;
  if (scope.kind === "packages") return new Set(scope.packages);
  const excluded = new Set(scope.exclude);
  const out = new Set<string>();
  for (const pkg of measured.packages) {
    if (groupPackages.has(pkg.packageDir) && !excluded.has(pkg.packageDir)) out.add(pkg.packageDir);
  }
  for (const dir of groupPackages) {
    if (!excluded.has(dir)) out.add(dir);
  }
  return out;
}

/**
 * --require-applied: resolves apply ids through the apply map, then requires exact
 * expected-surface equality on the in-scope packages. Compares the approval's
 * rawInventoryHash against the CHECKED-IN raw-inventory.json hash (not the current
 * tree: applying a disposition moves the surface by design).
 */
export function requireApplied(root: string, id: string, report?: SurfaceReport): GateResult {
  const direct = readJson(root, `${APPROVALS_DIR_REL}/${id}.json`);
  const resolution = resolveApplyId(id) ?? (direct !== undefined ? { group: id, scope: { kind: "group" as const } } : undefined);
  if (resolution === undefined) {
    return { ok: false, detail: `unknown apply id ${id}` };
  }  const read = readResolvedApproval(root, resolution.group);
  if (read.value === undefined || read.rows === undefined) {
    const detail = (read.error ?? `approval manifest for ${resolution.group} is unreadable`).replace(
      resolution.group,
      `${resolution.group} (via ${id})`,
    );
    return { ok: false, detail };
  }
  const evidence = readJson(root, `${EVIDENCE_DIR_REL}/${id}.json`)
    ?? readJson(root, `${EVIDENCE_DIR_REL}/${resolution.group}.json`);
  const flag = evidence === undefined ? undefined : completionFlag(evidence);
  if (flag !== undefined) {
    return { ok: false, detail: `group ${id} rejected: evidence carries self-attested completion flag "${flag}"` };
  }
  const { raw, error } = readRawInventory(root);
  if (raw === undefined) return { ok: false, detail: error ?? "raw inventory unreadable" };
  if (typeof read.value.rawInventoryHash !== "string" || read.value.rawInventoryHash !== raw.inventoryHash) {
    return { ok: false, detail: `group ${id} rejected: rawInventoryHash does not match raw-inventory.json` };
  }
  const groupPackages = groupPackagesFor(read.value, read.rows);
  if (groupHash(raw.rows ?? [], groupPackages) !== read.value.groupHash) {
    return { ok: false, detail: `group ${id} rejected: groupHash does not match the raw inventory rows` };
  }
  const measured = report ?? measureSurface(root);
  const scoped = scopePackages(measured, resolution, groupPackages);
  const scopedRows = read.rows.filter((row) => scoped.has(row.package));
  if (resolution.scope.kind !== "group" && scopedRows.length === 0) {
    return { ok: false, detail: `group ${id} rejected: no approval rows in this apply card's package scope` };
  }
  const expected = expectedSurface(raw.rows ?? [], scopedRows, scoped);
  const current = entrypointSymbols(measured);
  const failures: string[] = [];
  const expectedPackages = new Set([...expected.keys()].filter((dir) => scoped.has(dir)));
  for (const packageDir of scoped) expectedPackages.add(packageDir);
  for (const packageDir of [...expectedPackages].sort()) {
    const wantEntries = expected.get(packageDir) ?? new Map<string, Map<string, string>>();
    const haveEntries = current.get(packageDir) ?? new Map<string, Map<string, string>>();
    const specifiers = new Set([...wantEntries.keys(), ...haveEntries.keys()]);
    for (const specifier of [...specifiers].sort()) {
      const want = wantEntries.get(specifier) ?? new Map<string, string>();
      const have = haveEntries.get(specifier) ?? new Map<string, string>();
      for (const name of [...want.keys()].sort()) {
        if (!have.has(name)) failures.push(`missing: ${packageDir}${specifier} should publish ${name}`);
      }
      for (const name of [...have.keys()].sort()) {
        if (!want.has(name)) failures.push(`extra: ${packageDir}${specifier} publishes unapproved ${name}`);
      }
    }
  }
  if (failures.length > 0) {
    return { ok: false, detail: `group ${id} not applied: ${failures.slice(0, 5).join("; ")}` };
  }
  const removes = scopedRows.filter((row) => row.disposition === "remove").length;
  const migrates = scopedRows.filter((row) => row.disposition === "migrate").length;
  return { ok: true, detail: `group ${id} applied: ${removes} removed, ${migrates} migrated` };
}

/**
 * --require-all-reviewed: every group is resolved and provenance-consistent
 * (rawInventoryHash and groupHash-from-raw-inventory), never freshness against
 * the current tree, so applied groups do not stale each other.
 */
export function requireAllReviewed(root: string): GateResult {
  const { raw, error } = readRawInventory(root);
  if (raw === undefined) {
    const groups = ["psr-01b", "psr-01c", "psr-01d", "psr-01e"];
    for (const group of groups) {
      const read = readResolvedApproval(root, group);
      if (read.value === undefined) return { ok: false, detail: read.error ?? `approval manifest for ${group} is unreadable` };
    }
    return { ok: false, detail: error ?? "raw inventory unreadable" };
  }
  const rawHash = raw.inventoryHash;
  const groups = ["psr-01b", "psr-01c", "psr-01d", "psr-01e"];
  for (const group of groups) {
    const read = readResolvedApproval(root, group);
    if (read.value === undefined || read.rows === undefined) {
      return { ok: false, detail: read.error ?? `approval manifest for ${group} is unreadable` };
    }
    if (read.value.rawInventoryHash !== rawHash) {
      return { ok: false, detail: `group ${group} is stale: raw inventory hash moved` };
    }
    if (groupHash(raw.rows ?? [], approvalPackages(read.rows)) !== read.value.groupHash) {
      return { ok: false, detail: `group ${group} groupHash does not match the raw inventory rows` };
    }
  }
  return { ok: true, detail: "all review groups resolved" };
}

const SELF_TEST_MANIFEST = (name: string): string =>
  JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } });

function writeSelfTestPackage(fixture: string, dir: string, source: string): void {
  mkdirSync(join(fixture, dir, "src"), { recursive: true });
  writeFileSync(join(fixture, dir, "package.json"), SELF_TEST_MANIFEST(`@openclinxr/${dir.split("/").pop()}`));
  writeFileSync(join(fixture, dir, "src/index.ts"), source);
}

function writeSelfTestRaw(fixture: string): void {
  const report = measureSurface(fixture);
  const rows: RawInventoryRow[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  mkdirSync(join(fixture, "docs/openclinxr/package-public-surface-reduction"), { recursive: true });
  writeFileSync(
    join(fixture, RAW_INVENTORY_REL),
    JSON.stringify({ inventoryHash: inventoryHash(fixture, report), rows }, null, 2),
  );
}

/**
 * Self-test: every gate fails closed without touching the repo tree. Each entry's `ok`
 * means the expectation was met. The third entry builds a temp fixture workspace with a
 * present, reviewed, fresh-hash group that has NOT been applied, and proves
 * --require-applied refuses it.
 */
export function selfTest(root: string): GateResult[] {
  const absentReviewed = requireReviewedGroup(root, "psr-absent-group-that-cannot-exist");
  const absentApplied = requireApplied(root, "psr-absent-group-that-cannot-exist");
  const out: GateResult[] = [
    { ok: !absentReviewed.ok, detail: absentReviewed.detail },
    { ok: !absentApplied.ok, detail: absentApplied.detail },
  ];
  const fixture = join(tmpdir(), `surface-selftest-${process.pid}`);
  try {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(join(fixture, APPROVALS_DIR_REL), { recursive: true });
    writeFileSync(join(fixture, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    writeSelfTestPackage(fixture, "packages/openclinxr/psr-01b", "export const keep = 1;\n");
    writeSelfTestPackage(fixture, "packages/openclinxr/fixture-selftest", "export const doomed = 1;\n");
    writeSelfTestRaw(fixture);
    const packages = new Set(["packages/openclinxr/fixture-selftest"]);
    const group = currentGroupHash(fixture, packages);
    writeFileSync(
      join(fixture, `${APPROVALS_DIR_REL}/psr-selftest-unapplied.json`),
      JSON.stringify({
        id: "psr-selftest-unapplied",
        rawInventoryHash: inventoryHash(fixture),
        groupHash: group,
        rows: [
          {
            package: "packages/openclinxr/fixture-selftest",
            entrypoint: ".",
            symbol: "doomed",
            kind: "runtime",
            disposition: "remove",
            owner: "self-test",
            rationale: "fixture row that has not been applied",
          },
        ],
      }),
    );
    const unapplied = requireApplied(fixture, "psr-selftest-unapplied");
    out.push({ ok: !unapplied.ok, detail: `unapplied fixture group refused: ${unapplied.detail}` });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  return out;
}

export function currentManifestHashes(root: string): Record<string, string> {
  const report = measureSurface(root);
  const out: Record<string, string> = {};
  for (const pkg of report.packages) out[pkg.packageDir] = manifestHash(root, pkg.packageDir);
  return out;
}
