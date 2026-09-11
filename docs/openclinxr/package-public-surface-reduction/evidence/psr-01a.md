# PSR-01A evidence — raw contract inventory

Source revision: b5d158dad5e3f58e4b013ce37c2b6a106ec3a34a. Task: PSR-01A v2.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`; working tree matches that commit).

Machine-readable companion: `psr-01a.json` in this directory. Raw rows: `../raw-inventory.json` (3,588 rows, each with `disposition: unresolved`; top-level `inventoryHash` and `manifestHashes`). `inventoryHash` covers the (package, entrypoint, symbol, kind) table only, so the extra fields do not move the gate.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-inventory` — exits 1 before the inventory exists, 0 after (after column below).
- `git diff --check` — no whitespace errors.

## --require-inventory after column (literal output on this tree)

```text
$ tsx tools/openclinxr/architecture/public-surface/verify.ts -- --require-inventory
46 roots, 137 entrypoints, 2533 root symbols, 3588 occurrences, 3020 unique, 550 duplicated names (surface 4782814823d2)
ok: inventory complete: 46 packages, 137 entrypoints
ok baseline ratchet: surface matches the checked-in baseline (no growth)
```

## Measured before and after

Before: compiler-derived baseline of 46 roots, 137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique symbols, 550 duplicated names. After: identical (inventory generation changes no API). Wildcard declarations remaining: 46. Duplicated names remaining: 550.

## Removed, migrated, retained

No exports changed. No implementation deleted. No dispositions approved: all 3,588 rows are `unresolved`. No relocation theater: no namespace wrapping, facade indirection, package splitting, or subpath relocation. Manifest hashes per package are in `psr-01a.json` and `raw-inventory.json` top-level `manifestHashes`.

## Consumer coverage (triage table for PSR-01B..E)

Rows with zero consumers: 694 of 3,588. A consumer hit is attached at entrypoint granularity: the import references the package entrypoint specifier, not an individual symbol, so every symbol row on the same entrypoint shares that entrypoint's hit list (symbol-level binding is review work).

### Consumer forms (hits across the tree)

| Form | Hits |
| --- | ---: |
| static | 917 |
| dynamic | 59 |
| require | 3 |
| re-export | 15 |
| computed | 566 |

### Zero-consumer rows per package

| Package | Rows | Zero-consumer rows |
| --- | ---: | ---: |
| packages/openclinxr/agent-loop | 62 | 62 |
| packages/openclinxr/arena/iwsdk-spike | 101 | 0 |
| packages/openclinxr/arena/model-vetting | 80 | 0 |
| packages/openclinxr/arena/multi-actor-state-spike | 44 | 44 |
| packages/openclinxr/arena/physics-touch-contract | 108 | 0 |
| packages/openclinxr/asset-registry | 538 | 46 |
| packages/openclinxr/auth | 15 | 0 |
| packages/openclinxr/capability-gateway | 47 | 0 |
| packages/openclinxr/config-rolldown | 7 | 0 |
| packages/openclinxr/conversation-policy | 59 | 0 |
| packages/openclinxr/data-mongodb | 73 | 73 |
| packages/openclinxr/data-sources-mongoose-models | 3 | 3 |
| packages/openclinxr/domain | 40 | 0 |
| packages/openclinxr/exam-assembly | 40 | 0 |
| packages/openclinxr/factory-stations | 55 | 0 |
| packages/openclinxr/graphql | 83 | 0 |
| packages/openclinxr/model-gateway | 34 | 0 |
| packages/openclinxr/motion-compiler | 83 | 76 |
| packages/openclinxr/physics-touch-artifacts | 7 | 7 |
| packages/openclinxr/rest | 193 | 0 |
| packages/openclinxr/review-workflow | 42 | 5 |
| packages/openclinxr/scenario-fixtures | 52 | 0 |
| packages/openclinxr/scenario-runtime | 34 | 0 |
| packages/openclinxr/session-state | 63 | 9 |
| packages/openclinxr/shared-schemas | 75 | 0 |
| packages/openclinxr/telemetry | 20 | 0 |
| packages/openclinxr/test-harness | 10 | 10 |
| packages/openclinxr/ui-route-admin | 573 | 225 |
| packages/openclinxr/ui-route-shared | 210 | 107 |
| packages/openclinxr/ui-shared | 102 | 23 |
| packages/openclinxr/voice-gateway | 17 | 0 |
| packages/openclinxr/xr-actor-dialogue | 33 | 0 |
| packages/openclinxr/xr-asset-loading | 30 | 0 |
| packages/openclinxr/xr-capture-evidence | 39 | 0 |
| packages/openclinxr/xr-dialogue | 62 | 0 |
| packages/openclinxr/xr-exam-flow | 18 | 0 |
| packages/openclinxr/xr-humanoid-animation | 59 | 4 |
| packages/openclinxr/xr-locomotion | 32 | 0 |
| packages/openclinxr/xr-pose | 60 | 0 |
| packages/openclinxr/xr-runtime-state | 144 | 0 |
| packages/openclinxr/xr-runtime-wiring | 13 | 0 |
| packages/openclinxr/xr-scene | 55 | 0 |
| packages/openclinxr/xr-scene-cues | 40 | 0 |
| packages/openclinxr/xr-station | 80 | 0 |
| packages/openclinxr/xr-station-room | 26 | 0 |
| packages/openclinxr/xr-trace-readiness | 27 | 0 |

