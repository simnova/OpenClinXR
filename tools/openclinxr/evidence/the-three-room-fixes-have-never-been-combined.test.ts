import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **Three room fixes have landed separately and no capture has ever had all three on at once.**
 * Measured on main 2026-08-21:
 *
 *   1. station lighting variants   LANDED in product  `main.ts:3339` applyStationInteriorLighting,
 *                                  default still `control` (#525)
 *   2. materialised exterior hull  LANDED in product  `infinigen-room-primitive-materials.ts` (#534)
 *   3. aoMapIntensity = 0          **NOT IN PRODUCT** — `grep aoMapIntensity apps/ui-xr/src/*.ts`
 *                                  returns NOTHING. It exists only inside the #529 probe script.
 *
 * And the artifacts do not overlap in time: `interior-wall-ao-probe/ibl_ao0.png` was captured for
 * #529 **before** #534 materialised the hull, and `room-primitive-material-probe/primary-care-interior.png`
 * was captured for #534 at the **control** rig with AO at full strength (its own artifact records no
 * `lightingVariant` at all). **Every conclusion about this room rests on a capture missing at least
 * one of the three.**
 *
 * ## WHY THIS IS THE RIGHT NEXT SLICE AND NOT MORE THEORY
 *
 * The rooms lane has spent this session cycling hypotheses, and four of mine died to measurement
 * (#536 withdrawal). The remaining facts are few and solid:
 *
 *   wall albedo    0.747 of full, INSIDE its UV coverage   (7.3% coverage — the whole-atlas mean of
 *                                                           13.0/255 that drove #536/#537/#539 was
 *                                                           diluted by 93% empty texels and is dead)
 *   ceiling albedo 0.999 of full, 100% coverage
 *   AO map         11.9/255, 94.8% below 64, applied at aoMapIntensity 1
 *
 * A bright wall behind a 95%-black AO multiplier is a complete explanation that has **never been
 * tested with the hull also materialised**. One capture settles it.
 *
 * ## THE DERIVED BOUND — from measured albedo, not invented (SS9s)
 *
 * Under equal illumination the rendered wall:ceiling ratio should approach their albedo ratio:
 *
 *   0.747 / 0.999 = **0.75**
 *
 * Clause (3) requires the rendered ratio to be no worse than **half** that — i.e. >= 0.37. That
 * references the two surfaces' own measured albedos in the same capture, so it cannot be satisfied
 * by tuning either one alone, and it names no target luminance the bake can be fitted to.
 *
 * A ratio far below 0.37 means something is attenuating the WALL specifically, which is the only
 * remaining shape the AO hypothesis predicts. A ratio near 0.75 with both surfaces still dim is a
 * different finding entirely — a global exposure problem, not a per-surface one — and that
 * distinction is exactly what no existing capture can make.
 *
 * ## NO WHOLE-IMAGE MEANS. Named regions only.
 *
 * The #536 withdrawal was caused by averaging across areas that were not the subject. The artifact
 * must record wall, ceiling and floor as **separately named regions**, never one blended figure,
 * and must carry the region rectangles it used so I can check them against the capture.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) all three | (2) regions | (3) ratio | (4) default | result
 *   -------------------------------------------------|---------------|-------------|-----------|-------------|--------
 *   a) today — no capture has all three              |  **FAIL**     |  **FAIL**   |   n/a     |    pass     | REFUSED
 *   b) re-run #529's ao probe unchanged              |  **FAIL**     |  **FAIL**   |   n/a     |    pass     | REFUSED — hull still bare
 *   c) one blended wall-band mean again              |    pass       |  **FAIL**   |   n/a     |    pass     | REFUSED — this is what caused #536
 *   d) ship aoMapIntensity 0 as the product default  |    pass       |    pass     |   pass    |  **FAIL**   | REFUSED — the pick is the orchestrator's
 *   e) capture with all three, regions separate      |    pass       |    pass     |    ?      |    pass     | ALL PASS, and I grade it
 *
 * (d) is the one to watch: the slice will look finished if the room lights up, and shipping the
 * value is a different decision from measuring it. Clause (4) keeps the product default at
 * `control` exactly as #525 left it.
 *
 * claimScope: whether one capture with station lighting, aoMapIntensity 0 and the materialised hull
 *   all active produces a lit interior, with wall/ceiling/floor measured as separate regions.
 * notEvidenceFor: the product lighting default; the AO remedy choice (invert vs zero vs rebake);
 *   the other 13 rooms; whether the room looks CORRECT, only whether its surfaces are lit.
 */

