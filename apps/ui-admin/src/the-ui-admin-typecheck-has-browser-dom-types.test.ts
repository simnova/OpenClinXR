import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: @openclinxr/ui-admin is a Vite React browser app whose
 * tsconfig extends @cellix/config-typescript/base (`lib: ["ES2023"]` only).
 * Canonical `pnpm --filter @openclinxr/ui-admin typecheck` fails on
 * document, window, FileReader, navigator.clipboard, and DOM event-target
 * properties. Fix at the project config boundary; do not scatter
 * triple-slash `lib="dom"` directives through source modules.
 *
 * MEASURED 2026-09-04 on origin/main fdddba14 after referenced packages
 * were built: 21 errors, all DOM-lib (TS2584/TS2304/TS2339).
 *
 * claimScope: apps/ui-admin/tsconfig.json supplies browser DOM libs for
 * the package typecheck program.
 * notEvidenceFor: browser runtime; production deploy; clinical validity.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PKG = join(SRC, "..");
const TSCONFIG_PATH = join(PKG, "tsconfig.json");
const TRIPLE_SLASH_DOM = /\/\/\/\s*<reference\s+lib=["']dom["']\s*\/>/i;

type UiAdminTsconfig = {
  compilerOptions?: {
    lib?: string[];
    skipLibCheck?: boolean;
    strict?: boolean;
  };
};

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    out.push(path);
  }
  return out;
}

describe("the ui-admin typecheck has browser DOM types", () => {
  const tsconfig = JSON.parse(readFileSync(TSCONFIG_PATH, "utf8")) as UiAdminTsconfig;
  const lib = tsconfig.compilerOptions?.lib ?? [];

  it("(1) project tsconfig lib includes DOM and DOM.Iterable without dropping ES2023", () => {
    expect(lib).toEqual(expect.arrayContaining(["ES2023", "DOM", "DOM.Iterable"]));
  });

  it("(2) COUNTERWEIGHT: source modules do not use triple-slash DOM lib references", () => {
    const hits = walkSourceFiles(SRC).filter((path) =>
      TRIPLE_SLASH_DOM.test(readFileSync(path, "utf8")),
    );
    expect(hits).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the project config does not newly skipLibCheck or unset strict", () => {
    expect(tsconfig.compilerOptions?.skipLibCheck).not.toBe(true);
    expect(tsconfig.compilerOptions?.strict).not.toBe(false);
  });
});

// NOT TESTED: live browser behavior; production deployment.
