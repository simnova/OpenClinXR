import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportedSymbols } from "../../../packages/openclinxr-verification/architecture-rules/src/checks/export-surface-budgets.ts";
import { identifierIndex } from "../../../packages/openclinxr-verification/architecture-rules/src/checks/unused-entrypoint-exports.ts";

/**
 * `pnpm arch:narrow-entrypoint <package>` — rewrite a package's src/index.ts from `export *`
 * walls into named lists holding only the symbols something outside the package refers to.
 *
 * WHY A TOOL AND NOT A WORKER. Operator directive D1: wire proven tools, do not have workers
 * hand-author. This transformation is deterministic — read the star specifiers, classify each
 * module's own declarations as type or value, keep the intersection with the used set, emit two
 * blocks per module. Eight LLM workers were dispatched to do it by hand before this existed; the
 * script does one package in under a second and does not need reviewing for invented behaviour.
 *
 * WHAT IT IS NOT. The used set comes from a MARKER CHECK over identifier names (see
 * checks/unused-entrypoint-exports.ts), wrong in both directions. This tool WRITES; it does not
 * decide. Every run must be followed by:
 *
 *   pnpm packages:typecheck:agent      a real consumer of a removed symbol fails the build
 *   pnpm --filter <name> test          the package's own behaviour
 *   pnpm arch:ceilings && pnpm arch:index
 *
 * A symbol the compiler proves is consumed goes back by hand, in the named list, with the
 * consumer noted. UNCLASSIFIED lines on stderr are symbols this tool could not place as type or
 * value — usually a nested re-export — and each one must be placed by hand or it is lost.
 */

function repoRoot(): string {
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

const STAR_EXPORT = /^export \* from "(\.[^"]+)";?$/gmu;
const TYPE_DECLARATION = /^export (?:declare )?(?:type|interface|enum)\s+(\w+)/gmu;
const VALUE_DECLARATION = /^export (?:declare )?(?:async )?(?:function|const|class|let|var)\s+(\w+)/gmu;

const pkg = process.argv[2];
if (pkg === undefined) {
  console.error("usage: pnpm arch:narrow-entrypoint <package-directory-name>");
  process.exit(1);
}

const root = repoRoot();
const src = join(root, "packages", "openclinxr", pkg, "src");
const entry = join(src, "index.ts");
const source = readFileSync(entry, "utf8");
const stars = [...source.matchAll(STAR_EXPORT)];
if (stars.length === 0) {
  console.error(`${pkg}/src/index.ts has no \`export *\` wall; nothing for this tool to do.`);
  process.exit(1);
}

/**
 * EVERY re-export specifier, star or named.
 *
 * The first version collected only the stars and rewrote the file from those alone, SILENTLY
 * DISCARDING every `export { … } from "./x.js"` block beside them. Measured on xr-station: 32 stars
 * and 5 named blocks, and the five were lost. Four consumer breaks in apps/ui-xr are what surfaced
 * it. A named block is narrowed the same way a star is — keep the intersection with what the tree
 * consumes — so collecting both is both the fix and the simplification.
 */
const NAMED_REEXPORT = /^export (?:type )?\{([^}]*)\} from "(\.[^"]+)";?$/gmu;

/**
 * PUBLISHED NAME -> LOCAL NAME, for every `export { local as published }` in the original.
 *
 * The first version emitted the DECLARED name and dropped the alias, silently renaming part of the
 * public interface. Measured on xr-station, whose index published
 * `createStationApiClient as createAssembledStationApiClient`; apps/ui-xr imports the alias and
 * failed to compile. A consumer break is the only reason this was found, which is why it is
 * recorded here rather than in a comment on the regex.
 */
const aliases = new Map<string, string>();
/**
 * PUBLISHED NAME -> the specifier the ORIGINAL index published it from.
 *
 * Two modules can declare the same name. xr-station has createStationApiClient in BOTH
 * ./api-client.js and ./station-api-client.js, and the original index published the second one
 * under the alias createAssembledStationApiClient. Without this map the emitter took whichever
 * specifier it reached first and SILENTLY SWAPPED THE IMPLEMENTATION behind an unchanged name —
 * a green typecheck away from shipping the wrong function. apps/ui-xr caught it on a return type.
 */
