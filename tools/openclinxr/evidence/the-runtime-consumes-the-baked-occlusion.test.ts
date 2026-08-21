import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 2026-08-21 — R1 of the room-realism review. THE AO MAPS EXIST; NOBODY HAS MEASURED THE RUNTIME.
 *
 * ## WHAT IS ALREADY MEASURED — do not re-derive, and note what it does NOT say
 *
 * Orchestrator, on the shipped bytes:
 *   15/15 rooms in apps/ui-xr/public/xr-assets/environment carry an `occlusionTexture`.
 *   The occlusion TEXCOORD set is 1 on every AO material.
 *   TEXCOORD_1 IS PRESENT on the geometry — ed-exam-bay-shell 67/67 prims, infinigen rooms 3 of 4
 *   (the 4th is a non-AO material). So the uv2 three.js needs for `aoMap` exists.
 *   `aoMap` appears ZERO times in apps/ui-xr/src and packages/openclinxr/ *\/src.
 *
 * **ZERO SOURCE HITS DOES NOT MEAN UNUSED.** three.js `GLTFLoader` maps `occlusionTexture` ->
 * `aoMap` and `occlusionTexture.strength` -> `aoMapIntensity` by default. main.ts has 3 material
 * assignment sites and every `MeshBasicMaterial` found is a HUD/marker/trace object, not a room
 * surface — no override that would clobber it.
 *
 * So the honest state is: **probably wired by the loader, definitely unverified, certainly
 * untuned.** The review doc ranks this "highest ROI"; that overclaims until a number exists. This
 * slice produces the number. It is a MEASUREMENT, and a green here is NOT a claim that rooms look
 * better.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | result
 *   ---------------------------------------------------------------|-----|-----|-----|--------
 *   a) today — no runtime probe at all                           |FAIL |FAIL |pass | REFUSED
 *   b) assert the glTF has occlusionTexture and call it done     |FAIL |FAIL |pass | REFUSED
 *   c) set aoMapIntensity = 1 everywhere and skip the probe      |FAIL |pass |FAIL | REFUSED
 *   d) probe a full encounter capture instead of one room        |pass |pass |FAIL | REFUSED
 *   e) isolated room load, report aoMap/intensity/uv, no tuning  |pass |pass |pass | ALL PASS
 *
 * **(b) is the trap.** I have ALREADY measured the glTF side — re-asserting it is green about
 * nothing, because the open question is what the LOADER did with it, not what the file contains.
 * Clause (1) therefore requires a value that only a running renderer can produce.
 * **(c) is worse than doing nothing.** Forcing intensity before measuring destroys the baseline
 * this slice exists to capture, and §7a says a number in a contract becomes a design target.
 * **(d)** contradicts D3/D4 and the review's own harness-first instruction; `isolated-subject-lab`
 * already loads an arbitrary repo-public GLB via `subjectKind: "glb"`, so a whole encounter is
 * unnecessary noise.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are RED — no probe exists. (3) is a NET.
 *
 * KNOWN-GOOD COLUMN (§9h): the glTF side, already measured above — 15/15 rooms carry the map and
 * uv2 exists. If the probe reports zero `aoMap`s against that, the loader is the defect. If it
 * reports non-null maps at some intensity, the maps are live and the question becomes tuning.
 * **Both outcomes are successful.** A report of "already wired at intensity 1.0" closes R1 and
 * REDIRECTS the lane to R2; say so plainly rather than manufacturing a product delta.
 *
 * NO THRESHOLD ON INTENSITY. The review suggests 0.8-1.0; this contract deliberately does NOT
 * assert that, because the value has never been observed and §9s forbids a threshold whose
 * reference is the thing being measured. Record the distribution; the orchestrator grades it.
 *
 * NOT TESTED:
 *   - Whether rooms LOOK better. Not a claim this slice may make.
 *   - Colour space of the occlusion texture. Named by the review as a risk; out of scope here.
 *   - Any material other than room surfaces. Humanoid/clothing scopes are off-limits.
 *   - MADR "0055" is DOUBLE-ALLOCATED (an accepted equipment MADR and a Proposed room one).
 *     This slice is motivated by the PROPOSED room MADR as a ranking, NOT as governing law, and
 *     nothing here may cite it as accepted.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const REPORT = join(REPO, "tools/openclinxr/evidence/room-occlusion-runtime-report.json");
const ENV = join(REPO, "apps/ui-xr/public/xr-assets/environment");

type Row = {
  room: string;
  materials: number;
  withAoMap: number;
  aoMapIntensities: number[];
  aoMapUvSet?: number | null;
};

function report(): { rooms?: Row[]; probedBy?: string } {
  expect(existsSync(REPORT), `${REPORT} — no runtime probe has ever been run`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as ReturnType<typeof report>;
}

describe("the runtime consumes the baked occlusion", () => {
  it.fails("(1) RED: a runtime probe reports aoMap state for a real room load", () => {
    const r = report();
    expect(Array.isArray(r.rooms) && r.rooms.length > 0, "at least one room probed").toBe(true);
    for (const row of r.rooms ?? []) {
      // Only a running renderer can produce these. A glTF-side re-assertion cannot.
      expect(typeof row.withAoMap, `${row.room}: withAoMap must be a measured count`).toBe("number");
      expect(row.materials, `${row.room}: materials seen at runtime`).toBeGreaterThan(0);
      expect(Array.isArray(row.aoMapIntensities), `${row.room}: intensities recorded`).toBe(true);
    }
    expect(
      /page\.evaluate|isolated-subject-lab|GLTFLoader/.test(String(r.probedBy ?? "")),
      "the report must name how it was probed, and it must be a RUNTIME path",
    ).toBe(true);
  });

  it.fails("(2) RED: the probed room is one that actually ships an occlusionTexture", () => {
    // Refuses (b) and a probe pointed at an unrelated asset. The known-good is the glTF side.
    const r = report();
    const probed = (r.rooms ?? []).map((x) => x.room.replace(/\.glb$/, ""));
    expect(probed.length, "probed rooms").toBeGreaterThan(0);
    for (const p of probed) {
      expect(existsSync(join(ENV, `${p}.glb`)), `${p} must be a shipped room`).toBe(true);
    }
  });

  it("(3) NET: no intensity is forced and no room GLB is replaced", () => {
    // Refuses (c) and pins the closed rooms campaign. R1 is loader-side measurement only; R3/R5
    // (trim, props, full-Infinigen re-extract) are CLOSED and are not reopened by a proposed MADR.
    const src = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "{}";
    expect(/"forcedIntensity"\s*:\s*true/.test(src), "the probe must not tune while measuring").toBe(false);
    // Door-leaf 5c81ffd5 and the shipped Infinigen set stay untouched by this slice.
    expect(existsSync(join(ENV, "infinigen-primary-care-clinic.glb")), "shipped room still present").toBe(true);
  });
});