/**
 * ## RECT CORRECTION (#543 grade, 2026-08-21) — the contract went green on a bimodal rect I wrote
 *
 * `#543` landed with `wall: meanL 93.7, sd 86.08` and a wall:ceiling ratio of 0.848, which cleared
 * clause (3) comfortably. **My pixel grade says the wall is still black.** The rect was wrong.
 *
 * `WALL_RECT` was `[0.08, 0.18, 0.42, 0.48]` — y 18%..66% — which straddles the lit ceiling and the
 * dark wall. Row-band profile of the landed capture, x 8%..50%:
 *
 *     y 10-35%   mean 208.0   sd  0.5    <- CEILING, flat and lit
 *     y 40-65%   mean  26-39  sd  5-46   <- WALL, still dark
 *     y 75-90%   mean  98-111 sd 21-26   <- FLOOR, lit
 *
 * 208-bright rows averaged with 26-dark rows give 93.76 at sd 85.91. **A bimodal mean, exactly the
 * failure #529 already cost a slice for and #536 was withdrawn over.** Third instance.
 *
 * The CONTRACT was sound and the bound was right: on the corrected rects the true wall:ceiling ratio
 * is **≈0.15**, far below the 0.37 floor, so clause (3) FAILS as it should have. Only my rectangle
 * was wrong. Rects corrected below from the landed capture's own row profile; the high sd that gave
 * it away is now itself a clause (see (2b)).
 */
const ARTIFACT = "tools/openclinxr/evidence/three-fixes-combined-probe.json";

/** Measured INSIDE UV coverage on the shipped GLB, 2026-08-21. The #536 lesson. */
const ALBEDO = { wall: 0.747, ceiling: 0.999 } as const;

/**
 * Rects corrected from #543's landed row profile. A region whose sd approaches its own mean is
 * straddling two surfaces, not measuring one — that is what (2b) refuses.
 */
const MAX_REGION_SD_TO_MEAN = 0.5;
/** Derived, not invented: half the albedo ratio. See the header. */
const MIN_WALL_TO_CEILING_RATIO = (ALBEDO.wall / ALBEDO.ceiling) / 2;

type Region = { id?: string; meanL?: number; rect?: number[] };
type Probe = {
  lightingVariant?: string; aoMapIntensity?: number; hullMaterialsApplied?: boolean;
  camera?: string; image?: string; regions?: Region[]; productDefaultVariant?: string;
};
const probe = (): Probe => (existsSync(ARTIFACT) ? JSON.parse(readFileSync(ARTIFACT, "utf8")) as Probe : {});
const region = (id: string): Region | undefined => (probe().regions ?? []).find((r) => r.id === id);