const originModule = new Map<string, string>();
for (const match of source.matchAll(/^export (?:type )?\{([^}]*)\} from "(\.[^"]+)";?$/gmu)) {
  for (const part of (match[1] ?? "").split(",")) {
    const [local, published] = part.trim().replace(/^type\s+/u, "").split(" as ").map((n) => n.trim());
    if (local === undefined || local === "") continue;
    const name = published ?? local;
    if (published !== undefined && published !== "") aliases.set(published, local);
    originModule.set(name, match[2] ?? "");
  }
}
const specifiers: string[] = [];
for (const match of stars) {
  const specifier = match[1] ?? "";
  if (!specifiers.includes(specifier)) specifiers.push(specifier);
}
for (const match of source.matchAll(NAMED_REEXPORT)) {
  const specifier = match[2] ?? "";
  if (!specifiers.includes(specifier)) specifiers.push(specifier);
}

/**
 * A symbol DECLARED in index.ts itself has no module to re-export it from, so this tool would drop
 * it. Refuse rather than lose it.
 */
const declaredInEntrypoint = [...source.matchAll(/^export (?:declare )?(?:async )?(?:function|const|class|type|interface|enum|let|var)\s+(\w+)/gmu)];
if (declaredInEntrypoint.length > 0) {
  console.error(
    `${pkg}/src/index.ts DECLARES ${declaredInEntrypoint.length} symbol(s) itself `
    + `(${declaredInEntrypoint.map((m) => m[1]).join(", ")}). This tool only rewrites re-export `
    + `lines and would drop them. Move them to a module first.`,
  );
  process.exit(1);
}

const prefix = `packages/openclinxr/${pkg}/`;
const index = identifierIndex(root);
const published = [...exportedSymbols(entry)];
const keep = new Set(
  published.filter((symbol) =>
    [...(index.get(symbol) ?? [])].some((file) => !file.startsWith(prefix)),
  ),
);

const RE_EXPORT_FROM = /^export (?:type )?(?:\*|\{[^}]*\}) from "(\.[^"]+)";?$/gmu;

/**
 * Workspace specifier to that package's entrypoint. A package that re-exports another package's
 * symbols is a smell in its own right, and it is real here: xr-scene republishes measurement
 * helpers from @openclinxr/xr-pose, xr-pose republishes clip names from @openclinxr/asset-registry.
 * Classification has to follow, or those symbols cannot be placed at all.
 */