18 consumer hits reference specifiers outside the 46-package scope or undeclared subpaths (PSR-00 fixtures and app-only packages such as `@openclinxr/api`, `@openclinxr/ui-xr`); they are excluded from row attribution and listed here: @openclinxr/api (static, packages/openclinxr/data-mongodb/src/api-persistence-sink.integration.test.ts); @openclinxr/fixture-d (require, packages/openclinxr-verification/architecture-rules/src/archunit-tests/public-surface/surface-meter.test.ts); @openclinxr/fixture-d (static, packages/openclinxr-verification/architecture-rules/src/archunit-tests/public-surface/surface-meter.test.ts); @openclinxr/fixture-e (require, packages/openclinxr-verification/architecture-rules/src/archunit-tests/public-surface/surface-meter.test.ts); @openclinxr/fixture-e (static, packages/openclinxr-verification/architecture-rules/src/archunit-tests/public-surface/surface-meter.test.ts); @openclinxr/fixture-package (computed, packages/openclinxr-verification/architecture-rules/src/archunit-tests/unused-entrypoint-exports.test.ts); @openclinxr/fixture-package (static, packages/openclinxr-verification/architecture-rules/src/archunit-tests/unused-entrypoint-exports.test.ts); @openclinxr/fixture-w (require, packages/openclinxr-verification/architecture-rules/src/checks/public-surface/meter.unit.test.ts); @openclinxr/fixture-w (static, packages/openclinxr-verification/architecture-rules/src/checks/public-surface/meter.unit.test.ts); @openclinxr/other (re-export, tools/openclinxr/architecture/narrow-entrypoint.ts); @openclinxr/ui-xr (computed, tools/openclinxr/evidence/iwsdk-workspace-posture-check.test.ts); @openclinxr/ui-xr (static, packages/openclinxr-verification/architecture-rules/src/archunit-tests/the-factory-does-not-import-the-apps-it-feeds.test.ts); @openclinxr/ui-xr (static, tools/openclinxr/evidence/iwsdk-workspace-posture-check.test.ts).

## Claim

The complete raw contract inventory is generated mechanically from the PSR-00 meter without changing any package API; `verify --require-inventory` finds every package, entrypoint, and supported consumer class.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.

## Regenerate with

One-off generator script (kept outside the repo; run from the worktree root with `node_modules/.bin/tsx <script>`). It imports `measureSurface()`, `discoverConsumers()`, `inventoryHash()`, and `currentManifestHashes()` from the PSR-00 package source and writes `raw-inventory.json` plus coverage stats:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = "<worktree-root>";
const { measureSurface } = await import(join(ROOT, "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/resolve.ts"));
const { discoverConsumers } = await import(join(ROOT, "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/consumers.ts"));
const { inventoryHash, currentManifestHashes } = await import(join(ROOT, "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/gates.ts"));
const report = measureSurface(ROOT);
const hash = inventoryHash(ROOT, report);
const manifestHashes = currentManifestHashes(ROOT);
const dirByName = new Map(report.packages.map((p) => [p.name, p.packageDir]));
const declaredByDir = new Map(report.packages.map((p) => [p.packageDir, new Set(p.entrypoints.map((e) => e.specifier))]));
const hitsByRow = new Map();
const unmatched: { specifier: string; file: string; form: string }[] = [];
const hits = discoverConsumers(ROOT);
for (const [name, list] of hits) {
  const dir = dirByName.get(name);
  if (dir === undefined) { for (const h of list) unmatched.push({ specifier: h.specifier, file: h.file, form: h.form }); continue; }
  const declared = declaredByDir.get(dir);
  for (const h of list) {
    const parts = h.specifier.split("/");
    const candidate = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
    if (declared !== undefined && declared.has(candidate)) {
      const key = `${dir}\t${candidate}`;
      if (!hitsByRow.has(key)) hitsByRow.set(key, []);
      hitsByRow.get(key).push({ file: h.file, form: h.form });
    } else {
      unmatched.push({ specifier: h.specifier, file: h.file, form: h.form });
    }
  }
}
const rows = [];
for (const pkg of report.packages) {
  for (const entry of pkg.entrypoints) {
    const cons = (hitsByRow.get(`${pkg.packageDir}\t${entry.specifier}`) ?? []).slice().sort((a, b) => (a.file + a.form).localeCompare(b.file + b.form));
    for (const symbol of entry.symbols) {
      rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind, disposition: "unresolved", consumers: cons });
    }
  }
}
rows.sort((a, b) => (a.package + a.entrypoint + a.symbol).localeCompare(b.package + b.entrypoint + b.symbol));
writeFileSync(join(ROOT, "docs/openclinxr/package-public-surface-reduction/raw-inventory.json"), JSON.stringify({ inventoryHash: hash, manifestHashes, rows }, null, 2) + "\n");
// coverage stats for the evidence report
const formHits = {};
for (const [, list] of hits) for (const h of list) formHits[h.form] = (formHits[h.form] ?? 0) + 1;
const perPackage = {};
for (const pkg of report.packages) perPackage[pkg.packageDir] = { rows: 0, zeroConsumerRows: 0 };
for (const r of rows) { perPackage[r.package].rows += 1; if (r.consumers.length === 0) perPackage[r.package].zeroConsumerRows += 1; }
writeFileSync("/tmp/psr01a-coverage.json", JSON.stringify({ formHits, perPackage, unmatched, zeroTotal: rows.filter((r) => r.consumers.length === 0).length }, null, 2) + "\n");
console.log("rows:", rows.length, "hash:", hash, "zero-consumer rows:", rows.filter((r) => r.consumers.length === 0).length, "unmatched hits:", unmatched.length);

```