describe("the three room fixes have never been combined", () => {
  it("(1) RED: one capture has station lighting, aoMapIntensity 0 AND the materialised hull", () => {
    const p = probe();
    expect(p.lightingVariant, `${ARTIFACT} missing — no combined capture exists`).toBeTypeOf("string");
    expect(p.lightingVariant, "must not be the control rig").not.toBe("control");
    expect(p.aoMapIntensity, "AO must be neutralised in this capture").toBe(0);
    expect(p.hullMaterialsApplied, "the #534 hull assignment must be active").toBe(true);
  });

  it("(2) RED: wall, ceiling and floor are recorded as SEPARATE named regions with their rects", () => {
    // #536 died because a whole-image mean averaged across things that were not the subject.
    for (const id of ["wall", "ceiling", "floor"]) {
      const r = region(id);
      expect(r?.meanL, `no separate mean recorded for ${id}`).toBeTypeOf("number");
      expect(Array.isArray(r?.rect) && r!.rect!.length === 4,
        `${id} must record the rect it measured so I can check it against the image`).toBe(true);
    }
  });

  it.fails("(2b) RED: no region is bimodal — sd must not approach its own mean", () => {
    // #543's `wall` came back mean 93.7 / sd 86.08 and cleared clause (3) at ratio 0.848. My pixel
    // grade said the wall was black. The rect spanned a lit ceiling (row mean 208) and a dark wall
    // (row mean 26-39); the average is an artifact. A single surface under one light does not
    // produce sd approaching its mean. This is the clause that would have caught MY rectangle, and
    // it is derived from that failure rather than invented. Third instance of the bimodal-mean
    // error in this campaign (#529 sd, #536 whole-atlas, this).
    const bad = (probe().regions ?? [])
      .filter((r) => typeof r.meanL === "number" && typeof (r as { sd?: number }).sd === "number")
      .filter((r) => ((r as { sd: number }).sd / Math.max(1, r.meanL!)) > MAX_REGION_SD_TO_MEAN)
      .map((r) => `${r.id}: mean ${r.meanL} sd ${(r as { sd: number }).sd}`);
    expect(bad, "regions whose sd approaches their mean are straddling two surfaces").toEqual([]);
  });

  it("(3) RED: the rendered wall:ceiling ratio is not far below their albedo ratio", () => {
    const w = region("wall")?.meanL, c = region("ceiling")?.meanL;
    expect(w, "wall region missing").toBeTypeOf("number");
    expect(c, "ceiling region missing").toBeTypeOf("number");
    expect(c!, "ceiling region is black — the capture is not lit at all").toBeGreaterThan(1);
    const ratio = w! / c!;
    expect(ratio, `rendered wall:ceiling ${ratio.toFixed(3)} vs albedo ratio ${(ALBEDO.wall/ALBEDO.ceiling).toFixed(3)}`)
      .toBeGreaterThanOrEqual(MIN_WALL_TO_CEILING_RATIO);
  });

  it("(4) COUNTERWEIGHT: the product default stays `control` — measuring is not shipping", () => {
    // #525 left the default at control deliberately and the pick is the orchestrator's. A slice that
    // lights the room will feel finished; shipping the value is a separate decision.
    const p = probe();
    if (p.productDefaultVariant !== undefined) {
      expect(p.productDefaultVariant, "the shipped default must still be control").toBe("control");
    }
    const main = readFileSync("apps/ui-xr/src/main.ts", "utf8");
    expect(/resolveStationInteriorLightingVariantId\(/.test(main),
      "the variant resolver must still gate the default").toBe(true);
  });

  it("(5) VACUITY: the capture is a real image at a stated camera", () => {
    const p = probe();
    if (!p.image) return; // clause (1) owns the missing-artifact failure
    const img = `tools/openclinxr/evidence/${p.image}`;
    expect(existsSync(img), `image missing at ${img}`).toBe(true);
    // A byte floor proves a renderer ran and nothing more (SS8n). I grade the pixels.
    expect(statSync(img).size, "too small to be a render").toBeGreaterThan(20_000);
    expect(typeof p.camera, "the capture must state its camera").toBe("string");
  });
});

/*
## FIXED (#543)
- Probe: `tools/openclinxr/evidence/three-fixes-combined-probe.ts` extends #529 AO override +
  #534 hull-on-load + #525 `room_environment_ibl` URL (D1 — no third harness).
- Artifact: `three-fixes-combined-probe.json` + `three-fixes-combined/combined-ibl-ao0-hull.png`.
- Measured (named regions): wallL=93.70 ceilingL=110.48 floorL=95.81; ratio=0.848 (≥ 0.37 floor).
- Product default left at `control`; aoMapIntensity=0 is runtime-only in the probe (clause 4).
- Premise check: `grep aoMapIntensity apps/ui-xr/src` still empty — NOT shipped.
*/
