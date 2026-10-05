import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Station role boundary (MADR 0060 decisions 4-5, Phase 0 dependency control).
 *
 * WHY: the staging solver pilot splits one station across sibling packages — an
 * executor that runs, a solver that searches, an objective that scores, and a
 * verifier that measures. Without a boundary the solver's tuning knobs leak into
 * the authoring surface and the executor starts importing its own verifier,
 * which is exactly the drift MADR 0060 decisions 4-5 forbid.
 *
 * A package declares its role in package.json:
 * `"openclinxr": { "station": "<stationId>", "stationRole": "executor" }`.
 * No package declares a role today, so this rule holds againstFixtures now and
 * against real packages once Phase 1 creates them.
 *
 * R1 an executor may not depend on or import a verifier.
 * R2 no package may import a station package's private module: a relative
 *    import escaping into another station package's src/, or a bare deep
 *    specifier absent from its package.json exports, fails. Its declared
 *    exports pass.
 * R3 a solver may not import or depend on an executor.
 * R4 an objective may not import or depend on an executor, verifier or solver.
 * R5 an unknown stationRole value fails. The vocabulary is closed.
 */

export const STATION_ROLES = ["executor", "verifier", "objective", "solver"] as const;

export type StationRole = (typeof STATION_ROLES)[number];

export type StationSourceFile = {
  /** Repo-relative posix path of the importing file. */
  readonly file: string;
  /** Static plus literal-dynamic specifiers in source order. */
  readonly specifiers: readonly string[];
};

export type StationPackage = {
  readonly name: string;
  /** Repo-relative posix directory of the package. */
  readonly dir: string;
  readonly station?: string;
  /** Raw declared value, so unknown values can be reported rather than dropped. */
  readonly stationRole?: string;
  /** Bare dependency names from every package.json dependency field. */
  readonly dependencies: readonly string[];
  readonly sources: readonly StationSourceFile[];
  /** Declared package.json exports keys, e.g. [".", "./scoring"]. */
  readonly exportSubpaths: readonly string[];
};

export function isStationRole(value: string): value is StationRole {
  return (STATION_ROLES as readonly string[]).includes(value);
}

function roleOf(pkg: StationPackage): StationRole | undefined {
  return pkg.stationRole !== undefined && isStationRole(pkg.stationRole)
    ? pkg.stationRole
    : undefined;
}

/** Reads the `openclinxr.station` / `openclinxr.stationRole` declaration, if any. */
export function parseStationManifest(manifestText: string): {
  station?: string;
  stationRole?: string;
} {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText) as unknown;
  } catch {
    return {};
  }
  if (manifest === null || typeof manifest !== "object") return {};
  const openclinxr = (manifest as Record<string, unknown>)["openclinxr"];
  if (openclinxr === null || typeof openclinxr !== "object") return {};
  const record = openclinxr as Record<string, unknown>;
  const out: { station?: string; stationRole?: string } = {};
  if (typeof record["station"] === "string") out["station"] = record["station"];
  if (typeof record["stationRole"] === "string") out["stationRole"] = record["stationRole"];
  return out;
}

const SPECIFIER_PATTERN = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/gu;

/** Static imports, re-exports, side-effect imports and literal dynamic imports. */
export function specifiersInSource(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2];
    if (specifier !== undefined && specifier !== "") out.push(specifier);
  }
  return out;
}

