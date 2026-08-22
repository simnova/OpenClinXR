import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INFINIGEN_ENVIRONMENT_ASSETS } from "../../../apps/ui-xr/src/infinigen-environment-assets.js";

/**
 * OBSERVABLE: a learner sees the room their station declares.
 *
 * MEASURED 2026-08-22, do not re-derive. A booted ui-xr capture of
 * `peds_asthma_parent_anxiety_v1` rendered a BLANK viewport (113,516 bytes — `exists:` and
 * `min-bytes:` both pass on it). The run's own inspection JSON said
 * `expectedAssetCount 4 · loadedCount 3 · failedCount 1 · pageErrors []`: all three humanoids
 * loaded, `pediatric_urgent_care_bay_environment` FAILED, silently.
 *
 * THE MECHANISM, traced — a NEED-ID is used as a FILE NAME:
 *   asset-registry/src/index.ts:1890
 *     `${environmentId.replace(/_v\d+$/,"").replace(/_environment$/,"")}_environment`
 *   reaches the runtime as a blob name; main.ts:9295 turns its last segment into a URL via
 *   main.ts:9303 `resolveLocalEnvironmentRuntimeAssetFileName`, which rewrites EXACTLY ONE name
 *   (`ed.glb` -> `ed-exam-bay-shell.glb`) and passes everything else through verbatim.
 *
 *   `INFINIGEN_ENVIRONMENT_ASSETS` holds the correct answer for all 14, keyed on environmentId,
 *   and is NEVER CONSULTED on that path.
 *
 * Measured: derived-path files present 0/14. Mapped-path files present 14/14.
 *
 * NO KNOWN-GOOD COLUMN EXISTS on the derived path, and that absence is itself the finding — even
 * `ed_exam_bay_v1` misses, because its derived name is `ed_exam_bay_environment.glb`, not the
 * `ed.glb` the one hardcoded row rewrites. Clause (0) is therefore the vacuity guard instead.
 *
 * WHY THIS IS NOT COVERED BY `a-second-station-gets-its-own-generated-room.test.ts`: that contract
 * asserts the MAP resolves to a real, distinct room — and it is green, correctly, because the map is
 * correct. It measures the table; this measures the hop that actually runs. Two instruments, one
 * blind spot each (§6e).
 *
 * DO NOT touch a room GLB. 15 files ship, every mapped path resolves, the campaign is closed. The
 * defect is a constructed filename, not a missing asset.
 *
 * claimScope: whether the filename the ui-xr loader constructs for a station's environment names a
 * file that exists under apps/ui-xr/public.
 * notEvidenceFor: whether the room renders, is lit, is the right room, or that humanoids are visible.
 */

const PUBLIC_ROOT = join(import.meta.dirname, "../../../apps/ui-xr/public");

/** The runtime's derivation, transcribed from index.ts:1890 — NOT a guess. */
function derivedEnvironmentFileName(environmentId: string): string {
  return `${environmentId.replace(/_v\d+$/u, "").replace(/_environment$/u, "")}_environment.glb`;
}

const ENV_IDS = Object.keys(INFINIGEN_ENVIRONMENT_ASSETS as Readonly<Record<string, string>>);

describe("a station room URL resolves to a shipped file", () => {
  it("(0) VACUITY GUARD: the map is populated and every MAPPED file is on disk", () => {
    // Without this, clauses (1)/(2) could go green by the map emptying rather than by the loader
    // being fixed. Passes today: 14 rows, 14 files.
    expect(ENV_IDS.length, "INFINIGEN_ENVIRONMENT_ASSETS row count").toBeGreaterThanOrEqual(14);
    const missing = ENV_IDS.filter(
      (id) => !existsSync(join(PUBLIC_ROOT, (INFINIGEN_ENVIRONMENT_ASSETS as Readonly<Record<string, string>>)[id]!)),
    );
    expect(missing, "mapped room files absent from apps/ui-xr/public").toEqual([]);
  });

  it.fails("(1) RED: every station's loader-requested filename names a file that exists", () => {
    const absent = ENV_IDS.filter((id) => !existsSync(join(PUBLIC_ROOT, "xr-assets/environment", derivedEnvironmentFileName(id))));
    expect(
      absent,
      "environmentIds whose loader-derived filename is absent — each one renders an empty viewport",
    ).toEqual([]);
  });

  it.fails("(2) RED + COUNTERWEIGHT: resolution is TABLE-DRIVEN, not a per-name special case", () => {
    // Refuses the cheap fix: adding 14 more rows to resolveLocalEnvironmentRuntimeAssetFileName.
    // An environmentId that is in the map but in nobody's hardcoded list must still resolve, so the
    // 15th room cannot silently render an empty room again.
    const mapped = (INFINIGEN_ENVIRONMENT_ASSETS as Readonly<Record<string, string>>)["ob_triage_room_v1"];
    expect(mapped, "the map must still answer for a room with no special case").toBeTruthy();
    expect(
      existsSync(join(PUBLIC_ROOT, "xr-assets/environment", derivedEnvironmentFileName("ob_triage_room_v1"))),
      "ob_triage has no hardcoded rewrite; if only this one is special-cased the fix did not generalise",
    ).toBe(true);
  });
});
