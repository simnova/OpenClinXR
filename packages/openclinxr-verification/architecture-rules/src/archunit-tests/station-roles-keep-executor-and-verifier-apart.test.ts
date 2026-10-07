import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkStationRoleBoundaries,
  parseStationManifest,
  scanWorkspaceStationRoles,
  specifiersInSource,
  type StationPackage,
} from "../checks/station-role-boundaries.js";

/**
 * Station roles keep executor and verifier apart (MADR 0060 decisions 4-5, Phase 0).
 *
 * No package declares a station role today, so the rule is enforced against
 * committed fixtures now and against real packages once Phase 1 creates them.
 * Fixture manifests are manifest.json (not package.json) so no workspace tool
 * or architecture gate mistakes them for real packages; the loader below reads
 * them with the same parser the workspace scan uses on package.json.
 */

const FIXTURE_ROOT = join(import.meta.dirname, "fixtures", "station-roles");
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function sourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    // Fixtures are text (.ts.txt): read as text, never compiled, invisible to knip.
    if (/\.ts\.txt$/.test(entry.name)) out.push(full);
  }
}

/** Builds rule input from one fixture root, exactly as the workspace scan builds it. */
function loadFixtureRoot(rootName: string): StationPackage[] {
  const root = join(FIXTURE_ROOT, rootName);
  const pkgs: StationPackage[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifestText = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as {
      name?: string;
      exports?: Record<string, unknown>;
      dependencies?: Record<string, string>;
    };
    const { station, stationRole, stationRegistry } = parseStationManifest(manifestText);
    const files: string[] = [];
    if (existsSync(join(dir, "src"))) sourceFiles(join(dir, "src"), files);
    pkgs.push({
      name: typeof manifest.name === "string" ? manifest.name : entry.name,
      dir: toPosixPath(relative(REPO_ROOT, dir)),
      ...(station === undefined ? {} : { station }),
      ...(stationRole === undefined ? {} : { stationRole }),
      ...(stationRegistry === undefined ? {} : { stationRegistry }),
      dependencies: Object.keys(manifest.dependencies ?? {}).sort(),
      sources: files.sort().map((file) => ({
        file: toPosixPath(relative(REPO_ROOT, file)),
        specifiers: specifiersInSource(readFileSync(file, "utf8")),
      })),
      exportSubpaths: Object.keys(manifest.exports ?? {}),
    });
  }
  return pkgs.sort((a, b) => a.name.localeCompare(b.name));
}

function clone(packages: StationPackage[]): StationPackage[] {
  return JSON.parse(JSON.stringify(packages)) as StationPackage[];
}

function mustFind(packages: StationPackage[], fragment: string): StationPackage {
  for (const pkg of packages) {
    if (pkg.name.includes(fragment)) return pkg;
  }
  throw new Error(`fixture package containing "${fragment}" not found`);
}

