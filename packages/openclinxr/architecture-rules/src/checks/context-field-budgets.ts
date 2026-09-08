import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Context field budget (ArchUnit-style; "a package takes a narrow context, not the app").
 *
 * WHY: a package that takes a 93-field context object has not been decoupled from the app —
 * it has retyped it. `xr-asset-loading/src/types.ts` AssetLoadingContext is 93 fields,
 * almost all thunks reaching back into apps/ui-xr, and it is why main.ts cannot shrink:
 * the context IS how the app hands itself back. `xr-station-room/src/types.ts`
 * StationRoomContext is 37 and carries 14 `typeof import(...)` members, which is a package
 * receiving other packages' functions rather than importing them.
 *
 * The counter-example is in this repo. `xr-scene-cues/src/types.ts` defines twelve contexts,
 * none over 10 fields, feeding 21 exported functions, and imports three.js directly. It is
 * the one extraction that produced a controlled surface.
 *
 * The narrowing that works is not "fewer fields" but "fields typed to a capability the
 * consumer needs". The CellixJs reference does this at ocom/context-spec/src/index.ts:13 —
 * ApiContextSpec has six fields, each typed to a narrowed operations interface rather than
 * to the service class implementing it, in a package containing nothing else.
 *
 * THE BUDGET IS 12, and its provenance is two independent in-tree measurements, neither
 * fitted to current state: the median context in packages/openclinxr is 5 fields (50 types
 * measured), and xr-scene-cues, the package that split its contexts deliberately, tops out
 * at 10. 12 clears both with margin. 44 of 50 contexts already pass.
 *
 * CEILINGS ARE GENERATED AND PER-PACKAGE, which is the point.
 * `checks/file-size-budgets.ts` and `checks/composition-root-conventions.ts` hold their
 * freeze data in one shared literal each, and those two files are the #1 and #2 most-edited
 * source files in the last 400 commits — every extraction slice must touch both, so two
 * parallel workers collide on the gate rather than on the code. Here each over-budget
 * package carries its OWN `arch-ceiling.json`, written by `pnpm arch:ceilings`. A worker in
 * xr-asset-loading never touches xr-station-room's ceiling, and nobody hand-edits a number.
 *
 * RATCHET SEMANTICS: measured must be <= ceiling, and a ceiling above its measurement is
 * itself a violation, so the ratchet can only tighten. Regenerate after shrinking a context.
 */

export const CONTEXT_FIELD_BUDGET = 12;

/** Filename each over-budget package carries, beside its package.json. */
export const CEILING_FILENAME = "arch-ceiling.json";

export type ContextMeasurement = { pkg: string; file: string; type: string; fields: number };

const CONTEXT_DECL = /export (?:type|interface) (\w*(?:Context|Deps))\b[^={]*[={]\s*\{/gu;
const FIELD = /^ {2}(?:readonly\s+)?\w+\??\s*:/gmu;

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/** Field count of the brace-balanced body that starts at `open` (the index of its `{`). */
export function countContextFields(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return (source.slice(open + 1, i).match(FIELD) ?? []).length;
    }
  }
  return 0;
}

/** Every exported *Context / *Deps object type under packages/openclinxr, with its field count. */
export function measureContexts(): ContextMeasurement[] {
  const root = findWorkspaceRoot();
  const packagesRoot = join(root, "packages", "openclinxr");
  const out: ContextMeasurement[] = [];
  if (!existsSync(packagesRoot)) return out;
  for (const pkg of readdirSync(packagesRoot)) {
    const src = join(packagesRoot, pkg, "src");
    if (!existsSync(src)) continue;
    const stack = [src];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) break;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!/node_modules$|[/\\]dist$/.test(full)) stack.push(full);
          continue;
        }
        if (!/\.ts$/.test(entry.name)) continue;
        if (/\.(test|spec)\.ts$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        CONTEXT_DECL.lastIndex = 0;
        let match = CONTEXT_DECL.exec(text);
        while (match !== null) {
          const fields = countContextFields(text, CONTEXT_DECL.lastIndex - 1);
          if (fields > 0) {
            out.push({ pkg, file: relative(root, full), type: match[1] ?? "", fields });
          }
          match = CONTEXT_DECL.exec(text);
        }
      }
    }
  }
  return out.sort((a, b) => b.fields - a.fields);
}

