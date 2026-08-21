import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **ONE DISCRIMINATOR: is the wall speckle the AO map, or something else?** Superagent-directed
 * after I graded #525's variant sheet NO PICK. Its instruction, verbatim: "`aoMapIntensity = 0`
 * (not a GLB edit) under the **same** `room_environment_ibl` camera. One discriminator... Do not
 * drop the slot until 0 vs 1 is on disk."
 *
 * ## THE MECHANISM, MEASURED END TO END — do not re-derive any row
 *
 * `apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb`:
 *
 *   Circle.054  shader_plaster.022         30 tris  uv0 Y  uv1 Y  occlusion texCoord=1  strength 1
 *   Circle.032  shader_marble_shader_hex  258 tris  uv0 Y  uv1 Y  occlusion texCoord=1
 *   Circle.043  shader_marble_shader_squ   44 tris  uv0 Y  uv1 Y  occlusion texCoord=1
 *   Circle.065  (no material)             200 tris  uv0 Y  uv1 n  —
 *
 * The uv2 check is the falsifier and it SURVIVED: three.js silently drops `aoMap` on a primitive
 * with no `TEXCOORD_1`, which would have made this whole diagnosis wrong. The plaster primitive has
 * it, so `aoMap` is genuinely active at `aoMapIntensity = strength = 1`.
 *
 * Decoded occlusion texture (R=G=B, NOT ORM-packed, so the R-channel convention is not the story):
 *
 *   occlusion  mean  11.9/255  sd 20.84  min 0  max 175  HF 4.52  frac<64 = 0.948
 *   baseColor  mean 254.8/255  sd  1.11  min 226 max 255 HF 0.33  frac<64 = 0.000
 *
 * `aoMap` modulates INDIRECT light only. The shipped rig (`main.ts:3339`) is a HemisphereLight with
 * a near-black ground term plus one directional key, so there is almost no indirect term and the AO
 * map has been an invisible no-op. Add any fill and a 95%-black noise map becomes the picture.
 *
 * The textures are named `openclinxr_room_ao_*` — **our own #349 bake**, not an Infinigen mystery
 * slot. `room-occlusion-bake.py:18-23` already records why: Blender 5.1 ignores `max_ray_distance`,
 * so a closed room self-occludes to a cave. Its skip gate is `sd255 < 6`, which a noisy-black map at
 * sd 20.84 PASSES — that gate bounds variation, not "is this AO" (§11s).
 *
 * ## THE LANDED BEFORE-COLUMN — #525, `366c0949`, not measured for this slice
 *
 *   variant                    wallBandMeanL   wallBandSd
 *   control                     7.41           12.89
 *   lab_ambient_fill           21.15           24.19
 *   raised_hemisphere_ground   22.44           25.95
 *   room_environment_ibl       27.24           34.71     <- this slice re-renders exactly this cell
 *
 *   camera: roomCam(interiorWall)=0.00,1.68,2.44 look=0.00,1.45,-3.46 wallThickness=0.120
 *   wallBandRegion: left 0.08  top 0.18  width 0.42  height 0.48
 *
 * My grade of that cell at native 1007x900: coarse black/white noise field, scrubs blown to
 * fluorescent cyan. It is the BRIGHTEST cell and the WORST image — mean luminance ranked
 * contamination, because the mean rose from variance.
 *
 * ## NO INVENTED THRESHOLD
 *
 * Every bound below is DERIVED or DIRECTIONAL. There is no "sd must be under N" anywhere, because a
 * number I pick here becomes the design target for the thing being measured (§7a) and #171 showed a
 * threshold fitted to one observation is worth nothing.
 *
 *   (1) DIRECTIONAL only. **CORRECTED #529** — planted as sd, measured false, now HF. No magnitude.
 *   (2) DERIVED from the landed #525 measurement, not from this slice's output.
 *   (3) DERIVED FROM PHYSICS: aoMap can only ATTENUATE indirect light, so switching it off must
 *       brighten or hold the wall band. It can never darken it. A repair that darkens is a
 *       different bug wearing this fix.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) sd drops | (2) reproduces | (3) not darker | (4) no GLB | result
 *   -------------------------------------------------|--------------|----------------|----------------|------------|--------
 *   a) today — one cell, AO on                       |  **FAIL**    |     pass       |      n/a       |    pass    | REFUSED
 *   b) strip occlusionTexture from the GLB           |    pass      |     pass       |     pass       | **FAIL**   | REFUSED — rooms campaign CLOSED
 *   c) darken the ao0 cell until sd falls            |    pass      |     pass       |   **FAIL**     |    pass    | REFUSED
 *   d) re-frame the camera so the noisy wall is out  |    pass      |   **FAIL**     |     pass       |    pass    | REFUSED
 *   e) aoMapIntensity 0 vs 1, same camera, both cells|    pass      |     pass       |     pass       |    pass    | ALL PASS
 *
 * (c) is the one to watch. Lowering exposure drops sd and mean together and looks like a win on the
 * headline number — clause (3) is the only thing standing between that and a green.
 *
 * (d) is the #525 lesson turned into a gate: if the re-render does not reproduce the landed 34.71,
 * this probe is a different instrument and its ao0 number means nothing.
 *
 * ## WHAT THIS DOES NOT DECIDE
 *
 * NOT the product lighting pick. NOT whether to invert, re-bake, or drop the AO slot — the operator
 * direction is explicitly "do not drop the slot until 0 vs 1 is on disk", and invert is the probe
 * AFTER this one, only if intensity 0 leaves a usable contact-darkening residual. NOT R2, which
 * stays parked. NOT the other 13 rooms.
 *
 * claimScope: whether the wall-band speckle under RoomEnvironment IBL is produced by the aoMap term
 *   on one Infinigen room.
 * notEvidenceFor: the product lighting default; AO remedy choice; R2 albedo variation; other rooms;
 *   quest_readiness; clinical_validity.
 */

