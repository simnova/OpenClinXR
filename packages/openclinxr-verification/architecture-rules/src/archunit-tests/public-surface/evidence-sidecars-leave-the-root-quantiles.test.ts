import { describe, expect, it } from "vitest";
import { isEvidenceSidecar, rootQuantiles } from "../../checks/public-surface/acceptance-criteria.js";
import type { EntrypointSurface, PackageSurface, SurfaceReport } from "../../checks/public-surface/resolve.js";
import { measureSurface, workspaceRoot } from "../../checks/public-surface/resolve.js";

/**
 * A `*-evidence` sidecar is a private test-only package: it moves root tools/ tests into a
 * turbo-cached package task and publishes nothing. Counting its zero in the criterion-6
 * root-symbol median/p90 lowers both with every sidecar added (17 -> 16 median for one
 * sidecar on 2026-10-30), so each sidecar would force a re-review of exceptions that pin
 * exact measured values. Sidecars that publish nothing leave the quantile population.
 *
 * claimScope: which packages enter the median/p90/maxRoot sample.
 * notEvidenceFor: root, entrypoint or rootSymbols totals; those still count every package.
 */

function entry(
  packageDir: string,
  specifier: string,
  symbols: string[],
  wildcards = 0,
  typeWildcards = 0,
): EntrypointSurface {
  return {
    packageDir,
    name: `@x/${packageDir.split("/").pop()}`,
    specifier,
    source: `${packageDir}/src/index.ts`,
    symbols: symbols.map((s) => ({ name: s, kind: "runtime" as const })),
    wildcardDeclarations: wildcards,
    typeWildcardDeclarations: typeWildcards,
  };
}

function pkg(
  packageDir: string,
  entrypoints: EntrypointSurface[],
  name = `@x/${packageDir.split("/").pop()}`,
): PackageSurface {
  const root = entrypoints.find((e) => e.specifier === ".");
  return {
    packageDir,
    name,
    entrypoints,
    rootSymbols: root?.symbols.length ?? 0,
    occurrences: entrypoints.reduce((n, e) => n + e.symbols.length, 0),
    uniqueSymbols: 0,
    duplicateNames: [],
    builtResolution: [],
  };
}

function report(packages: PackageSurface[]): SurfaceReport {
  return {
    packages,
    totals: { roots: packages.length, entrypoints: 0, rootSymbols: 0, occurrences: 0, uniqueSymbols: 0, duplicateNames: 0 },
  };
}

const syms = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}`);
const BASE = [10, 20, 30].map((n, i) => pkg(`packages/p${i}`, [entry(`packages/p${i}`, ".", syms(n))]));

describe("evidence sidecars leave the root quantiles", () => {
  it("(1) a *-evidence package that publishes nothing does not move the median", () => {
    const sidecar = pkg("packages/stations/foo-evidence", [entry("packages/stations/foo-evidence", ".", [])]);
    expect(isEvidenceSidecar(sidecar)).toBe(true);
    expect(rootQuantiles(report([...BASE, sidecar]))).toEqual(rootQuantiles(report(BASE)));
  });

  it("(2) COUNTERWEIGHT: a *-evidence package publishing a real root symbol is counted", () => {
    const publishing = pkg("packages/foo-evidence", [entry("packages/foo-evidence", ".", syms(1))]);
    expect(isEvidenceSidecar(publishing)).toBe(false);
    expect(rootQuantiles(report([...BASE, publishing])).median).toBe(15);
  });

  it("(3) COUNTERWEIGHT: a *-evidence package publishing only on a subpath is counted", () => {
    const subpath = pkg("packages/foo-evidence", [
      entry("packages/foo-evidence", ".", []),
      entry("packages/foo-evidence", "./read", syms(2)),
    ]);
    expect(isEvidenceSidecar(subpath)).toBe(false);
    expect(rootQuantiles(report([...BASE, subpath])).median).toBe(15);
  });

  it("(4) COUNTERWEIGHT: a *-evidence package with a wildcard export is counted", () => {
    const wildcard = pkg("packages/foo-evidence", [entry("packages/foo-evidence", ".", [], 1)]);
    expect(isEvidenceSidecar(wildcard)).toBe(false);
  });

  it("(5) COUNTERWEIGHT: a zero-symbol package not named *-evidence is counted", () => {
    const core = pkg("packages/factory-station-core", [entry("packages/factory-station-core", ".", [])]);
    expect(isEvidenceSidecar(core)).toBe(false);
    expect(rootQuantiles(report([...BASE, core])).median).toBe(15);
  });

  it("(7) COUNTERWEIGHT: a *-evidence package with a type wildcard export is counted", () => {
    const typeWildcard = pkg("packages/foo-evidence", [entry("packages/foo-evidence", ".", [], 0, 1)]);
    expect(isEvidenceSidecar(typeWildcard)).toBe(false);
  });

  it("(8) the rule reads the directory, not the package name", () => {
    const nameOnly = pkg("packages/foo", [entry("packages/foo", ".", [])], "@x/foo-evidence");
    const dirOnly = pkg("packages/foo-evidence", [entry("packages/foo-evidence", ".", [])], "@x/foo");
    expect(isEvidenceSidecar(nameOnly)).toBe(false);
    expect(isEvidenceSidecar(dirOnly)).toBe(true);
  });

  it("(9) COUNTERWEIGHT: -evidence must end the directory name", () => {
    const kit = pkg("packages/foo-evidence-kit", [entry("packages/foo-evidence-kit", ".", [])]);
    expect(isEvidenceSidecar(kit)).toBe(false);
  });

  it("(6) live tree: mouth-verifier-evidence is excluded, xr-capture-evidence (publishes) is kept", () => {
    const live = measureSurface(workspaceRoot());
    const byDir = new Map(live.packages.map((p) => [p.packageDir, p]));
    const mouth = byDir.get("packages/openclinxr/stations/mouth-verifier-evidence");
    const capture = byDir.get("packages/openclinxr/xr-capture-evidence");
    expect(mouth).toBeDefined();
    expect(capture).toBeDefined();
    expect(isEvidenceSidecar(mouth as PackageSurface)).toBe(true);
    expect(isEvidenceSidecar(capture as PackageSurface)).toBe(false);
  });
});
