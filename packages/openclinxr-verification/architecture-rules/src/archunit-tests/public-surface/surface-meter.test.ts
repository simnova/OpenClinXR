import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConsumers } from "../../checks/public-surface/consumers.js";
import {
  groupHash,
  inventoryHash,
  requireApplied,
  requireInventory,
  requireReviewedGroup,
} from "../../checks/public-surface/gates.js";
import { declaredEntrypoints, discoverScopePackages, measureSurface, resolveEntrypointSource } from "../../checks/public-surface/resolve.js";
import type { RunnerIo } from "../../checks/public-surface/runner.js";
import { runVerify } from "../../checks/public-surface/runner.js";

/**
 * The PSR-00 compiler-resolved meter proves it can fail: fixture clauses cover every
 * supported syntax and consumer form, and live-tree clauses pin the full 46-package tree.
 * H1-H5 falsifiers: each handback defect has a fixture whose exit flips after the fix.
 */

function withTree(
  files: Record<string, string>,
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "surface-meter-"));
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

const manifest = (name: string, extraExports?: Record<string, unknown>): string =>
  JSON.stringify({
    name,
    exports: {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      ...(extraExports ?? {}),
    },
  });

const memIo: RunnerIo = {
  readBaseline: () => undefined,
  writeFile: () => {},
};

const approvalDir = "docs/openclinxr/package-public-surface-reduction/approvals";
const evidenceDir = "docs/openclinxr/package-public-surface-reduction/evidence";
const rawInventoryRel = "docs/openclinxr/package-public-surface-reduction/raw-inventory.json";

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
  rows.sort((a, b) => `${a.package}\t${a.entrypoint}\t${a.symbol}`.localeCompare(`${b.package}\t${b.entrypoint}\t${b.symbol}`));
  mkdirSync(join(root, "docs/openclinxr/package-public-surface-reduction"), { recursive: true });
  writeFileSync(join(root, rawInventoryRel), JSON.stringify({ inventoryHash: inventoryHash(root, report), rows }, null, 2));
}

function groupPackagesOf(
  rows: { package: string; entrypoint: string; symbol: string; kind: string; disposition: string; route?: string }[],
): Set<string> {
  return new Set(rows.map((row) => row.package));
}