const workspaceEntrypoints = new Map<string, string>();
// packages/cellix too: shared-schemas re-exports five TypeBox schemas from
// @cellix/provider-contracts, and without the seedwork tier here they cannot be classified.
for (const tier of ["openclinxr", "cellix"]) {
  const tierRoot = join(root, "packages", tier);
  if (!existsSync(tierRoot)) continue;
  for (const dir of readdirSync(tierRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifest = join(tierRoot, dir.name, "package.json");
    const entrypoint = join(tierRoot, dir.name, "src", "index.ts");
    if (!existsSync(manifest) || !existsSync(entrypoint)) continue;
    const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name;
    if (name !== undefined) workspaceEntrypoints.set(name, entrypoint);
  }
}

/**
 * Is `symbol` a type or a value, as declared SOMEWHERE in this module's re-export chain?
 *
 * A per-module scan of local declarations alone cannot place a symbol that arrives through a
 * nested re-export, and there are many: xr-station had 8, xr-scene 14. The first version of this
 * tool reported each as UNCLASSIFIED and refused to place it, which is safe and unusable at 42
 * packages. Following the chain is the same walk `exportedSymbols` already does.
 */
function classify(modulePath: string, symbol: string, seen: Set<string> = new Set()): "type" | "value" | null {
  if (seen.has(modulePath) || !existsSync(modulePath)) return null;
  seen.add(modulePath);
  const text = readFileSync(modulePath, "utf8");
  for (const match of text.matchAll(TYPE_DECLARATION)) if (match[1] === symbol) return "type";
  for (const match of text.matchAll(VALUE_DECLARATION)) if (match[1] === symbol) return "value";
  // A BARE `export type { X };` — no `from` — settles the question by itself.
  for (const match of text.matchAll(/^export type \{([^}]*)\};?$/gmu)) {
    if ((match[1] ?? "").split(",").some((n) => n.trim() === symbol)) return "type";
  }
  // A bare `export { X };` re-exports something this module declared or IMPORTED. Local
  // declarations were checked above, so follow the import that brought it in.
  for (const match of text.matchAll(/^export \{([^}]*)\};?$/gmu)) {
    if (!(match[1] ?? "").split(",").some((n) => n.trim() === symbol)) continue;
    for (const imported of text.matchAll(/^import(?: type)?\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)";?$/gmu)) {
      if (!(imported[1] ?? "").split(",").some((n) => n.trim().replace(/^type\s+/u, "") === symbol)) continue;
      const importedFrom = join(dirname(modulePath), (imported[2] ?? "").replace(/\.js$/u, ".ts"));
      const found = classify(importedFrom, symbol, seen);
      if (found !== null) return found;
    }
    for (const imported of text.matchAll(/^import(?: type)?\s*\{([^}]*)\}\s*from\s*"(@[^"]+)";?$/gmu)) {
      if (!(imported[1] ?? "").split(",").some((n) => n.trim().replace(/^type\s+/u, "") === symbol)) continue;
      const entrypoint = workspaceEntrypoints.get(imported[2] ?? "");
      if (entrypoint === undefined) continue;
      const found = classify(entrypoint, symbol, seen);
      if (found !== null) return found;
    }
  }
  for (const match of text.matchAll(RE_EXPORT_FROM)) {
    const nested = join(dirname(modulePath), (match[1] ?? "").replace(/\.js$/u, ".ts"));
    if (!exportedSymbols(nested).has(symbol)) continue;
    const found = classify(nested, symbol, seen);
    if (found !== null) return found;
  }
  return null;
}

const blocks: string[] = [];
const unclassified: string[] = [];
// `export *` DEDUPLICATES: a symbol reachable through two specifiers is published once. Named
// blocks do not, and emitting it twice is TS2300 Duplicate identifier. Measured on xr-station,
// where station-equipment.js and station-equipment-builders.js both reach six of the same symbols.
const emittedAlready = new Set<string>();
for (const specifier of specifiers) {
  const modulePath = join(src, specifier.replace(/\.js$/u, ".ts"));
  const own = [...exportedSymbols(modulePath)].sort();
  const keptValues: string[] = [];
  const keptTypes: string[] = [];
  // `own` holds LOCAL names; `keep` holds PUBLISHED names. Where the original index renamed on
  // re-export the two differ, and intersecting them directly drops the symbol entirely — which is
  // how createAssembledStationApiClient vanished from xr-station and broke apps/ui-xr.
  const publishedName = (local: string): string => {
    for (const [publishedAs, from] of aliases) if (from === local) return publishedAs;
    return local;
  };
  for (const local of own) {
    const s = publishedName(local);
    if (!keep.has(s) || emittedAlready.has(s)) continue;
    // A name the original index published from a DIFFERENT module is not this module's to emit.
    const origin = originModule.get(s);
    if (origin !== undefined && origin !== specifier) continue;
    const kind = classify(modulePath, local);
    if (kind !== null) emittedAlready.add(s);
    if (kind === "value") keptValues.push(s);
    else if (kind === "type") keptTypes.push(s);
    else unclassified.push(`${specifier}: ${s}`);
  }
  const spell = (publishedAs: string): string => {
    const from = aliases.get(publishedAs);
    return from === undefined || from === publishedAs ? publishedAs : `${from} as ${publishedAs}`;
  };
  if (keptValues.length > 0) {
    blocks.push(`export {\n${keptValues.map((s) => `  ${spell(s)},`).join("\n")}\n} from "${specifier}";`);
  }
  if (keptTypes.length > 0) {
    blocks.push(`export type {\n${keptTypes.map((s) => `  ${spell(s)},`).join("\n")}\n} from "${specifier}";`);
  }
}