describe("station roles keep executor and verifier apart", () => {
  it("(1) the honest layout passes: executor and verifier share only the objective; the registry alone reaches the solver", () => {
    const pkgs = loadFixtureRoot("honest");
    const roles = pkgs
      .map((pkg) => pkg.stationRole)
      .filter((role) => role !== undefined)
      .sort();
    expect(roles).toEqual(["executor", "objective", "solver", "verifier"]);
    const registries = pkgs.filter(
      (pkg) => pkg.station !== undefined && pkg.stationRegistry === true,
    );
    expect(registries.map((pkg) => pkg.name)).toEqual([
      "@station-roles-fixture/staging-registry",
    ]);
    expect(checkStationRoleBoundaries(pkgs)).toEqual([]);
  });

  it("(2) R1: an executor importing its verifier fails naming R1", () => {
    const violations = checkStationRoleBoundaries(loadFixtureRoot("fail-r1"));
    expect(violations).toHaveLength(2);
    for (const violation of violations) expect(violation).toContain("[station-roles R1]");
  });

  it("(3) R2: a private module reached by bare deep import and by relative escape fails naming R2", () => {
    const violations = checkStationRoleBoundaries(loadFixtureRoot("fail-r2"));
    expect(violations).toHaveLength(2);
    for (const violation of violations) expect(violation).toContain("[station-roles R2]");
  });

  it("(4) R3: a solver importing its executor fails naming R3", () => {
    const violations = checkStationRoleBoundaries(loadFixtureRoot("fail-r3"));
    expect(violations).toHaveLength(2);
    for (const violation of violations) expect(violation).toContain("[station-roles R3]");
  });

  it("(5) R4: the objective importing a solver fails naming R4", () => {
    const violations = checkStationRoleBoundaries(loadFixtureRoot("fail-r4"));
    expect(violations).toHaveLength(2);
    for (const violation of violations) expect(violation).toContain("[station-roles R4]");
  });

  it("(6) R5: an unknown stationRole fails naming R5", () => {
    const violations = checkStationRoleBoundaries(loadFixtureRoot("fail-r5"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("[station-roles R5]");
  });

  it("(7) DESTRUCTIVE-PROBE REPAIRS: each failing fixture passes in its honest form", () => {
    const r1 = clone(loadFixtureRoot("fail-r1"));
    (mustFind(r1, "r1-verifier") as { stationRole?: string }).stationRole = "objective";
    expect(checkStationRoleBoundaries(r1)).toEqual([]);

    const r2 = clone(loadFixtureRoot("fail-r2"));
    const r2Executor = mustFind(r2, "r2-executor");
    (r2Executor as { sources: StationPackage["sources"] }).sources = r2Executor.sources.map(
      (source) => ({
        file: source.file,
        specifiers: ["@station-roles-fixture/r2-objective"],
      }),
    );
    expect(checkStationRoleBoundaries(r2)).toEqual([]);

    const r3 = clone(loadFixtureRoot("fail-r3"));
    (mustFind(r3, "r3-executor") as { stationRole?: string }).stationRole = "objective";
    expect(checkStationRoleBoundaries(r3)).toEqual([]);

    const r4 = clone(loadFixtureRoot("fail-r4"));
    (mustFind(r4, "r4-solver") as { stationRole?: string }).stationRole = "objective";
    expect(checkStationRoleBoundaries(r4)).toEqual([]);

    const r5 = clone(loadFixtureRoot("fail-r5"));
    (mustFind(r5, "r5-odd") as { stationRole?: string }).stationRole = "solver";
    expect(checkStationRoleBoundaries(r5)).toEqual([]);
  });

  it("(9) the scanner sees nested stations/<x> packages (MADR 0060 layout)", () => {
    const scanned = scanWorkspaceStationRoles(
      join(FIXTURE_ROOT, "nested-repo"),
      "manifest.json",
      /\.ts\.txt$/,
    );
    expect(scanned.map((pkg) => pkg.name).sort()).toEqual([
      "@station-roles-fixture/nested-executor",
      "@station-roles-fixture/nested-verifier",
    ]);
    const violations = checkStationRoleBoundaries(scanned);
    expect(violations).toHaveLength(2);
    for (const violation of violations) expect(violation).toContain("[station-roles R1]");
  });

  it("(8) the live workspace matches the committed station roster", () => {
    const rosterPath = join(import.meta.dirname, "fixtures", "station-roster.json");
    const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as Array<{
      name: string;
      station: string;
      stationRole: string;
    }>;
    const scanned = scanWorkspaceStationRoles();
    expect(scanned.length).toBeGreaterThan(20);
    const declared = scanned
      .filter((pkg) => pkg.stationRole !== undefined)
      .map((pkg) => ({ name: pkg.name, station: pkg.station, stationRole: pkg.stationRole }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const expected = [...roster].sort((a, b) => a.name.localeCompare(b.name));
    // Each role-declaring card appends its own row; the first stationRole
    // turns this red until its row lands in the committed roster.
    expect(declared).toEqual(expected);
    const violations = checkStationRoleBoundaries(scanned);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
