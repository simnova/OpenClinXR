import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **`pnpm typecheck:relaxed` is red, and 97.3% of the red is one stylistic flag.** A real regression
 * would be one error in 6,330 and nobody would ever see it. That is #309's actual complaint —
 * "typecheck:relaxed cannot detect a regression" — and this is the located version of it.
 *
 * Measured 2026-08-14, `tsgo --noEmit -p tsconfig.tools-relaxed.json` (exit 2, 2.1 s):
 *
 *   error code                                              count   share
 *   ------------------------------------------------------  ------  ------
 *   **TS4111** `noPropertyAccessFromIndexSignature`          6,159   97.3%
 *   TS2339  property does not exist                             47
 *   TS2322  type mismatch                                       36
 *   TS5097  import path                                         22
 *   TS7006  implicit any                                          9
 *   TS2345  argument type                                         6
 *   other                                                        50
 *   ------------------------------------------------------  ------
 *   TOTAL                                                     6,329
 *
 * TS4111 is `obj.foo` where the type has an index signature and the compiler wants `obj["foo"]`. It
 * is a **style preference**, not a correctness check — it cannot catch a wrong type, a missing
 * property or an implicit any. The **170 non-TS4111 errors are the ones that could hide a real
 * defect**, and they are invisible at a 36:1 noise ratio.
 *
 * The rule is inherited, not chosen here: `tsconfig.tools-relaxed.json` extends `./tsconfig.base.json`
 * and overrides only `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `types`. Nothing in
 * the tools project asked for TS4111 — it arrived with the base and nobody has looked at it since the
 * tree grew to 720 files.
 *
 * ## THE KNOWN-GOOD IS THE OTHER HALF OF THE SAME COMMAND (SS9h)
 *
 * `pnpm typecheck` runs `typecheck:strict` (root project, 2 files) **and** `typecheck:relaxed` (tools,
 * 720 files) **and** `packages:typecheck`. The strict and packages halves are green and therefore do
 * detect regressions; only the tools half is drowned. So a working reference exists inside the same
 * script, which is why this contract does not need to invent a standard — it needs the tools half to
 * behave like the halves either side of it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) exits 0 | (2) strict intact | (3) still 720 files | result
 *   ---------------------------------------------------|-------------|-------------------|---------------------|--------
 *   a) today                                           |  **FAIL**   |       pass        |        pass         | REFUSED
 *   b) turn TS4111 off in the BASE config for everyone |    pass     |     **FAIL**      |        pass         | REFUSED
 *   c) narrow `include` until the errors are gone      |    pass     |       pass        |      **FAIL**       | REFUSED
 *   d) turn TS4111 off for the RELAXED project, fix 170|    pass     |       pass        |        pass         | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Disabling the rule in
 * `tsconfig.base.json` silences it everywhere, including the strict project and every package that
 * inherits it — trading a noisy tools gate for a quieter gate everywhere else. The relaxed project is
 * named *relaxed*; that is where a style relaxation belongs.
 *
 * **(c) is why clause (3) exists.** Dropping `tools/** /*.ts` to a subset makes the command green and
 * stops checking the files the gate exists for. 720 tracked `.ts` files are in scope today.
 *
 * **This contract does NOT say TS4111 must be disabled.** Fixing all 6,159 by hand also passes, and if
 * a worker prefers that it is welcome to. The contract says the gate must end up able to fail for a
 * real reason. How is the implementer's call — record it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today at exit 2. (2) and (3)
 * are counterweights and pass today. They are independent of what (1) measures: making the tools
 * project green cannot alter the base config's rule set or shrink the file list unless done by the
 * two specific cheap fixes above.
 *
 * NOT TESTED:
 *   - **That the 170 real errors are genuine defects.** Some may be false positives from
 *     `noUncheckedIndexedAccess`. Nothing here says they are all bugs, only that they are the class
 *     that could be.
 *   - **`typecheck:strict` and `packages:typecheck`.** Both green today and out of scope; this
 *     contract does not pin their error counts.
 *   - **That anyone runs it.** Whether `pnpm typecheck` is wired into a gate is a separate question —
 *     #309's body says nothing gates on it, and this contract does not change that.
 *   - **Regression detection end to end.** A destructive probe would plant a real type error and prove
 *     the gate fails. That is the right proof and it belongs in the slice, not here, because today the
 *     gate fails for 6,329 other reasons and could not distinguish it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const RELAXED = join(REPO_ROOT, "tsconfig.tools-relaxed.json");
const BASE = join(REPO_ROOT, "tsconfig.base.json");
/** `tsconfig.base.json` is a one-line shim; the rule is actually set in the cellix preset. */
const PRESET = join(REPO_ROOT, "packages/cellix/config-typescript/tsconfig.base.json");

/** Tracked `.ts` files under tools/ at the time of measurement. */
const TOOLS_TS_FILES_BASELINE = 720;

function readJsonc(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gmu, "");
  return JSON.parse(raw) as Record<string, unknown>;
}

const relaxed = readJsonc(RELAXED);
const base = readJsonc(BASE);
const preset = readJsonc(PRESET);
const relaxedOptions = (relaxed.compilerOptions ?? {}) as Record<string, unknown>;
const presetOptions = (preset.compilerOptions ?? {}) as Record<string, unknown>;

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireConfigs(): void {
  expect(relaxed.extends, `${RELAXED} extends the shared base`).toBe("./tsconfig.base.json");
  expect(base.extends, `${BASE} is a shim onto the cellix preset`).toContain("config-typescript");
  expect(
    presetOptions.noPropertyAccessFromIndexSignature,
    `${PRESET} is where TS4111 is actually switched on`,
  ).toBe(true);
}

describe("the tools typecheck can detect a regression", () => {
  it("(2) COUNTERWEIGHT: the stylistic rule is not switched off for everyone in the base config", () => {
    // Refuses (b): silencing TS4111 in tsconfig.base.json quiets the strict project and every package
    // that inherits it. A relaxation belongs in the project named relaxed.
    requireConfigs();
    const offInPreset = presetOptions.noPropertyAccessFromIndexSignature === false;
    expect(
      offInPreset,
      "noPropertyAccessFromIndexSignature disabled in the cellix preset — that silences it for every package that inherits it, not just tools",
    ).toBe(false);
  });

  it("(3) COUNTERWEIGHT: the relaxed project still covers every tools .ts file", () => {
    // Refuses (c): narrowing include until the command is green stops checking what the gate exists
    // for. Also pins `types: ["node"]`, without which every node builtin import errors.
    requireConfigs();
    const include = (relaxed.include ?? []) as string[];
    expect(include, "tsconfig.tools-relaxed.json include").toContain("tools/**/*.ts");
    expect(relaxed.exclude ?? null, "an exclude list would silently shrink coverage").toBeNull();
    expect(relaxedOptions.types, "types must keep node builtins resolvable").toEqual(["node"]);
  });
});