/** Splits `@scope/name[/rest...]`; returns null for relative or unscoped specifiers. */
export function splitBareSpecifier(specifier: string): {
  name: string;
  subpath?: string;
} | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const match = /^(@[^/]+\/[^/]+)(?:\/(.+))?$/u.exec(specifier);
  if (match === null) return null;
  const name = match[1];
  const rest = match[2];
  if (name === undefined) return null;
  if (rest === undefined || rest === "") return { name };
  return { name, subpath: `./${rest}` };
}

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/** Every violation line names its rule (R1-R5) so a failure points at the fix. */
export function checkStationRoleBoundaries(packages: readonly StationPackage[]): string[] {
  const violations: string[] = [];
  const byName = new Map<string, StationPackage>();
  for (const pkg of packages) byName.set(pkg.name, pkg);

  for (const pkg of packages) {
    if (pkg.stationRole !== undefined && !isStationRole(pkg.stationRole)) {
      violations.push(
        `[station-roles R5] ${pkg.name} declares unknown stationRole "${pkg.stationRole}". ` +
          `The vocabulary is closed to executor | verifier | objective | solver (MADR 0060). ` +
          `FIX: declare one of the four roles, or remove the station declaration.`,
      );
    } else if (pkg.station !== undefined && pkg.stationRole === undefined) {
      violations.push(
        `[station-roles R5] ${pkg.name} declares station "${pkg.station}" with no stationRole. ` +
          `A roleless station cannot be held to R1-R4. ` +
          `FIX: declare one of executor | verifier | objective | solver.`,
      );
    }
  }

  const reportRoleEdge = (importer: StationPackage, target: StationPackage, detail: string): void => {
    const from = roleOf(importer);
    const to = roleOf(target);
    if (from === undefined || to === undefined) return;
    if (from === "executor" && to === "verifier") {
      violations.push(
        `[station-roles R1] ${importer.name} (stationRole executor) must not ${detail} ` +
          `${target.name} (stationRole verifier). The executor never imports a verifier module; ` +
          `both import the shared objective instead (MADR 0060 decision 4).`,
      );
    }
    if (from === "solver" && to === "executor") {
      violations.push(
        `[station-roles R3] ${importer.name} (stationRole solver) must not ${detail} ` +
          `${target.name} (stationRole executor). Alternative solvers depend on the port contract ` +
          `and the objective, never on executor files (MADR 0060 decision 5).`,
      );
    }
    if (from === "objective" && (to === "executor" || to === "verifier" || to === "solver")) {
      violations.push(
        `[station-roles R4] ${importer.name} (stationRole objective) must not ${detail} ` +
          `${target.name} (stationRole ${to}). The objective is the shared score function; ` +
          `it depends on nothing station-scoped (MADR 0060 decision 4).`,
      );
    }
  };

  const reportRelativeTarget = (importer: StationPackage, file: string, specifier: string): void => {
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
    for (const target of packages) {
      if (target.name === importer.name || target.station === undefined) continue;
      const rest = resolved === target.dir ? "" : resolved.slice(target.dir.length + 1);
      if (resolved !== target.dir && !resolved.startsWith(`${target.dir}/`)) continue;
      if (rest === "src" || rest.startsWith("src/")) {
        violations.push(
          `[station-roles R2] ${importer.name}: ${file} imports station package ` +
            `${target.name}'s private module (${specifier}). Only its declared exports ` +
            `(${target.exportSubpaths.join(", ") || "none declared"}) may be imported. ` +
            `FIX: import through a declared export.`,
        );
      }
    }
  };

  for (const importer of packages) {
    for (const dep of importer.dependencies) {
      const target = byName.get(dep);
      if (target === undefined || target.name === importer.name) continue;
      reportRoleEdge(importer, target, `depend on`);
    }
    for (const source of importer.sources) {
      for (const specifier of source.specifiers) {
        if (specifier.startsWith(".")) {
          reportRelativeTarget(importer, source.file, specifier);
          continue;
        }
        const split = splitBareSpecifier(specifier);
        if (split === null) continue;
        const target = byName.get(split.name);
        if (target === undefined || target.name === importer.name) continue;
        reportRoleEdge(importer, target, `import ${specifier} in ${source.file} from`);
        if (
          target.station !== undefined
          && split.subpath !== undefined
          && !target.exportSubpaths.includes(split.subpath)
        ) {
          violations.push(
            `[station-roles R2] ${importer.name}: ${source.file} imports station package ` +
              `${target.name}'s private module (${specifier}). Only its declared exports ` +
              `(${target.exportSubpaths.join(", ") || "none declared"}) may be imported. ` +
              `FIX: import through a declared export.`,
          );
        }
      }
    }
  }

  return [...new Set(violations)];
}

const MANIFEST_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function listSourceFiles(dir: string, pattern: RegExp, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules$|[/\\]dist$/.test(full)) listSourceFiles(full, pattern, out);
      continue;
    }
    if (pattern.test(entry.name)) out.push(full);
  }
}

/** Depth of the station-package walk: packages/openclinxr/<a> plus stations/<b>. */
export const STATION_SCAN_MAX_DEPTH = 2;

/** Every directory under packagesRoot up to STATION_SCAN_MAX_DEPTH carrying the manifest. */
export function packageDirsWithManifest(packagesRoot: string, manifestFileName: string): string[] {
  const out: string[] = [];
  let top: Dirent[];
  try {
    top = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const consider = (dir: string): void => {
    if (existsSync(join(dir, manifestFileName))) out.push(dir);
  };
  for (const entry of top) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
    const first = join(packagesRoot, entry.name);
    consider(first);
    if (STATION_SCAN_MAX_DEPTH < 2) continue;
    let second: Dirent[];
    try {
      second = readdirSync(first, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const nested of second) {
      if (!nested.isDirectory() || nested.name === "node_modules" || nested.name === "dist") continue;
      consider(join(first, nested.name));
    }
  }
  return out;
}

/** Builds the rule input from the real workspace: every directory under
 * packages/openclinxr up to depth 2 (so packages/openclinxr/stations/<x> per
 * MADR 0060 is seen) carrying the manifest filename. Skips node_modules/dist. */
export function scanWorkspaceStationRoles(
  repoRoot: string = findWorkspaceRoot(),
  manifestFileName: string = "package.json",
  sourcePattern: RegExp = /\.(ts|tsx)$/,
): StationPackage[] {
  const out: StationPackage[] = [];
  const packagesRoot = join(repoRoot, "packages", "openclinxr");
  for (const dir of packageDirsWithManifest(packagesRoot, manifestFileName)) {
    const manifestText = readFileSync(join(dir, manifestFileName), "utf8");
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestText) as Record<string, unknown>;
    } catch {
      continue;
    }
    const { station, stationRole } = parseStationManifest(manifestText);
    const dependencies: string[] = [];
    for (const field of MANIFEST_DEPENDENCY_FIELDS) {
      const table = manifest[field];
      if (table !== null && typeof table === "object") dependencies.push(...Object.keys(table));
    }
    const sources: StationSourceFile[] = [];
    const files: string[] = [];
    listSourceFiles(join(dir, "src"), sourcePattern, files);
    for (const file of files.sort()) {
      sources.push({
        file: toPosixPath(relative(repoRoot, file)),
        specifiers: specifiersInSource(readFileSync(file, "utf8")),
      });
    }
    const exportsTable = manifest["exports"];
    const exportSubpaths =
      exportsTable !== null && typeof exportsTable === "object" ? Object.keys(exportsTable) : [];
    const name =
      typeof manifest["name"] === "string" ? manifest["name"] : toPosixPath(relative(repoRoot, dir));
    out.push({
      name,
      dir: toPosixPath(relative(repoRoot, dir)),
      ...(station === undefined ? {} : { station }),
      ...(stationRole === undefined ? {} : { stationRole }),
      dependencies: [...new Set(dependencies)].sort(),
      sources,
      exportSubpaths,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
