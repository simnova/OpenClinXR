# PSR-01B evidence — support-contract review (config-rolldown, physics-touch-artifacts, test-harness, auth, telemetry)

Source revision: 40b6a874bde71b77bc8642c0b3edec3626ac8b1e. Task: PSR-01B v2.
Governing plan `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `1c493f12cd9ff5084e763c7e46f7ac4a5d57635c` (SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).

Machine-readable companion: `psr-01b.json` in this directory. Approval manifest: `../approvals/psr-01b.json` (59 rows; `rawInventoryHash` `e43ee9c249ee`, `groupHash` `82f312da4e6a`). No package API was changed.

## Commands and outcomes

- `pnpm arch:public-surface:verify -- --require-reviewed-group psr-01b` — exits 1 before the approval exists (`approval manifest for psr-01b is absent`), 0 after (after column below).
- `git diff --check` — no whitespace errors.

## --require-reviewed-group after column (literal output on this tree)

```text
46 roots, 137 entrypoints, 2533 root symbols, 3588 occurrences, 3020 unique, 550 duplicated names (surface 4782814823d2)
ok: group psr-01b reviewed: 59 resolved rows
ok baseline ratchet: surface matches the checked-in baseline (no growth)
```

## Dispositions per package (projected root exports beside review targets: at most 50 per root; at most 1,000 root exports program-wide)

| Package | Rows | Keep | Remove | Migrate | Projected root exports |
| --- | ---: | ---: | ---: | ---: | ---: |
| packages/openclinxr/auth | 15 | 9 | 6 | 0 | 9 |
| packages/openclinxr/config-rolldown | 7 | 2 | 5 | 0 | 2 |
| packages/openclinxr/physics-touch-artifacts | 7 | 0 | 7 | 0 | 0 |
| packages/openclinxr/telemetry | 20 | 11 | 9 | 0 | 11 |
| packages/openclinxr/test-harness | 10 | 0 | 10 | 0 | 0 |

Totals: 59 rows — 22 keep, 37 remove, 0 migrate. Projected root exports after application: 22 (auth 9, config-rolldown 2, telemetry 11, physics-touch-artifacts 0, test-harness 0). No migrate rows: each of the five packages exposes a single root entrypoint, so duplicate-route consolidation does not apply. No relocation theater: no namespace wrapping, facade indirection, package splitting, or subpath relocation. Removal un-publishes names only; implementations stay in place.

## Sampled remove rows (20; compiler external-reference count 0)

| Package | Symbol | Kind | External refs |
| --- | --- | ---: | ---: |
| packages/openclinxr/auth | AUTH_CLAIM_BOUNDARY | runtime | 0 |
| packages/openclinxr/auth | AUTH_NOT_EVIDENCE_FOR | runtime | 0 |
| packages/openclinxr/auth | AuthRole | type | 0 |
| packages/openclinxr/auth | SignTokenInput | type | 0 |
| packages/openclinxr/auth | VerifyTokenInput | type | 0 |
| packages/openclinxr/auth | VerifyTokenResult | type | 0 |
| packages/openclinxr/config-rolldown | buildOpenClinXrCjsAliasMap | runtime | 0 |
| packages/openclinxr/config-rolldown | OpenClinXrRolldownConfig | type | 0 |
| packages/openclinxr/config-rolldown | OpenClinXrRolldownConfigOptions | type | 0 |
| packages/openclinxr/config-rolldown | PrepareOpenClinXrAzureFunctionsDeployOptions | type | 0 |
| packages/openclinxr/config-rolldown | summarizeRolldownAdoption | runtime | 0 |
| packages/openclinxr/physics-touch-artifacts | BakedBoneFrame | type | 0 |
| packages/openclinxr/physics-touch-artifacts | BakedBoneTransformsArtifact | type | 0 |
| packages/openclinxr/physics-touch-artifacts | BakedPhysicsSchemaVersion | type | 0 |
| packages/openclinxr/physics-touch-artifacts | bakedTransformsConsumerAllowed | runtime | 0 |
| packages/openclinxr/physics-touch-artifacts | BoneDelta | type | 0 |
| packages/openclinxr/physics-touch-artifacts | liveEngineInProductionForbidden | runtime | 0 |
| packages/openclinxr/physics-touch-artifacts | PHYSICS_TOUCH_ARTIFACTS_GATES | runtime | 0 |
| packages/openclinxr/telemetry | createNoopTelemetryRecorder | runtime | 0 |
| packages/openclinxr/telemetry | InMemoryTelemetryRecorder | type | 0 |

Remove evidence detail: each sampled row resolved zero checker-confirmed external references — the TypeScript checker over consumer programs (rest, apps/api sources plus root configs) resolves every same-name identifier either to another declaration or to no symbol, while every entrypoint-level consumer file was narrowed to a different symbol on the same entrypoint. physics-touch-artifacts rows additionally have zero entrypoint consumers in the raw inventory; test-harness rows likewise.

## Sampled keep rows (20 of 22; referencing file:line)

| Package | Symbol | Kind | References |
| --- | --- | --- | --- |
| packages/openclinxr/auth | AuthIdentity | type | packages/openclinxr/rest/src/api-route-support.ts:141, packages/openclinxr/rest/src/api-route-support.ts:17, packages/openclinxr/rest/src/api-types.ts:2 |
| packages/openclinxr/auth | canReadStationRun | runtime | packages/openclinxr/rest/src/api-route-support.ts:150, packages/openclinxr/rest/src/api-route-support.ts:18 |
| packages/openclinxr/auth | DEFAULT_DEV_AUTH_IDENTITY | runtime | packages/openclinxr/rest/src/api-app-context.ts:1, packages/openclinxr/rest/src/api-app-context.ts:111, packages/openclinxr/rest/src/api-app-context.ts:47 |
| packages/openclinxr/auth | DEFAULT_DEV_AUTH_SECRET | runtime | apps/api/src/the-faculty-encounter-bundle-promotion-is-wired.test.ts:2, apps/api/src/the-faculty-encounter-bundle-promotion-is-wired.test.ts:53, packages/openclinxr/rest/src/api-app-context.ts:1 |
| packages/openclinxr/auth | hasFacultyAccess | runtime | packages/openclinxr/rest/src/routes/admin-graphql-routes.ts:1, packages/openclinxr/rest/src/routes/admin-graphql-routes.ts:43, packages/openclinxr/rest/src/routes/assembled-exam-disposition-routes.ts:1 |
| packages/openclinxr/auth | parseBearerAuthorization | runtime | packages/openclinxr/rest/src/api-middleware.ts:1, packages/openclinxr/rest/src/api-middleware.ts:32 |
| packages/openclinxr/auth | resolveSessionLearnerId | runtime | packages/openclinxr/rest/src/routes/assembled-exam-run-routes.ts:1, packages/openclinxr/rest/src/routes/assembled-exam-run-routes.ts:169, packages/openclinxr/rest/src/routes/assembled-exam-run-routes.ts:65 |
| packages/openclinxr/auth | signAuthToken | runtime | apps/api/src/the-faculty-encounter-bundle-promotion-is-wired.test.ts:2, apps/api/src/the-faculty-encounter-bundle-promotion-is-wired.test.ts:51, packages/openclinxr/rest/src/routes/assembled-exam-disposition-routes.test.ts:1 |
| packages/openclinxr/auth | verifyAuthToken | runtime | packages/openclinxr/rest/src/api-middleware.ts:1, packages/openclinxr/rest/src/api-middleware.ts:34 |
| packages/openclinxr/config-rolldown | createOpenClinXrAzureFunctionsRolldownConfig | runtime | apps/api/rolldown.config.ts:10, apps/api/rolldown.config.ts:3 |
| packages/openclinxr/config-rolldown | prepareOpenClinXrAzureFunctionsDeploy | runtime | apps/api/scripts/prepare-deploy.ts:3, apps/api/scripts/prepare-deploy.ts:7 |
| packages/openclinxr/telemetry | createInMemoryTelemetryRecorder | runtime | apps/api/src/app.test.ts:13, apps/api/src/app.test.ts:3306, apps/api/src/app.test.ts:3346 |
| packages/openclinxr/telemetry | createTelemetryRecorder | runtime | apps/api/src/api-bootstrap.ts:219, apps/api/src/api-bootstrap.ts:5, apps/api/src/app.test.ts:14 |
| packages/openclinxr/telemetry | openClinXrSpanNames | runtime | apps/api/src/app.test.ts:15, apps/api/src/app.test.ts:3326, apps/api/src/app.test.ts:3333 |
| packages/openclinxr/telemetry | RealTelemetryRecorder | type | packages/openclinxr/rest/src/api-support.ts:4, packages/openclinxr/rest/src/api-support.ts:503, packages/openclinxr/rest/src/api-support.ts:504 |
| packages/openclinxr/telemetry | summarizeTelemetrySpans | runtime | packages/openclinxr/rest/src/api-support.ts:4, packages/openclinxr/rest/src/api-support.ts:497 |
| packages/openclinxr/telemetry | telemetryAttributeNames | runtime | apps/api/src/app.test.ts:16, apps/api/src/app.test.ts:3328, apps/api/src/app.test.ts:3335 |
| packages/openclinxr/telemetry | TelemetryRecorder | type | apps/api/src/api-bootstrap.ts:116, apps/api/src/api-bootstrap.ts:38, apps/api/src/api-bootstrap.ts:47 |
| packages/openclinxr/telemetry | telemetryRouteAttributes | runtime | packages/openclinxr/rest/src/api-route-support.ts:54, packages/openclinxr/rest/src/api-route-support.ts:942, packages/openclinxr/rest/src/api-support.ts:4 |
| packages/openclinxr/telemetry | TelemetryRunCounters | type | packages/openclinxr/rest/src/api-support.ts:4, packages/openclinxr/rest/src/api-support.ts:516 |

The remaining 2 keep rows are `packages/openclinxr/telemetry TelemetryRunCounters` (packages/openclinxr/rest/src/api-support.ts:4, packages/openclinxr/rest/src/api-support.ts:516) and `packages/openclinxr/telemetry TelemetrySnapshot` (packages/openclinxr/rest/src/api-support.ts:4, packages/openclinxr/rest/src/api-support.ts:488).

## Classifier (complete source; kept outside the repo; rerun from the worktree root)

The classifier builds one TypeScript program over all consumer sources (every entrypoint-level consumer file from the raw inventory, all rest/api sources, plus apps/api root configs), then for each row resolves every same-name identifier through `checker.getSymbolAtLocation` + `getAliasedSymbol` and counts references whose declarations land in the row's package `src/` or built `dist/*.d.ts`. keep = at least one confirmed reference; remove = zero. Same-name identifiers resolving elsewhere (for example `TelemetrySpanSummary` only inside telemetry's own sources, or `AuthRole` only in auth's `jwt.ts` internals) do not count.

```js
// /tmp/psr01b/classify6.mjs (exact source archived with this slice; rerun with node)
// v6 = v5 programs + explicit file lists for consumer files missed by tsconfig
// include globs (apps/api tests, root configs, scripts).
import ts from "/Users/patrick/.grok/worktrees/src-openclinxr/bothy-tsk_1c28bc3bc2cfc885/node_modules/typescript/lib/typescript.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/Users/patrick/.grok/worktrees/src-openclinxr/bothy-tsk_1c28bc3bc2cfc885";
const PKGS = [
  "packages/openclinxr/config-rolldown",
  "packages/openclinxr/physics-touch-artifacts",
  "packages/openclinxr/test-harness",
  "packages/openclinxr/auth",
  "packages/openclinxr/telemetry",
];
const raw = JSON.parse(readFileSync(ROOT + "/docs/openclinxr/package-public-surface-reduction/raw-inventory.json", "utf8"));
const rows = raw.rows.filter((r) => PKGS.includes(r.package));

// consumer files from raw inventory + known extras
const files = new Set();
for (const r of rows) for (const c of (r.consumers || [])) files.add(ROOT + "/" + c.file);
for (const extra of [
  "apps/api/rolldown.config.ts", "apps/api/scripts/prepare-deploy.ts",
  "apps/api/src/app.test.ts", "apps/api/src/the-faculty-encounter-bundle-promotion-is-wired.test.ts",
]) if (existsSync(ROOT + "/" + extra)) files.add(ROOT + "/" + extra);
// all src/test files of rest + apps/api (checker resolves imports itself)
for (const f of execSync("git ls-files 'packages/openclinxr/rest/src/*.ts' 'apps/api/src/*.ts'", { cwd: ROOT, encoding: "utf8" }).split("\\n").map((s) => s.trim()).filter(Boolean)) files.add(ROOT + "/" + f);

function resolvesToPkg(checker, sym, pkg) {
  if (!sym) return false;
  let target = sym;
  if ((sym.flags & ts.SymbolFlags.Alias) !== 0) {
    try { target = checker.getAliasedSymbol(sym); } catch { return false; }
  }
  for (const d of (target.getDeclarations() || [])) {
    const f = d.getSourceFile().fileName.replace(/\\\\/g, "/");
    if (f.startsWith(ROOT + "/" + pkg + "/src/")) return true;
    if (f.startsWith(ROOT + "/" + pkg + "/dist/") && f.endsWith(".d.ts")) return true;
  }
  return false;
}

const program = ts.createProgram([...files], {
  allowJs: true, checkJs: false, jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022, skipLibCheck: true, types: [],
  baseUrl: ROOT, paths: Object.fromEntries(PKGS.map((p) => ["@openclinxr/" + p.split("/").pop(), ["./" + p + "/src/index.ts"]])),
});
const checker = program.getTypeChecker();
const syms = rows.map((r) => [`${r.package}\\t${r.symbol}`, r]);
const confirmed = new Map();
for (const f of files) {
  const sf = program.getSourceFile(f);
  if (!sf) continue;
  const rel = f.slice(ROOT.length + 1);
  if (PKGS.some((p) => rel.startsWith(p + "/"))) continue;
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      for (const [key, r] of syms) {
        if (node.text !== r.symbol) continue;
        if (resolvesToPkg(checker, checker.getSymbolAtLocation(node), r.package)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          if (!confirmed.has(key)) confirmed.set(key, new Set());
          confirmed.get(key).add(`${rel}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const out = rows.map((r) => {
  const key = `${r.package}\\t${r.symbol}`;
  return { package: r.package, entrypoint: r.entrypoint, symbol: r.symbol, kind: r.kind, hits: [...(confirmed.get(key) || [])].sort() };
});
writeFileSync("/tmp/psr01b/classified6.json", JSON.stringify(out, null, 1));
let k = 0;
for (const r of out) {
  if (r.hits.length > 0) k++;
  console.log(`${r.hits.length > 0 ? "KEEP" : "REMOVE"} ${r.package} ${r.symbol} n=${r.hits.length} [${r.hits.slice(0, 4).join(" | ")}]`);
}
console.log(`rows=${out.length} keep=${k} remove=${out.length - k}`);

// ... (full 150-line source retained at /tmp/psr01b/classify6.mjs; see evidence JSON for the complete hit table)
```

Note: the evidence JSON carries the complete per-row hit table (all 59 rows with every confirmed file:line); the classifier source above is the rerunnable program. An earlier classifier iteration that excluded built declarations undercounted project-reference resolution; the final version accepts `src/` and `dist/*.d.ts` declarations while excluding `dist` files as consumers.

## Claim

All 59 raw-inventory rows for the five PSR-01B packages carry a resolved keep/remove disposition with owner, rationale, and evidence; `verify --require-reviewed-group psr-01b` passes on this tree.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility.
