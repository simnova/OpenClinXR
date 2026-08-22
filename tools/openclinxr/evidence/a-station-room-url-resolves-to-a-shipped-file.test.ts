import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INFINIGEN_ENVIRONMENT_ASSETS } from "../../../apps/ui-xr/src/infinigen-environment-assets.js";
import {
  resolveLocalEnvironmentRuntimeAssetFileName,
  resolveLocalEquipmentRuntimeAssetFileName,
} from "../../../apps/ui-xr/src/runtime-local-asset-filenames.js";

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
 *
 * ## FIXED (#575)
 *
 * Fix shape: `apps/ui-xr/src/runtime-local-asset-filenames.ts` — `resolveLocalEnvironmentRuntimeAssetFileName`
 * now consults `INFINIGEN_ENVIRONMENT_ASSETS` (the same map `loadInfinigenEnvironmentIntoStation`
 * uses) instead of passing the derived need-id through. Version-insensitive stem match:
 * `pediatric_urgent_care_bay_environment.glb` → map row `pediatric_urgent_care_bay_v1` →
 * `infinigen-pediatric-urgent-care-bay.glb`. The `ed.glb → ed-exam-bay-shell.glb` legacy rewrite is
 * preserved (the ED static bundle still ships `ed.glb`); unknown names still pass through verbatim.
 * main.ts imports the resolver (the two inline copies are gone; net -13 lines against the
 * `file-size-budgets.ts:44` 9980 ceiling — main.ts was 9872, now 9859).
 *
 * Equipment (the issue's "check it, report" ask): `resolveLocalEquipmentRuntimeAssetFileName` has
 * the same hardcoded three-row shape but NOT the same observable defect. Factory equipment reports
 * carry real filenames (`ecg-cart-12-lead.glb`, `iv-pole-with-pump.glb` — medical-equipment-artifacts.ts:20),
 * which pass through verbatim and exist. The static generated bundles DO carry need-id style names
 * (`pulse_oximeter_equipment.glb`), which would miss — but the visible equipment mount path is fed
 * by `REAL_EQUIPMENT_GLTF_BY_ID` (station-equipment.ts:84) at main.ts:3595-3599 and never goes
 * through the emulator resolver, so no blank-equipment defect was observable. Latent same-shape
 * risk recorded as clause (4), not fixed (out of scope).
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

  it("(1) FIXED (#575): every station's loader-resolved filename names a file that exists", () => {
    const absent = ENV_IDS.filter((id) => {
      const needIdFileName = derivedEnvironmentFileName(id);
      const resolved = resolveLocalEnvironmentRuntimeAssetFileName(needIdFileName);
      return !existsSync(join(PUBLIC_ROOT, "xr-assets/environment", resolved));
    });
    expect(
      absent,
      "environmentIds whose loader-resolved filename is absent — each one renders an empty viewport",
    ).toEqual([]);
  });

  it("(2) FIXED + COUNTERWEIGHT: resolution is TABLE-DRIVEN, not a per-name special case", () => {
    // Refuses the cheap fix: adding 14 more rows to a hardcoded resolver. An environmentId
    // that is in the map but in nobody's hardcoded list must still resolve, so the 15th room
    // cannot silently render an empty room again. Drives the PRODUCTION resolver with the
    // exact need-id filename the runtime constructs.
    const mapped = (INFINIGEN_ENVIRONMENT_ASSETS as Readonly<Record<string, string>>)["ob_triage_room_v1"];
    expect(mapped, "the map must still answer for a room with no special case").toBeTruthy();
    const resolved = resolveLocalEnvironmentRuntimeAssetFileName(derivedEnvironmentFileName("ob_triage_room_v1"));
    expect(resolved, "the production resolver must answer the need-id from the map").toBe("infinigen-ob-triage.glb");
    expect(existsSync(join(PUBLIC_ROOT, "xr-assets/environment", resolved))).toBe(true);
  });

  it("(3) FIXED (#575): the ED shell legacy name still rewrites, and unknown names pass through verbatim", () => {
    expect(resolveLocalEnvironmentRuntimeAssetFileName("ed.glb")).toBe("ed-exam-bay-shell.glb");
    expect(resolveLocalEnvironmentRuntimeAssetFileName("ed_environment.glb")).toBe("ed-exam-bay-shell.glb");
    expect(resolveLocalEnvironmentRuntimeAssetFileName("totally_unknown_room.glb")).toBe("totally_unknown_room.glb");
  });

  it("(4) EQUIPMENT SHAPE-CHECK: equipment blobNames resolve to shipped files, no new defect introduced", () => {
    // The issue asked whether the equipment resolver (formerly main.ts:9310) has the same
    // defect. Measured: factory reports carry real filenames (`ecg-cart-12-lead.glb`,
    // `iv-pole-with-pump.glb`), NOT derived need-ids, so equipment never had this bug; the
    // static generated bundles DO carry `<id>_equipment.glb` names, which fall through
    // verbatim and miss — same latent shape as rooms, but those slots are fed by
    // REAL_EQUIPMENT_GLTF_BY_ID at mount time (main.ts planStationEquipmentMounts), so no
    // blank-equipment defect was observable. Recorded here as the guard rail: if a future
    // bundle path starts feeding these names to the loader, this row turns red.
    expect(resolveLocalEquipmentRuntimeAssetFileName("ecg-cart-12-lead.glb")).toBe("ecg-cart-12-lead.glb");
    expect(resolveLocalEquipmentRuntimeAssetFileName("iv-pole-with-pump.glb")).toBe("iv-pole-with-pump.glb");
    expect(existsSync(join(PUBLIC_ROOT, "xr-assets/medical-equipment", "ecg-cart-12-lead.glb"))).toBe(true);
    expect(existsSync(join(PUBLIC_ROOT, "xr-assets/medical-equipment", "iv-pole-with-pump.glb"))).toBe(true);
    // Latent-shape documentation (not asserted against disk): need-id style equipment names
    // pass through today by design.
    expect(resolveLocalEquipmentRuntimeAssetFileName("pulse_oximeter_equipment.glb")).toBe("pulse_oximeter_equipment.glb");
  });
});