export type PackageCeiling = { contexts: Record<string, number> };

/** The generated ceiling for one package, or null when it carries none (i.e. it is under budget). */
export function readPackageCeiling(pkg: string): PackageCeiling | null {
  const file = join(findWorkspaceRoot(), "packages", "openclinxr", pkg, CEILING_FILENAME);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as PackageCeiling;
}

/** What `pnpm arch:ceilings` should write for each package, keyed by package name. */
export function generateCeilings(
  measurements: readonly ContextMeasurement[] = measureContexts(),
): Record<string, PackageCeiling> {
  const byPkg: Record<string, PackageCeiling> = {};
  for (const m of measurements) {
    if (m.fields <= CONTEXT_FIELD_BUDGET) continue;
    const entry = byPkg[m.pkg] ?? { contexts: {} };
    entry.contexts[m.type] = m.fields;
    byPkg[m.pkg] = entry;
  }
  return byPkg;
}

export type ContextViolation = { file: string; detail: string };

/**
 * One violation per context over budget with no ceiling entry, per context above its ceiling,
 * and per ceiling entry that sits above what the tree now measures (the ratchet only tightens).
 */
export function checkContextFieldBudgets(
  measurements: readonly ContextMeasurement[] = measureContexts(),
  ceilingFor: (pkg: string) => PackageCeiling | null = readPackageCeiling,
): ContextViolation[] {
  const violations: ContextViolation[] = [];
  const seen = new Set<string>();
  for (const m of measurements) {
    seen.add(`${m.pkg}::${m.type}`);
    const ceiling = ceilingFor(m.pkg)?.contexts[m.type];
    if (m.fields <= CONTEXT_FIELD_BUDGET) {
      if (ceiling !== undefined) {
        violations.push({
          file: m.file,
          detail:
            `${m.file}: ${m.type} is ${m.fields} fields, at or under the budget of ${CONTEXT_FIELD_BUDGET}, ` +
            `but still carries a ceiling of ${ceiling}. Run pnpm arch:ceilings to drop the entry.`,
        });
      }
      continue;
    }
    if (ceiling === undefined) {
      violations.push({
        file: m.file,
        detail:
          `${m.file}: ${m.type} takes ${m.fields} fields > budget ${CONTEXT_FIELD_BUDGET}, with no ceiling. ` +
          "A package that takes a context this wide has retyped the app rather than decoupling from it: " +
          "xr-asset-loading's 93-field AssetLoadingContext is why apps/ui-xr/src/main.ts cannot shrink. " +
          "FIX: type each field to the capability the package needs (see ocom/context-spec in the CellixJs " +
          "reference, 6 fields), or import what a package may import instead of receiving it. " +
          "Do NOT add a ceiling entry by hand.",
      });
      continue;
    }
    if (m.fields > ceiling) {
      violations.push({
        file: m.file,
        detail:
          `${m.file}: ${m.type} grew to ${m.fields} fields > its ceiling ${ceiling}. Ceilings only shrink — ` +
          "narrow the context; do NOT regenerate to raise the number.",
      });
    }
  }
  for (const m of measurements) {
    const ceiling = ceilingFor(m.pkg);
    if (ceiling === null) continue;
    for (const [type, value] of Object.entries(ceiling.contexts)) {
      if (!seen.has(`${m.pkg}::${type}`)) continue;
      const measured = measurements.find((x) => x.pkg === m.pkg && x.type === type)?.fields ?? 0;
      // A context that has fallen to or under the budget is already reported above as carrying
      // a stale entry; reporting it twice would make one defect look like two.
      if (measured <= CONTEXT_FIELD_BUDGET) continue;
      if (value > measured) {
        violations.push({
          file: `packages/openclinxr/${m.pkg}/${CEILING_FILENAME}`,
          detail:
            `packages/openclinxr/${m.pkg}/${CEILING_FILENAME}: ${type} ceiling ${value} is above the measured ` +
            `${measured} — the rot was fixed but the ceiling was not lowered. Run pnpm arch:ceilings.`,
        });
      }
    }
  }
  return violations.filter(
    (v, i, all) => all.findIndex((other) => other.detail === v.detail) === i,
  );
}