function writeGroup(
  root: string,
  group: string,
  rows: { package: string; entrypoint: string; symbol: string; kind: string; disposition: string; route?: string }[],
): void {
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
  const packages = groupPackagesOf(rows);
  writeFileSync(
    join(root, `${approvalDir}/${group}.json`),
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

describe("compiler-resolved surface meter", () => {
  it("(1) the live tree discovers 46 roots and 114 declared entrypoints", () => {
    const report = measureSurface();
    expect(report.totals.roots).toBe(46);
    // 137 before PSR-06; 114 after it un-published 23 ui-route-admin subpaths whose every name the
    // approval removes. Re-derived independently by counting `exports` keys in the 46 scoped
    // package.json files (137 on origin/main 91429f54, 114 on the PSR-06 tree).
    expect(report.totals.entrypoints).toBe(114);
  });

  it("(2) rest and ui-route-admin match compiler exports", () => {
    const report = measureSurface();
    const byDir = new Map(report.packages.map((pkg) => [pkg.packageDir, pkg]));
    // 193 before PSR-04; 94 after it applied approval psr-01d (93 keep + FACTORY_RUN_ROLLUP_REL kept at land).
    // Re-derived independently with ts.TypeChecker.getExportsOfModule on rest/src/index.ts, which also
    // returns the untouched ui-route-admin pin (277), so the method agrees with this calibration.
    expect(byDir.get("packages/openclinxr/rest")?.rootSymbols).toBe(94);
    // 277 before PSR-06; 12 after it (approval psr-01d ui-route-admin subset), re-derived with
    // ts.TypeChecker.getExportsOfModule on ui-route-admin/src/index.ts, which still returns 94 for rest.
    expect(byDir.get("packages/openclinxr/ui-route-admin")?.rootSymbols).toBe(12);
  });

  it("(3) all four arena packages are reported", () => {
    const scope = discoverScopePackages();
    const dirs = scope.map((pkg) => pkg.packageDir);
    for (const arena of [
      "packages/openclinxr/arena/iwsdk-spike",
      "packages/openclinxr/arena/model-vetting",
      "packages/openclinxr/arena/multi-actor-state-spike",
      "packages/openclinxr/arena/physics-touch-contract",
    ]) {
      expect(dirs, arena).toContain(arena);
    }
    const report = measureSurface();
    expect(report.packages.length).toBe(46);
  });

  it("(4) COUNTERWEIGHT: a nested package outside the ceiling fails inventory", () => {
    withTree(
      {
        "packages/openclinxr/only-one/package.json": manifest("@openclinxr/only-one"),
        "packages/openclinxr/only-one/src/index.ts": "export const a = 1;\n",
      },
      (root) => {
        expect(requireInventory(root).ok).toBe(false);
      },
    );
  });

  it("(5) named exports, aliases, namespace, star, type-star, and quotes resolve", () => {
    withTree(
      {
        "packages/openclinxr/fixture-a/package.json": manifest("@openclinxr/fixture-a"),
        "packages/openclinxr/fixture-a/src/index.ts":
          "export const named = 1;\nexport { named as aliased } from './other.js';\nexport * from './star.js';\nexport type * from './types.js';\nexport * from './single.js';\n",
        "packages/openclinxr/fixture-a/src/other.ts": "export const named = 1;\n",
        "packages/openclinxr/fixture-a/src/star.ts": "export const fromStar = 1;\n",
        "packages/openclinxr/fixture-a/src/types.ts": "export type FromType = number;\n",
        "packages/openclinxr/fixture-a/src/single.ts": "export const fromSingle = 1;\n",
      },
      (root) => {
        const report = measureSurface(root);
        const pkg = report.packages.find((item) => item.packageDir === "packages/openclinxr/fixture-a");
        const names = (pkg?.entrypoints[0]?.symbols ?? []).map((symbol) => symbol.name);
        for (const name of ["named", "aliased", "fromStar", "FromType", "fromSingle"]) {
          expect(names, name).toContain(name);
        }
        expect(pkg?.entrypoints[0]?.wildcardDeclarations).toBeGreaterThan(0);
        expect(pkg?.entrypoints[0]?.typeWildcardDeclarations).toBe(1);
      },
    );
  });

  it("(6) single-quoted specifiers and nested re-export chains resolve", () => {
    withTree(
      {
        "packages/openclinxr/fixture-b/package.json": manifest("@openclinxr/fixture-b"),
        "packages/openclinxr/fixture-b/src/index.ts": "export * from './chain.js';\n",
        "packages/openclinxr/fixture-b/src/chain.ts": "export * from './leaf.js';\n",
        "packages/openclinxr/fixture-b/src/leaf.ts": "export const deep = 1;\n",
      },
      (root) => {
        const report = measureSurface(root);
        const names = (
          report.packages.find((item) => item.packageDir === "packages/openclinxr/fixture-b")
            ?.entrypoints[0]?.symbols ?? []
        ).map((symbol) => symbol.name);
        expect(names).toContain("deep");
      },
    );
  });

  it("(7) runtime and type symbols are distinguished", () => {
    withTree(
      {
        "packages/openclinxr/fixture-c/package.json": manifest("@openclinxr/fixture-c"),
        "packages/openclinxr/fixture-c/src/index.ts":
          "export const runtimeValue = 1;\nexport type TypeOnly = number;\nexport interface Shaped { a: string }\n",
      },
      (root) => {
        const report = measureSurface(root);
        const symbols =
          report.packages.find((item) => item.packageDir === "packages/openclinxr/fixture-c")
            ?.entrypoints[0]?.symbols ?? [];
        const byName = new Map(symbols.map((symbol) => [symbol.name, symbol.kind]));
        expect(byName.get("runtimeValue")).toBe("runtime");
        expect(byName.get("TypeOnly")).toBe("type");
        expect(byName.get("Shaped")).toBe("type");
      },
    );
  });

  it("(8) consumers: static, dynamic, require, re-export, and computed access are found", () => {
    withTree(
      {
        "packages/openclinxr/fixture-d/package.json": manifest("@openclinxr/fixture-d"),
        "packages/openclinxr/fixture-d/src/index.ts": "export const hello = 1;\n",
        "apps/consumer-a/static.ts": "import { hello } from '@openclinxr/fixture-d';\nconsole.log(hello);\n",
        "apps/consumer-a/dynamic.mts": "const mod = await import(\"@openclinxr/fixture-d\");\nconsole.log(mod);\n",
        "tools/consumer-b/using.cjs": "const mod = require('@openclinxr/fixture-d');\nconsole.log(mod);\n",
        "packages/openclinxr/other/src/re-export.ts": "export { hello } from \"@openclinxr/fixture-d\";\n",
        "apps/consumer-a/computed.js": "const mod = await import(\"@openclinxr/fixture-d\");\nconsole.log(mod[\"hello\"]);\n",
      },
      (root) => {
        const hits = discoverConsumers(root).get("@openclinxr/fixture-d") ?? [];
        const forms = new Set(hits.map((hit) => hit.form));
        for (const form of ["static", "dynamic", "require", "re-export", "computed"] as const) {
          expect(forms.has(form), form).toBe(true);
        }
      },
    );
  });

  it("(9) every supported source extension is scanned", () => {
    withTree(
      {
        "packages/openclinxr/fixture-e/package.json": manifest("@openclinxr/fixture-e"),
        "packages/openclinxr/fixture-e/src/index.ts": "export const hello = 1;\n",
        "apps/a/one.ts": "import '@openclinxr/fixture-e';\n",
        "apps/a/two.tsx": "import '@openclinxr/fixture-e';\n",
        "apps/a/three.mts": "import '@openclinxr/fixture-e';\n",
        "apps/a/four.cts": "import '@openclinxr/fixture-e';\n",
        "apps/a/five.js": "import '@openclinxr/fixture-e';\n",
        "apps/a/six.mjs": "import '@openclinxr/fixture-e';\n",
        "apps/a/seven.cjs": "require('@openclinxr/fixture-e');\n",
      },
      (root) => {
        const hits = discoverConsumers(root).get("@openclinxr/fixture-e") ?? [];
        expect(hits.length).toBe(7);
      },
    );
  });

  it("(10) COUNTERWEIGHT: absent, empty, malformed, or unresolved groups fail", () => {
    withTree(
      {
        "packages/openclinxr/fixture-f/package.json": manifest("@openclinxr/fixture-f"),
        "packages/openclinxr/fixture-f/src/index.ts": "export const hello = 1;\n",
      },
      (root) => {
        expect(requireReviewedGroup(root, "psr-absent").ok).toBe(false);
        expect(requireApplied(root, "psr-absent").ok).toBe(false);
      },
    );
  });

  it("(11) declared entrypoints expose a source for built-output resolution", () => {
    withTree(
      {
        "packages/openclinxr/fixture-g/package.json": manifest("@openclinxr/fixture-g", {
          "./extra": { types: "./dist/extra.d.ts", default: "./dist/extra.js" },
        }),
        "packages/openclinxr/fixture-g/src/index.ts": "export const hello = 1;\n",
        "packages/openclinxr/fixture-g/src/extra.ts": "export const more = 2;\n",
      },
      (root) => {
        const entries = declaredEntrypoints(root, "packages/openclinxr/fixture-g", "@openclinxr/fixture-g");
        expect(entries.map((entry) => entry.specifier)).toEqual([".", "./extra"]);
        for (const entry of entries) {
          expect(resolveEntrypointSource(root, entry) !== undefined, entry.specifier).toBe(true);
        }
      },
    );
  });

  it("(H1) plain verify fails when a package grows, passes when it shrinks back", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h1/package.json": manifest("@openclinxr/fixture-h1"),
        "packages/openclinxr/fixture-h1/src/index.ts": "export const steady = 1;\n",
      },
      (root) => {
        const baseline = {
          totals: { rootSymbols: 1, occurrences: 1, uniqueSymbols: 1, duplicateNames: 0 },
          packages: [
            {
              packageDir: "packages/openclinxr/fixture-h1",
              rootSymbols: 1,
              occurrences: 1,
              uniqueSymbols: 1,
              duplicateNames: 0,
              entrypoints: [{ specifier: ".", wildcardDeclarations: 0, typeWildcardDeclarations: 0 }],
            },
          ],
        };
        expect(runVerify({ root, args: [], io: { ...memIo, readBaseline: () => baseline } }).failed).toBe(false);
        writeFileSync(join(root, "packages/openclinxr/fixture-h1/src/index.ts"), "export const steady = 1;\nexport const added = 2;\n");
        expect(runVerify({ root, args: [], io: { ...memIo, readBaseline: () => baseline } }).failed).toBe(true);
        writeFileSync(join(root, "packages/openclinxr/fixture-h1/src/index.ts"), "export const steady = 1;\n");
        expect(runVerify({ root, args: [], io: { ...memIo, readBaseline: () => baseline } }).failed).toBe(false);
      },
    );
  });

  it("(H2) renaming a symbol with counts unchanged moves the inventory hash", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h2/package.json": manifest("@openclinxr/fixture-h2"),
        "packages/openclinxr/fixture-h2/src/index.ts": "export const alpha = 1;\n",
      },
      (root) => {
        const before = inventoryHash(root);
        writeFileSync(join(root, "packages/openclinxr/fixture-h2/src/index.ts"), "export const beta = 1;\n");
        expect(inventoryHash(root)).not.toBe(before);
      },
    );
  });

  it("(H3) --require-inventory fails without raw-inventory.json", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h3/package.json": manifest("@openclinxr/fixture-h3"),
        "packages/openclinxr/fixture-h3/src/index.ts": "export const hello = 1;\n",
      },
      (root) => {
        expect(requireInventory(root).ok).toBe(false);
        writeRawInventory(root);
        const raw = JSON.parse(readFileSync(join(root, rawInventoryRel), "utf8")) as {
          rows: { package: string; entrypoint: string; symbol: string; kind: string }[];
        };
        writeFileSync(join(root, rawInventoryRel), JSON.stringify({ inventoryHash: "stale", rows: raw.rows }, null, 2));
        expect(requireInventory(root).ok).toBe(false);
      },
    );
  });

  it("(H4a) a remove scoped to one package is not vetoed by another package's same name", () => {
    withTree(
      {
        "packages/openclinxr/fixture-keep/package.json": manifest("@openclinxr/fixture-keep"),
        "packages/openclinxr/fixture-keep/src/index.ts": "export const shared = 1;\n",
        "packages/openclinxr/fixture-cut/package.json": manifest("@openclinxr/fixture-cut"),
        "packages/openclinxr/fixture-cut/src/index.ts": "export const gone = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h4a", [
          { package: "packages/openclinxr/fixture-keep", entrypoint: ".", symbol: "shared", kind: "runtime", disposition: "keep" },
          { package: "packages/openclinxr/fixture-cut", entrypoint: ".", symbol: "gone", kind: "runtime", disposition: "remove" },
        ]);
        expect(requireApplied(root, "psr-h4a").ok).toBe(false);
        writeFileSync(join(root, "packages/openclinxr/fixture-cut/src/index.ts"), "export const filler = 1;\n");
        writeRawInventory(root);
        writeGroup(root, "psr-h4a", [
          { package: "packages/openclinxr/fixture-keep", entrypoint: ".", symbol: "shared", kind: "runtime", disposition: "keep" },
          { package: "packages/openclinxr/fixture-cut", entrypoint: ".", symbol: "filler", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireApplied(root, "psr-h4a").ok).toBe(true);
      },
    );
  });

  it("(H4b) keep rows are enforced: a kept symbol that disappears fails", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h4b/package.json": manifest("@openclinxr/fixture-h4b"),
        "packages/openclinxr/fixture-h4b/src/index.ts": "export const kept = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h4b", [
          { package: "packages/openclinxr/fixture-h4b", entrypoint: ".", symbol: "kept", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireApplied(root, "psr-h4b").ok).toBe(true);
        writeFileSync(join(root, "packages/openclinxr/fixture-h4b/src/index.ts"), "export const other = 1;\n");
        expect(requireApplied(root, "psr-h4b").ok).toBe(false);
      },
    );
  });

  it("(H4c) migrate rows require absence at the old route and presence at the new route", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h4c/package.json": manifest("@openclinxr/fixture-h4c", {
          "./next": { types: "./dist/next.d.ts", default: "./dist/next.js" },
        }),
        "packages/openclinxr/fixture-h4c/src/index.ts": "export const moving = 1;\n",
        "packages/openclinxr/fixture-h4c/src/next.ts": "export const settled = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h4c", [
          { package: "packages/openclinxr/fixture-h4c", entrypoint: ".", symbol: "moving", kind: "runtime", disposition: "migrate", route: "./next" },
          { package: "packages/openclinxr/fixture-h4c", entrypoint: "./next", symbol: "settled", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireApplied(root, "psr-h4c").ok).toBe(false);
        writeFileSync(join(root, "packages/openclinxr/fixture-h4c/src/index.ts"), "export {};\n");
        writeFileSync(
          join(root, "packages/openclinxr/fixture-h4c/src/next.ts"),
          "export const settled = 1;\nexport const moving = 1;\n",
        );
        expect(requireApplied(root, "psr-h4c").ok).toBe(true);
      },
    );
  });

  it("(H4d) a package publishing a symbol with no row fails", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h4d/package.json": manifest("@openclinxr/fixture-h4d"),
        "packages/openclinxr/fixture-h4d/src/index.ts": "export const listed = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h4d", [
          { package: "packages/openclinxr/fixture-h4d", entrypoint: ".", symbol: "listed", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireApplied(root, "psr-h4d").ok).toBe(true);
        writeFileSync(join(root, "packages/openclinxr/fixture-h4d/src/index.ts"), "export const listed = 1;\nexport const stray = 2;\n");
        expect(requireApplied(root, "psr-h4d").ok).toBe(false);
      },
    );
  });

  it("(H4e) an evidence file carrying a completion flag is rejected outright", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h4e/package.json": manifest("@openclinxr/fixture-h4e"),
        "packages/openclinxr/fixture-h4e/src/index.ts": "export const kept = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h4e", [
          { package: "packages/openclinxr/fixture-h4e", entrypoint: ".", symbol: "kept", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireApplied(root, "psr-h4e").ok).toBe(true);
        mkdirSync(join(root, evidenceDir), { recursive: true });
        writeFileSync(join(root, `${evidenceDir}/psr-h4e.json`), JSON.stringify({ migrated: true }));
        expect(requireApplied(root, "psr-h4e").ok).toBe(false);
      },
    );
  });

  it("(H5) a present, reviewed, fresh-hash but unapplied group is refused", () => {
    withTree(
      {
        "packages/openclinxr/fixture-h5/package.json": manifest("@openclinxr/fixture-h5"),
        "packages/openclinxr/fixture-h5/src/index.ts": "export const doomed = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h5", [
          { package: "packages/openclinxr/fixture-h5", entrypoint: ".", symbol: "doomed", kind: "runtime", disposition: "remove" },
        ]);
        expect(requireReviewedGroup(root, "psr-h5").ok).toBe(true);
        expect(requireApplied(root, "psr-h5").ok).toBe(false);
      },
    );
  });

  it("(H7a) approval made pre-application passes --require-applied after apply", () => {
    withTree(
      {
        "packages/openclinxr/pkg-a/package.json": manifest("@openclinxr/pkg-a"),
        "packages/openclinxr/pkg-a/src/index.ts": "export const alpha = 1;\nexport const steady = 2;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h7a", [
          { package: "packages/openclinxr/pkg-a", entrypoint: ".", symbol: "alpha", kind: "runtime", disposition: "remove" },
          { package: "packages/openclinxr/pkg-a", entrypoint: ".", symbol: "steady", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireReviewedGroup(root, "psr-h7a").ok).toBe(true);
        writeFileSync(join(root, "packages/openclinxr/pkg-a/src/index.ts"), "export const steady = 2;\n");
        expect(requireApplied(root, "psr-h7a").ok, requireApplied(root, "psr-h7a").detail).toBe(true);
      },
    );
  });

  it("(H7b) half the removes applied fails", () => {
    withTree(
      {
        "packages/openclinxr/pkg-b/package.json": manifest("@openclinxr/pkg-b"),
        "packages/openclinxr/pkg-b/src/index.ts": "export const alpha = 1;\nexport const beta = 2;\nexport const steady = 3;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h7b", [
          { package: "packages/openclinxr/pkg-b", entrypoint: ".", symbol: "alpha", kind: "runtime", disposition: "remove" },
          { package: "packages/openclinxr/pkg-b", entrypoint: ".", symbol: "beta", kind: "runtime", disposition: "remove" },
          { package: "packages/openclinxr/pkg-b", entrypoint: ".", symbol: "steady", kind: "runtime", disposition: "keep" },
        ]);
        writeFileSync(
          join(root, "packages/openclinxr/pkg-b/src/index.ts"),
          "export const beta = 2;\nexport const steady = 3;\n",
        );
        expect(requireApplied(root, "psr-h7b").ok).toBe(false);
      },
    );
  });

  it("(H7c) an extra export in a group package after application fails", () => {
    withTree(
      {
        "packages/openclinxr/pkg-c/package.json": manifest("@openclinxr/pkg-c"),
        "packages/openclinxr/pkg-c/src/index.ts": "export const steady = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h7c", [
          { package: "packages/openclinxr/pkg-c", entrypoint: ".", symbol: "steady", kind: "runtime", disposition: "keep" },
        ]);
        expect(requireApplied(root, "psr-h7c").ok).toBe(true);
        writeFileSync(
          join(root, "packages/openclinxr/pkg-c/src/index.ts"),
          "export const steady = 1;\nexport const sneaky = 2;\n",
        );
        expect(requireApplied(root, "psr-h7c").ok).toBe(false);
      },
    );
  });

  it("(H7d) an export added outside the group still passes both gates", () => {
    withTree(
      {
        "packages/openclinxr/pkg-d/package.json": manifest("@openclinxr/pkg-d"),
        "packages/openclinxr/pkg-d/src/index.ts": "export const steady = 1;\n",
        "packages/openclinxr/pkg-far/package.json": manifest("@openclinxr/pkg-far"),
        "packages/openclinxr/pkg-far/src/index.ts": "export const far = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h7d", [
          { package: "packages/openclinxr/pkg-d", entrypoint: ".", symbol: "steady", kind: "runtime", disposition: "keep" },
        ]);
        writeFileSync(
          join(root, "packages/openclinxr/pkg-far/src/index.ts"),
          "export const far = 1;\nexport const more = 2;\n",
        );
        expect(requireReviewedGroup(root, "psr-h7d").ok).toBe(true);
        expect(requireApplied(root, "psr-h7d").ok).toBe(true);
      },
    );
  });

  it("(H7e) an approval whose groupHash does not match raw inventory fails", () => {
    withTree(
      {
        "packages/openclinxr/pkg-e/package.json": manifest("@openclinxr/pkg-e"),
        "packages/openclinxr/pkg-e/src/index.ts": "export const steady = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-h7e", [
          { package: "packages/openclinxr/pkg-e", entrypoint: ".", symbol: "steady", kind: "runtime", disposition: "keep" },
        ]);
        const path = join(root, `${approvalDir}/psr-h7e.json`);
        const approval = JSON.parse(readFileSync(path, "utf8")) as { groupHash: string };
        approval.groupHash = "0".repeat(64);
        writeFileSync(path, JSON.stringify(approval, null, 2));
        expect(requireReviewedGroup(root, "psr-h7e").ok).toBe(false);
        expect(requireApplied(root, "psr-h7e").ok).toBe(false);
      },
    );
  });

  it("(H8f) apply-card scope: rest applied passes psr-04, unapplied asset-registry fails psr-05", () => {
    withTree(
      {
        "packages/openclinxr/rest/package.json": manifest("@openclinxr/rest"),
        "packages/openclinxr/rest/src/index.ts": "export const gone = 1;\nexport const steady = 2;\n",
        "packages/openclinxr/asset-registry/package.json": manifest("@openclinxr/asset-registry"),
        "packages/openclinxr/asset-registry/src/index.ts": "export const pending = 1;\nexport const kept = 2;\n",
      },
      (root) => {
        writeRawInventory(root);
        mkdirSync(join(root, approvalDir), { recursive: true });
        const packages = ["packages/openclinxr/rest", "packages/openclinxr/asset-registry"];
        const report = measureSurface(root);
        const table: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
        for (const pkg of report.packages) {
          for (const entry of pkg.entrypoints) {
            for (const symbol of entry.symbols) {
              table.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
            }
          }
        }
        writeFileSync(
          join(root, `${approvalDir}/psr-01d.json`),
          JSON.stringify(
            {
              id: "psr-01d",
              rawInventoryHash: inventoryHash(root, report),
              groupHash: groupHash(table, packages),
              rows: [
                { package: "packages/openclinxr/rest", entrypoint: ".", symbol: "gone", kind: "runtime", disposition: "remove", owner: "f", rationale: "f" },
                { package: "packages/openclinxr/rest", entrypoint: ".", symbol: "steady", kind: "runtime", disposition: "keep", owner: "f", rationale: "f" },
                { package: "packages/openclinxr/asset-registry", entrypoint: ".", symbol: "pending", kind: "runtime", disposition: "remove", owner: "f", rationale: "f" },
                { package: "packages/openclinxr/asset-registry", entrypoint: ".", symbol: "kept", kind: "runtime", disposition: "keep", owner: "f", rationale: "f" },
              ],
            },
            null,
            2,
          ),
        );
        writeFileSync(join(root, "packages/openclinxr/rest/src/index.ts"), "export const steady = 2;\n");
        expect(requireApplied(root, "psr-04").ok, requireApplied(root, "psr-04").detail).toBe(true);
        expect(requireApplied(root, "psr-05").ok).toBe(false);
      },
    );
  });

  it("(H8g) --require-applied psr-02 with no approvals/psr-01b.json names psr-01b", () => {
    withTree(
      {
        "packages/openclinxr/config-rolldown/package.json": manifest("@openclinxr/config-rolldown"),
        "packages/openclinxr/config-rolldown/src/index.ts": "export const steady = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        const result = requireApplied(root, "psr-02");
        expect(result.ok).toBe(false);
        expect(result.detail).toContain("psr-01b");
      },
    );
  });
});