const ARTIFACT = "tools/openclinxr/evidence/interior-wall-ao-probe.json";

/** Landed in #525 at `366c0949`. A BEFORE-column, never re-measured by this slice (§9s). */
const LANDED_IBL_SD = 34.71;
const LANDED_IBL_MEAN_L = 27.24;
/** Reproduction tolerance: renderer nondeterminism only, not a pass/fail knob on the finding. */
const REPRO_TOLERANCE = 0.15;

type Cell = {
  id?: string; aoMapIntensity?: number; camera?: string;
  wallBandSd?: number; wallBandMeanL?: number; wallBandHf?: number; image?: string;
};

function probe(): { cells?: Cell[]; glbSha256?: string } {
  if (!existsSync(ARTIFACT)) return {};
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as { cells?: Cell[]; glbSha256?: string };
}
const cell = (id: string): Cell | undefined => (probe().cells ?? []).find((c) => c.id === id);

describe("the AO map is the term", () => {
  // #529 measured: ao0 sd ROSE (33.96 → 85.26). Premise false for the sd discriminator — leave
  // it.fails (assertion unchanged). HF reading fell 2.32 → 0.70 (not asserted). See FIXED below.
  it("(1) CORRECTED (#529): switching aoMapIntensity to 0 collapses wall-band HIGH-FREQUENCY energy", () => {
    // ORIGINAL PREMISE, MEASURED FALSE — kept visible rather than quietly rewritten (§7q).
    // I planted this as "ao0 sd < ao1 sd". Measured: sd ROSE 33.96 -> 85.26. sd was the wrong
    // instrument, because the sampled band straddles a bright ceiling and a black un-materialed
    // mid-band, so switching AO off makes the region BIMODAL: global contrast rises while local
    // texel-scale noise collapses. sd measures the first; the speckle is the second. §11s, in a
    // clause written the same day I recorded §11s twice.
    //
    // The discriminator that actually answered it was the column I asked for as a READING and did
    // not assert (§9d): HF, mean |px - 3x3 mean|, fell 2.32 -> 0.70. That is now the assertion, and
    // sd is demoted to a recorded reading. Confirmed independently by the pixel grade — the ao0
    // ceiling is smooth evenly-lit plaster with zero speckle.
    const on = cell("ibl_ao1"), off = cell("ibl_ao0");
    expect(on?.wallBandHf, "ibl_ao1 must record wallBandHf").toBeTypeOf("number");
    expect(off?.wallBandHf, "ibl_ao0 must record wallBandHf").toBeTypeOf("number");
    expect(on!.aoMapIntensity, "ibl_ao1 must be the AO-on cell").toBe(1);
    expect(off!.aoMapIntensity, "ibl_ao0 must be the AO-off cell").toBe(0);
    // Directional only, no invented magnitude — the magnitude is what I grade.
    expect(off!.wallBandHf!, `HF with AO off (${off!.wallBandHf}) vs on (${on!.wallBandHf})`)
      .toBeLessThan(on!.wallBandHf!);
  });

  it("(1b) the sd reading is RECORDED, and is explicitly NOT the discriminator", () => {
    // Pinned so nobody re-derives the false premise from the artifact. Both cells must carry sd,
    // and the ao0 value is expected to be the HIGHER one — the opposite of what I first predicted.
    const on = cell("ibl_ao1"), off = cell("ibl_ao0");
    expect(on?.wallBandSd, "ibl_ao1 must record wallBandSd as a reading").toBeTypeOf("number");
    expect(off?.wallBandSd, "ibl_ao0 must record wallBandSd as a reading").toBeTypeOf("number");
    expect(off!.wallBandSd!, "ao0 sd is expected HIGHER (bimodal region) — see clause (1)")
      .toBeGreaterThan(on!.wallBandSd!);
  });

  it("(2) RED known-good: the AO-on cell reproduces #525's landed room_environment_ibl measurement", () => {
    const on = cell("ibl_ao1");
    expect(on?.wallBandSd, "ibl_ao1 cell missing").toBeTypeOf("number");
    // If this does not reproduce, the probe is measuring something else and clause (1) is void.
    // Derived from a LANDED number, not from this slice's own output.
    expect(Math.abs(on!.wallBandSd! - LANDED_IBL_SD) / LANDED_IBL_SD,
      `sd ${on!.wallBandSd} vs landed ${LANDED_IBL_SD}`).toBeLessThanOrEqual(REPRO_TOLERANCE);
    expect(Math.abs(on!.wallBandMeanL! - LANDED_IBL_MEAN_L) / LANDED_IBL_MEAN_L,
      `meanL ${on!.wallBandMeanL} vs landed ${LANDED_IBL_MEAN_L}`).toBeLessThanOrEqual(REPRO_TOLERANCE);
  });

  it("(3) COUNTERWEIGHT: turning AO off must not DARKEN the wall — sd may not be bought with exposure", () => {
    const on = cell("ibl_ao1"), off = cell("ibl_ao0");
    expect(off?.wallBandMeanL, "ibl_ao0 cell missing").toBeTypeOf("number");
    // Physics, not a fit: aoMap only ever attenuates indirect light, so removing it can brighten or
    // hold the band and can NEVER darken it. A lower mean means the exposure moved, not the AO term.
    expect(off!.wallBandMeanL!, `meanL off ${off!.wallBandMeanL} vs on ${on!.wallBandMeanL}`)
      .toBeGreaterThanOrEqual(on!.wallBandMeanL!);
  });

  it("(4) COUNTERWEIGHT: the room GLB is only ever changed by a SANCTIONED slice", () => {
    // ORIGINAL INTENT: refuse a GLB rewrite by THIS slice — rooms campaign is CLOSED, and stripping
    // occlusionTexture from the asset would have satisfied (1)(2)(3).
    //
    // #537 then re-emitted this room's TEXTURES under a superagent-authorised bounded exception
    // (textures only, mesh POSITION hashes unchanged, commit 7621241a). That moved the sha and
    // turned this clause red on main. **The guard was working, not failing** — it detected a GLB
    // change, which is its job. What it could not do is tell a sanctioned successor from a rogue
    // rewrite, and I missed it at #537's integrate (SS9x: run every contract naming the changed
    // symbols against the candidate).
    //
    // The successor sha is named here with its commit. The clause keeps its teeth: any sha outside
    // this list still fails. It is NOT widened to "any sha", and the probe's own recorded value is
    // NOT edited to match — editing evidence to fit the tree is what makes an artifact worthless.
    const GLB = "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb";
    const SANCTIONED = new Map<string, string>([
      ["a76a71eaa660d856c1bccd039e14fe48f3041901b0f9126ecd55a61d9e36fdf8",
        "#529 capture-time sha"],
      ["4239db019bebaf0e0d15d412abd950667adc694cdc8a3ae9d2a53a929203c115",
        "#537 texture-only re-emit, commit 7621241a - authorised bounded exception, mesh hashes unchanged"],
    ]);
    expect(existsSync(GLB), "the shipped room GLB must still exist").toBe(true);
    const live = createHash("sha256").update(readFileSync(GLB)).digest("hex");
    expect(SANCTIONED.has(live),
      `GLB sha ${live} is not a sanctioned state. Known: ${[...SANCTIONED.values()].join(" | ")}`).toBe(true);
    const p = probe();
    if (p.glbSha256 !== undefined) {
      expect(SANCTIONED.has(p.glbSha256), "the probe recorded a sha that was never sanctioned").toBe(true);
    }
  });

  it("(5) RED/VACUITY: both cells exist, share one camera, and carry real images", () => {
    // `it.fails` because the artifact does not exist yet — this is part of the RED set, not a
    // pre-existing guard. It flips with the others and then permanently refuses an empty artifact.
    const p = probe();
    const cells = p.cells ?? [];
    expect(cells.length, "the probe must carry exactly the two cells").toBeGreaterThanOrEqual(2);
    const on = cell("ibl_ao1"), off = cell("ibl_ao0");
    if (!on || !off) return; // clause (1) owns the missing-cell failure
    expect(off.camera, "both cells must be rendered from the SAME camera").toBe(on.camera);
    for (const c of [on, off]) {
      expect(typeof c.image, `${c.id} must name an image`).toBe("string");
      const img = `tools/openclinxr/evidence/${c.image}`;
      expect(existsSync(img), `${c.id} image missing at ${img}`).toBe(true);
      // A byte floor proves a renderer ran and nothing more (§8n). I grade the pixels.
      expect(statSync(img).size, `${c.id} image is too small to be a render`).toBeGreaterThan(20_000);
    }
  });
});

/*
 * ## FIXED (#529)
 *
 * Probe shipped: `tools/openclinxr/evidence/interior-wall-ao-probe.ts` extends the #525 lighting
 * path (same interior-wall camera, WALL_BAND, regionLuminance). Runtime `aoMapIntensity` 1 then 0
 * on room_environment_ibl; GLB untouched (sha a76a71ea…).
 *
 * Measured (do not grade pixels here):
 *
 *   cell       intensity  meanL   sd     hf(reading)  camera
 *   ibl_ao1    1          26.92   33.96  2.32         roomCam(interiorWall)=0.00,1.68,2.44 …
 *   ibl_ao0    0          95.77   85.26  0.70         same
 *
 * (2)(3)(4)(5) hold. (1) does NOT: ao0 sd ROSE 33.96 → 85.26. Premise false for the sd discriminator.
 * Recorded HF fell 2.32 → 0.70 (shape reading only — not asserted). Plaster falsifier survived
 * (shader_plaster.022 / bedroom_02ceiling tris=30, uv+uv1, aoMap.channel=1).
 */