/**
 * PHASE 2 — repoint in-package imports that named a symbol the entrypoint no longer publishes.
 *
 * A module importing from its own package's "./index.js" is a self-referential barrel import: it
 * routes through the public interface to reach a sibling. Narrowing the entrypoint exposes every
 * one of them at once, and the fix is mechanical — import from the module that DECLARES the
 * symbol. Doing this by hand is what turned a one-second transformation into an eight-worker
 * dispatch.
 */
function declaringModule(symbol: string): string | null {
  for (const file of readdirSync(src, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".ts") || file.name.includes(".test.")) continue;
    if (file.name === "index.ts") continue;
    if (exportedSymbols(join(src, file.name)).has(symbol)) return `./${file.name.replace(/\.ts$/u, ".js")}`;
  }
  return null;
}

const SELF_BARREL = /import(\s+type)?\s*\{([^}]*)\}\s*from\s*"\.\/index\.js";/gu;
const repointed: string[] = [];
const unplaceable: string[] = [];
for (const file of readdirSync(src, { withFileTypes: true })) {
  if (!file.isFile() || !/\.tsx?$/u.test(file.name) || file.name === "index.ts") continue;
  const full = join(src, file.name);
  const text = readFileSync(full, "utf8");
  let next = text;
  for (const match of text.matchAll(SELF_BARREL)) {
    const isTypeImport = match[1] !== undefined;
    const names = (match[2] ?? "").split(",").map((n) => n.trim()).filter((n) => n !== "");
    const stillPublic: string[] = [];
    const byModule = new Map<string, string[]>();
    for (const name of names) {
      const bare = name.replace(/^type\s+/u, "").split(" as ")[0]?.trim() ?? name;
      if (keep.has(bare)) {
        stillPublic.push(name);
        continue;
      }
      const module = declaringModule(bare);
      if (module === null) {
        unplaceable.push(`${file.name}: ${bare}`);
        stillPublic.push(name);
        continue;
      }
      byModule.set(module, [...(byModule.get(module) ?? []), name]);
    }
    const replacement: string[] = [];
    if (stillPublic.length > 0) {
      replacement.push(`import${isTypeImport ? " type" : ""} { ${stillPublic.join(", ")} } from "./index.js";`);
    }
    for (const [module, moduleNames] of [...byModule].sort()) {
      // When every name in the group is a type, biome's useImportType wants the modifier on the
      // CLAUSE, not on each specifier. Emitting `{ type A, type B }` is an error, not a style note.
      const allTypes = moduleNames.every((n) => n.startsWith("type "));
      const emitted = allTypes ? moduleNames.map((n) => n.slice("type ".length)) : moduleNames;
      replacement.push(
        `import${isTypeImport || allTypes ? " type" : ""} { ${emitted.join(", ")} } from "${module}";`,
      );
      repointed.push(`${file.name}: ${moduleNames.join(", ")} -> ${module}`);
    }
    next = next.replace(match[0], replacement.join("\n"));
  }
  if (next !== text) writeFileSync(full, next);
}

const header = `/**
 * Public interface of @openclinxr/${pkg}.
 *
 * Named lists, not \`export *\`. A star republishes a module wholesale, so a symbol added inside
 * becomes public with nobody deciding it should be. Generated by \`pnpm arch:narrow-entrypoint\`
 * from what the tree actually consumes, then proved by \`pnpm packages:typecheck:agent\`.
 */
`;
writeFileSync(entry, `${header}${blocks.join("\n")}\n`);
console.log(`${pkg}: ${published.length} published -> ${keep.size} kept, ${blocks.length} blocks`);
console.log(`self-barrel imports repointed: ${repointed.length}`);
for (const line of repointed) console.log(`  ${line}`);
if (unplaceable.length > 0) {
  console.error(`\nCOULD NOT PLACE (left importing ./index.js, will fail typecheck):`);
  for (const line of unplaceable) console.error(`  ${line}`);
}
if (unclassified.length > 0) {
  console.error(`\nUNCLASSIFIED (place each by hand or it is LOST):`);
  for (const line of unclassified) console.error(`  ${line}`);
  process.exit(2);
}
