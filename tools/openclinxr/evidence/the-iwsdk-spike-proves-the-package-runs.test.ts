import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the IWSDK spike's evidence depends on the package EXISTING, not on the string
 * `import("@iwsdk/core")` appearing in a source file.
 *
 * MEASURED 2026-08-24, do not re-derive.
 *
 *   require.resolve("@iwsdk/core")              -> MODULE_NOT_FOUND
 *   declared                                     -> apps/arena/ui-xr-iwsdk-spike/package.json:15 "0.5.3"
 *   registry latest @iwsdk/core                  -> 0.5.3   (the pin is CURRENT; that is not the defect)
 *   apps/ui-xr (learner runtime) @iwsdk refs     -> 0
 *   tools/openclinxr/dark-factory @iwsdk refs    -> 0
 *   DARK_FACTORY_CHAIN_STATIONS                  -> 9 stations, none is iwsdk
 *
 * HOW AN UNINSTALLED DEPENDENCY STAYED GREEN — the spike's tests assert on SOURCE TEXT:
 *
 *   sidecar-state.test.ts:282  expect(source).toContain('import("@iwsdk/core")');
 *   sidecar-state.test.ts:283  expect(source).toContain('import("@iwsdk/xr-input")');
 *   readFileSync calls: sidecar-state 15, uikitml-spatial-text 5
 *
 * Those pass whether or not the package exists. It does not exist. This is the marker-check pattern
 * this repo has withdrawn repeatedly — a name match standing in for substance — living inside the
 * evidence for a capability nobody can run.
 *
 * WHY THIS BEFORE ANY IWSDK STATION: a factory station built on a dependency that does not resolve is
 * a station that cannot run. rhubarb was the counter-example — installed, and I proved it end to end
 * before planting #608. I can make no equivalent claim here: I have never seen an IWSDK code path
 * execute.
 *
 * KNOWN-GOOD COLUMN: `three`, which the same spike imports and which DOES resolve. Clause (3) pins it,
 * so the resolver used here is proven to succeed on a package that is genuinely installed — a failing
 * resolver would otherwise make clause (1) pass for the wrong reason.
 *
 * COUNTERWEIGHT: the cheap fix is to delete the spike or drop the dependency and call the red gone.
 * Clause (4) requires the declaration to survive: this slice must be resolved by making the package
 * REAL, or by an explicit recorded decision — never by quietly removing the evidence.
 *
 * claimScope: whether @iwsdk/core resolves, and whether the spike's evidence depends on that.
 * notEvidenceFor: whether IWSDK is the right technology; whether any 0.5.3 feature works on this
 * machine; Quest behaviour; anything about the learner runtime, which imports none of it.
 *
 * ## FIXED (#615)
 *
 * The headline held; the MECHANISM above did not. Measured 2026-08-23, worktree issue-615:
 *
 * | surface                        | planted instrument            | what measurement found                                                             |
 * | ------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
 * | @iwsdk/core resolution         | root-anchored CJS req.resolve | ERR_PACKAGE_PATH_NOT_EXPORTED — NOT MODULE_NOT_FOUND                                |
 * | why                            | —                             | 0.5.3 ships an ESM-only `exports` map (types+import, no require/default): CJS        |
 * |                                |                               | resolution is structurally impossible for this specifier, anywhere                  |
 * | spike-context dynamic import() | never probed                  | WORKS — 683 exports, VERSION "0.5.3", 370 callables (apps/arena/ui-xr-iwsdk-spike)  |
 * | @iwsdk/xr-input                | same CJS instrument           | CJS-resolves from the spike context AND imports — 33 exports                        |
 * | repo-root node_modules/@iwsdk  | assumed present               | ABSENT — pnpm links the packages into the spike's own node_modules                  |
 *
 * So the packages are installed, current, and EXECUTE in Node from the spike directory — the context
 * Vite uses for main.ts:409-410 and src/uikitml-spatial-text.ts:115. The spike's consumption was real;
 * the evidence that it runs was not, because every prior instrument asserted on source text or used a
 * CJS resolver that cannot see ESM-only packages. Clauses (1)/(2) flip RED -> GREEN on a behavioral
 * probe (scripts/probe-iwsdk.mjs: dynamic import() per specifier, child process, cwd = spike root);
 * clause (2) additionally pins VERSION to the declared pin. Clause (5) is a new NET holding the
 * runtime trio at 0.5.3 and vite-plugin-dev at 0.5.1 — the cheap pass here would have been bumping or
 * dropping declarations, and the-iwsdk-sidecar-runs-the-current-release.test.ts independently pins the
 * same trio.
 */

const req = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../..", ".."); // evidence -> openclinxr -> tools -> root
const SPIKE_ROOT = join(REPO_ROOT, "apps/arena/ui-xr-iwsdk-spike");

