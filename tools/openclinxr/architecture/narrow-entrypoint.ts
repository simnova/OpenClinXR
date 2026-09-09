import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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

const prefix = `packages/openclinxr/${pkg}/`;
const index = identifierIndex(root);
const published = [...exportedSymbols(entry)];
const keep = new Set(
  published.filter((symbol) =>
    [...(index.get(symbol) ?? [])].some((file) => !file.startsWith(prefix)),
  ),
);

const blocks: string[] = [];
const unclassified: string[] = [];
for (const star of stars) {
  const specifier = star[1] ?? "";
  const modulePath = join(src, specifier.replace(/\.js$/u, ".ts"));
  const moduleSource = readFileSync(modulePath, "utf8");
  const types = new Set([...moduleSource.matchAll(TYPE_DECLARATION)].map((m) => m[1] ?? ""));
  const values = new Set([...moduleSource.matchAll(VALUE_DECLARATION)].map((m) => m[1] ?? ""));
  const own = [...exportedSymbols(modulePath)].sort();
  const keptValues = own.filter((s) => keep.has(s) && values.has(s));
  const keptTypes = own.filter((s) => keep.has(s) && types.has(s));
  for (const s of own) {
    if (keep.has(s) && !values.has(s) && !types.has(s)) unclassified.push(`${specifier}: ${s}`);
  }
  if (keptValues.length > 0) {
    blocks.push(`export {\n${keptValues.map((s) => `  ${s},`).join("\n")}\n} from "${specifier}";`);
  }
  if (keptTypes.length > 0) {
    blocks.push(`export type {\n${keptTypes.map((s) => `  ${s},`).join("\n")}\n} from "${specifier}";`);
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
