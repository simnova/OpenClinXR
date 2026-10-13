import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The realism-95 branch landed six generator options plus two skin-realism
 * companions. This test pins that landing: the flags must be real argparse
 * options (add_argument calls), not mere mentions in comments/strings, and
 * both companion scripts must exist.
 *
 * claimScope: branch content landed (option wiring present on disk).
 * notEvidenceFor: render quality, clinical validity, Quest readiness.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const GENERATOR_PY = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const PORTRAIT_TS = join(HERE, "runtime-portrait-capture.ts");
const RIG_TS = join(HERE, "fit-studio-rig.ts");

export const REQUIRED_GENERATOR_OPTIONS = [
  "--face-targets",
  "--eye-occlusion-shell",
  "--eye-tearline",
  "--eye-subdivide",
  "--eye-asset",
  "--eyebrow-tris-budget",
] as const;

/**
 * Collect the flag names passed as the first positional argument of an
 * `add_argument(...)` call. A flag name that only appears inside a comment,
 * docstring, help text, or any other string never matches: the
 * `.add_argument(` prefix plus opening quote is required.
 */
export function collectArgparseOptions(pySource: string): Set<string> {
  const found = new Set<string>();
  const re = /\.add_argument\(\s*["'](--[A-Za-z0-9][\w-]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pySource)) !== null) {
    found.add(m[1]);
  }
  return found;
}

describe("the-generator-options-landed-with-the-branch", () => {
  it("registers every branch generator flag as an argparse option", () => {
    const src = readFileSync(GENERATOR_PY, "utf8");
    const options = collectArgparseOptions(src);
    for (const flag of REQUIRED_GENERATOR_OPTIONS) {
      expect(options.has(flag), `missing argparse option ${flag}`).toBe(true);
    }
  });

  it("ships both skin-realism companions next to the test", () => {
    expect(existsSync(PORTRAIT_TS), `missing ${PORTRAIT_TS}`).toBe(true);
    expect(existsSync(RIG_TS), `missing ${RIG_TS}`).toBe(true);
  });

  it("stops finding a flag renamed in a scratch copy (red-proof)", () => {
    const src = readFileSync(GENERATOR_PY, "utf8");
    // Scratch copy only: rename the add_argument literal, leave every
    // comment/string mention of --eye-asset untouched. The real file is
    // never edited.
    const mutated = src.replace('"--eye-asset",', '"--eye-asset-was-renamed",');
    expect(mutated === src, "scratch copy must differ from the real file").toBe(
      false,
    );
    const options = collectArgparseOptions(mutated);
    expect(options.has("--eye-asset")).toBe(false);
  });
});
