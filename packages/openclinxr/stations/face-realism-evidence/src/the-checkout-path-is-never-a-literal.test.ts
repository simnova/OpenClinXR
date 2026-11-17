/**
 * The checkout path is never a literal in TypeScript production src
 * (card PKG-HARDCODED-CHECKOUT-PATH).
 *
 * CI 44150879142: six face-realism-evidence files failed because production
 * code ran `mise exec -C /Volumes/files/src/openclinxr`, a path that does
 * not exist on the runner. The fix derives the trust dir from the
 * module-anchored repoRoot(); this guard keeps the literal out of
 * TypeScript production src under packages/ so the failure cannot return.
 *
 * Placement: face-realism-evidence (not architecture-rules) — the failing
 * shard owns the rule, and no arch-ceiling ratchet needs rewiring.
 *
 * Scope is .ts ONLY, deliberately. A known machine-local literal remains
 * in packages/openclinxr/xr-scene/src/skin-shader/g1_light_follow.py:36
 * (the CC0 texture path): it is a non-.ts source outside this guard and is
 * executed by no CI caller (backlog — do not extend this scanner to .py
 * here, and do not edit that file in this card).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The machine-local checkout path that must never appear in TypeScript production src. */
export const CHECKOUT_LITERAL = "/Volumes/files/src/openclinxr";

/** Scan outcome: every hit plus the number of eligible files read, so the
 * real-tree assertion cannot pass vacuously on a wrong or empty root. */
export type CheckoutLiteralScan = { hits: string[]; filesRead: number };

/** Local repo-root walk: importing runner here would count against the
 * test-internal-import ceiling. */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/** Every TypeScript production-src hit of the checkout literal, as
 * `relpath:line: text`, walked strictly under `<root>/packages`. */
export function findHardcodedCheckoutPaths(root: string): CheckoutLiteralScan {
  const hits: string[] = [];
  let filesRead = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts") || entry.name.endsWith(".test.ts")) {
        continue;
      }
      filesRead += 1;
      const rel = relative(root, full).replaceAll("\\", "/");
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (line.includes(CHECKOUT_LITERAL)) hits.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
  };
  walk(join(root, "packages"));
  return { hits: hits.sort(), filesRead };
}

describe("the checkout path is never a literal in TypeScript production src", () => {
  it("the real TypeScript production src carries no checkout literal", () => {
    const { hits, filesRead } = findHardcodedCheckoutPaths(testRepoRoot());
    console.log(`checkout-literal scan of the real tree: ${filesRead} files read, ${hits.length} hits`);
    expect(filesRead).toBeGreaterThanOrEqual(1000);
    expect(hits).toEqual([]);
  });

  it("a planted checkout literal in TypeScript production src fails naming the file", () => {
    const root = mkdtempSync(join(tmpdir(), "checkout-literal-plant-"));
    const dir = join(root, "packages", "openclinxr", "stations", "face-realism", "src");
    mkdirSync(dir, { recursive: true });
    const before = `const MISE_TRUST_DIR = "${CHECKOUT_LITERAL}";`;
    writeFileSync(join(dir, "planted.ts"), `${before}\n`);
    writeFileSync(join(dir, "clean.ts"), `export const ok = 1;\n`);
    const { hits, filesRead } = findHardcodedCheckoutPaths(root);
    console.log(`plant before: ${before}`);
    console.log(`plant after (scan): ${filesRead} files read, ${JSON.stringify(hits)}`);
    expect(filesRead).toBe(2);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("packages/openclinxr/stations/face-realism/src/planted.ts");
  });
});