/** Declared at apps/arena/ui-xr-iwsdk-spike/package.json:15. */
const IWSDK_PACKAGES = ["@iwsdk/core", "@iwsdk/xr-input"] as const;

type ProbeRow = {
  cjsResolve?: string;
  cjsResolveError?: string;
  imported?: boolean;
  moduleKind?: string;
  exportCount?: number;
  functionExportCount?: number;
  version?: string;
  importError?: string;
};
type ProbeReport = { cwd: string; results: Record<string, ProbeRow> };

/** Runs scripts/probe-iwsdk.mjs in the spike root and returns its parsed report. */
function runSpikeContextProbe(): ProbeReport {
  const outPath = join(mkdtempSync(join(tmpdir(), "openclinxr-iwsdk-probe-")), "probe.json");
  try {
    execFileSync(process.execPath, [join(SPIKE_ROOT, "scripts/probe-iwsdk.mjs"), outPath], {
      cwd: SPIKE_ROOT,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(readFileSync(outPath, "utf8")) as ProbeReport;
  } finally {
    rmSync(dirname(outPath), { recursive: true, force: true });
  }
}

describe("the iwsdk spike proves the package runs", () => {
  it("(1) every declared @iwsdk package EXECUTES in the spike's own module context", () => {
    // Resolution alone was never the bar: the spike consumes these through dynamic import(),
    // so the probe imports each one the way Vite/main.ts does — from the spike root.
    const report = runSpikeContextProbe();
    expect(report.cwd, "the probe must run from the spike root, where pnpm links the packages").toBe(
      SPIKE_ROOT,
    );
    for (const p of IWSDK_PACKAGES) {
      const row = report.results[p];
      expect(row, `${p} must appear in the probe report`).toBeDefined();
      expect(row.imported, `${p} must import from the spike context (${row?.importError ?? ""})`).toBe(true);
      expect(row.exportCount ?? 0, `${p} must expose at least one export`).toBeGreaterThan(0);
    }
  });

  it("(2) @iwsdk/core exposes a callable surface and its runtime VERSION equals the declared pin", () => {
    // Execution, not presence. A resolved-but-broken install fails here; a stale install fails
    // the VERSION check without any snapshot machinery.
    const report = runSpikeContextProbe();
    const row = report.results["@iwsdk/core"];
    expect(row?.functionExportCount ?? 0, "@iwsdk/core must expose callable exports").toBeGreaterThan(0);
    expect(row?.version, "@iwsdk/core runtime VERSION must equal the declared pin").toBe("0.5.3");
  });

  it("(3) KNOWN-GOOD COLUMN: the resolver succeeds on a package that IS installed", () => {
    // Pins the instrument. `three` is dual-format, so the CJS resolver reaches it from this
    // directory — proving clause failures were never a broken resolver. @iwsdk/core has no CJS
    // entry point at all (FIXED table above), which is why clauses (1)/(2) measure import()
    // instead of require().
    expect(req.resolve("three"), "the CJS resolver must work on a dual-format package").toContain(
      "/node_modules/",
    );
    const report = runSpikeContextProbe();
    expect(report.results.three?.imported, "`three` must also import in the probe context").toBe(true);
  });

  it("(4) COUNTERWEIGHT: the declaration is not deleted to clear the red", () => {
    // Refuses the cheap fix. Removing @iwsdk from package.json, or deleting the spike, would make
    // clauses (1) and (2) vacuous rather than satisfied. The dependency must still be DECLARED —
    // resolve it by installing, or by a recorded decision to drop the technology, not by erasing
    // the evidence that it was ever intended.
    const pkg = JSON.parse(readFileSync(join(SPIKE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(all["@iwsdk/core"], "the spike must still DECLARE @iwsdk/core — do not clear the red by deleting it")
      .toBeDefined();
  });

  it("(5) NET: the runtime trio stays pinned at 0.5.3 and the vite plugin behind its peer conflict", () => {
    // Refuses the other cheap passes: bumping pins to look current, or dropping/re-adding
    // declarations to churn the lockfile. Mirrors the-iwsdk-sidecar-runs-the-current-release.test.ts
    // so this file alone cannot drift the spike's dependency posture.
    const pkg = JSON.parse(readFileSync(join(SPIKE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(all["@iwsdk/core"], "@iwsdk/core stays at the current release").toBe("0.5.3");
    expect(all["@iwsdk/xr-input"], "@iwsdk/xr-input stays at the current release").toBe("0.5.3");
    expect(all["@iwsdk/vite-plugin-dev"], "vite-plugin-dev stays pinned until its vite peer accepts 8.x").toBe(
      "0.5.1",
    );
  });
});
