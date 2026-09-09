import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A shipped humanoid's provenance record names the bytes it describes. Does it?
 *
 * Measured 2026-09-09, while republishing the physician with a grafted walk clip: EIGHT of the
 * thirteen `*.provenance.json` files under `public/generated-humanoids` name an `outputSha256` that
 * does not match the asset at their own `assetPath`, and several are out by more than 10 MB. The
 * physician's record claimed 21,798,768 bytes against a file of 11,207,936. Nothing checked it, so
 * every record's hash was decorative: a provenance chain that cannot say which bytes it describes
 * documents nothing.
 *
 * SHRINK-ONLY RATCHET, the same shape as SIZE_FREEZE and the typecheck ceiling. The eight existing
 * mismatches are frozen by NAME as debt. A record not in the freeze must hash correctly, so no new
 * drift can enter; and a frozen record that starts matching FAILS, so paying one down forces its
 * removal from the list rather than leaving a stale entry that hides the next regression.
 *
 * DO NOT "fix" the eight by rewriting their hashes to whatever is on disk today. That asserts the
 * current bytes are the intended ones, which nobody has verified, and it would erase the finding.
 * Each is paid down by re-baking the asset from its recorded generator, or by re-recording the hash
 * in the same commit that explains why the bytes changed.
 */

const HUMANOIDS_DIR = new URL("../public/generated-humanoids/", import.meta.url);

/** Records whose outputSha256 did not match on 2026-09-09. This list may only SHRINK. */
const PROVENANCE_HASH_MISMATCH_FREEZE = [
  "adult_male_street_casual.provenance.json",
  "mpfb-clinical-nurse-adult.provenance.json",
  "mpfb-family-partner-adult.provenance.json",
  "mpfb-ob-patient-aisha.provenance.json",
  "mpfb-peds-nurse-kevin.provenance.json",
  "mpfb-peds-parent-aisha.provenance.json",
  "mpfb-peds-patient-child.provenance.json",
  "mpfb-street-adult-male.provenance.json",
] as const;

type ProvenanceRow = {
  file: string;
  assetPath: string;
  declaredSha256: string;
  actualSha256: string;
  matches: boolean;
};

function provenanceRows(): ProvenanceRow[] {
  // assetPath values are repo-root-relative, and vitest runs with cwd at the app root.
  const directory = fileURLToPath(HUMANOIDS_DIR);
  const repoRoot = path.resolve(directory, "../../../..");
  const rows: ProvenanceRow[] = [];
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith(".provenance.json")) continue;
    const record = JSON.parse(readFileSync(path.join(directory, file), "utf8"));
    const declaredSha256 = record.outputSha256;
    const assetPath = record.assetPath;
    // A record without both fields makes no claim about bytes; clause (3) counts them.
    if (typeof declaredSha256 !== "string" || typeof assetPath !== "string") continue;
    const resolved = path.resolve(repoRoot, assetPath);
    if (!existsSync(resolved)) {
      rows.push({ file, assetPath, declaredSha256, actualSha256: "(asset missing)", matches: false });
      continue;
    }
    const actualSha256 = createHash("sha256").update(readFileSync(resolved)).digest("hex");
    rows.push({ file, assetPath, declaredSha256, actualSha256, matches: actualSha256 === declaredSha256 });
  }
  return rows;
}

describe("shipped humanoids hash to their provenance", () => {
  it("(1) every record OUTSIDE the freeze names the bytes at its own assetPath", () => {
    const offenders = provenanceRows()
      .filter((row) => !row.matches)
      .filter((row) => !(PROVENANCE_HASH_MISMATCH_FREEZE as readonly string[]).includes(row.file));
    expect(
      offenders.map((row) => `${row.file}: declares ${row.declaredSha256.slice(0, 12)} but ${row.assetPath} is ${row.actualSha256.slice(0, 12)}`),
      "a shipped humanoid's provenance no longer names its own bytes — re-run the generator or re-record the hash in the commit that changed them; do NOT add it to the freeze",
    ).toEqual([]);
  });

  it("(2) the freeze may only SHRINK — a record that now matches must be removed from it", () => {
    const rows = provenanceRows();
    const repaired = (PROVENANCE_HASH_MISMATCH_FREEZE as readonly string[]).filter(
      (file) => rows.find((row) => row.file === file)?.matches === true,
    );
    expect(
      repaired,
      "these records now hash correctly — delete them from PROVENANCE_HASH_MISMATCH_FREEZE in the same commit, or the list hides the next regression",
    ).toEqual([]);
  });

  it("(3) the freeze names files that EXIST, so it cannot go green by naming nothing", () => {
    const present = new Set(provenanceRows().map((row) => row.file));
    for (const file of PROVENANCE_HASH_MISMATCH_FREEZE) {
      expect(present.has(file), `${file} is frozen but carries no outputSha256/assetPath pair`).toBe(true);
    }
    // And the population is real: a gate that inspected zero records would satisfy clauses 1 and 2.
    expect(present.size).toBeGreaterThan(PROVENANCE_HASH_MISMATCH_FREEZE.length);
  });

  it("(4) the physician carries the grafted walk clip and hashes to its record", () => {
    // The asset this freeze was written while republishing. It is OUTSIDE the freeze, so clause (1)
    // already guards its hash; this clause pins the reason it was republished.
    const row = provenanceRows().find((entry) => entry.file === "mpfb-clinical-physician-adult.provenance.json");
    expect(row?.matches).toBe(true);
    const record = JSON.parse(
      readFileSync(new URL("mpfb-clinical-physician-adult.provenance.json", HUMANOIDS_DIR), "utf8"),
    );
    const walk = record.motionClips?.find(
      (clip: { clipName: string }) => clip.clipName === "openclinxr_retarget_cmu_02_01_walk",
    );
    expect(walk, "the grafted walk clip must be declared in provenance, with its licence").toBeDefined();
    expect(walk.licenceStatus).toMatch(/CONDITIONAL/u);
    // Emitted by graft-bound-clip --publish from the foot-plant report, so it is the measured
    // rate rather than a hand-typed integer: 120.0000046574794 from the clip's own key times.
    expect(walk.framesPerSecond).toBeCloseTo(120, 3);
    expect(walk.deliveredBy).toBe("tools/openclinxr/factory/graft-bound-clip.ts");
  });
});
