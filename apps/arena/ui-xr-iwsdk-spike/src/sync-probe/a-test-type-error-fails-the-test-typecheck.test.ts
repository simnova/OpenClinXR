import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T1 RED: a type error inside a `*.test.ts` file is invisible to the spike's
 * current typecheck gate and visible to the pilot test-typecheck config.
 *
 * `packages/cellix/config-typescript/tsconfig.base.json` excludes every
 * `*.test.ts` / `*.spec.ts`, and the spike's `tsconfig.json` inherits that
 * exclude (vitest strips types without checking them). So this test plants a
 * temp `*.test.ts` fixture that imports a name
 * `@openclinxr/xr-sync-client/headset` does NOT export, then:
 *
 *   - the pilot config (`tsconfig.test.json`) MUST report TS2305/TS2614 for
 *     the fixture file;
 *   - the current config (`tsconfig.json`) MUST report nothing for that file
 *     (it is excluded, so the error passes the gate silently).
 *
 * Both tsc outputs are embedded in the assertion messages (shown on failure)
 * and the fixture lines are printed for the record.
 *
 * Plain `it()` on purpose: an `it.fails` cannot guard its own vacuity — it is
 * satisfied by ANY failure, including the harness itself being broken.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = pathResolve(HERE, "../..");
const REPO_ROOT = pathResolve(PKG_ROOT, "../../..");
const CELLIX_TSC = join(REPO_ROOT, "node_modules/.bin/cellix-tsc");

/** A name the headset subpath is guaranteed not to export. */
const NON_EXPORT = "__C4TSC_NONEXISTENT_EXPORT__";
const FIXTURE_NAME = "a-fixture.test.ts";

function spikeTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (e === "node_modules" || e === "dist") continue;
        walk(full);
      } else if (/\.test\.tsx?$/.test(e) || /\.spec\.tsx?$/.test(e)) {
        out.push(full);
      }
    }
  };
  walk(join(PKG_ROOT, "src"));
  for (const rootCfg of ["vite.config.test.ts", "vite.config.test.mts"]) {
    try {
      statSync(join(PKG_ROOT, rootCfg));
      out.push(join(PKG_ROOT, rootCfg));
    } catch {
      /* absent */
    }
  }
  return out.sort();
}

function runConfig(config: string): string {
  try {
    const out = execFileSync(CELLIX_TSC, ["--noEmit", "-p", config], {
      cwd: PKG_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return typeof out === "string" ? out : "";
  } catch (error) {
    const e = error as { stdout?: unknown; stderr?: unknown };
    return `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`;
  }
}

describe("a test-type error fails the test typecheck", () => {
  it("T1 RED: pilot config reports TS2305/TS2614 for the fixture, current config reports nothing", () => {
    const tmpDir = join(HERE, `tmp-c4tsc-${process.pid}`);
    const fixture = join(tmpDir, FIXTURE_NAME);
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        fixture,
        `import type { ${NON_EXPORT} } from "@openclinxr/xr-sync-client/headset";\n` +
          `export const broken: ${NON_EXPORT} = 1 as never;\n`,
      );

      const testOut = runConfig("tsconfig.test.json");
      const currentOut = runConfig("tsconfig.json");

      const testLines = testOut.split("\n").filter((l) => l.includes(FIXTURE_NAME));
      const currentLines = currentOut.split("\n").filter((l) => l.includes(FIXTURE_NAME));

      console.log(`[c4tsc] pilot tsconfig.test.json lines for ${FIXTURE_NAME}:\n${testLines.join("\n") || "(none)"}`);
      console.log(
        `[c4tsc] current tsconfig.json lines for ${FIXTURE_NAME}:\n${currentLines.join("\n") || "(none)"}`,
      );

      expect(
        testLines.join("\n"),
        `pilot config must flag the fixture; full pilot output:\n${testOut.slice(0, 4000)}`,
      ).toMatch(/error\s+TS(2305|2614)/);
      expect(
        currentLines.join("\n"),
        `current config must be blind to the fixture (excluded *.test.ts); lines:\n${currentLines.join("\n")}`,
      ).toBe("");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 180_000);

  it("T2 COUNTERWEIGHT: no suppression, no skipLibCheck widening, no excluded failing file", () => {
    const testConfigRaw = readFileSync(join(PKG_ROOT, "tsconfig.test.json"), "utf8");
    expect(testConfigRaw.includes("@ts-nocheck"), "tsconfig.test.json must not contain @ts-nocheck").toBe(false);
    expect(testConfigRaw.includes("skipLibCheck"), "tsconfig.test.json must not touch skipLibCheck").toBe(false);
    const parsed = JSON.parse(testConfigRaw) as { exclude?: unknown };
    expect(
      JSON.stringify(parsed.exclude ?? []),
      "tsconfig.test.json must not exclude any test file",
    ).not.toMatch(/test|spec/);
    // A suppression is a COMMENT directive, not a mention: strip string
    // literals first so assertion messages naming "@ts-nocheck" do not match.
    const stripStrings = (line: string): string =>
      line
        .replace(/'(?:[^'\\]|\\.)*'/g, "")
        .replace(/"(?:[^"\\]|\\.)*"/g, "")
        .replace(/`(?:[^`\\]|\\.)*`/g, "");
    for (const f of spikeTestFiles()) {
      const src = readFileSync(f, "utf8");
      const hit = src.split("\n").some((line) => stripStrings(line).includes("@ts-nocheck"));
      expect(hit, `${f} must not carry an @ts-nocheck suppression comment`).toBe(false);
    }
  });

  it("T2 COUNTERWEIGHT: the pilot config includes every spike *.test.ts", () => {
    let listFiles = "";
    try {
      listFiles = execFileSync(CELLIX_TSC, ["-p", "tsconfig.test.json", "--listFiles"], {
        cwd: PKG_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
      }) as string;
    } catch (error) {
      const e = error as { stdout?: unknown };
      listFiles = String(e.stdout ?? "");
    }
    const files = spikeTestFiles();
    expect(files.length, "spike must have test files for this gate to be non-vacuous").toBeGreaterThan(0);
    const missing = files.filter((f) => !listFiles.includes(f));
    expect(missing, `pilot config must include every spike test file; missing:\n${missing.join("\n")}`).toEqual([]);
  });
});
