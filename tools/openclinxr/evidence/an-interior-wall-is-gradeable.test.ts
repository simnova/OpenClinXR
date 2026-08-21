import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 2026-08-21 — AN INTERIOR WALL RENDERS AT LUMINANCE 8.9. NOTHING DOWNSTREAM OF THAT IS GRADEABLE.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * Orchestrator grade, `primary_care_dyslipidemia_joint_pain_v1`, shipped interior camera
 * (`roomCam(derived)=3.01,1.68,2.44`, eye 1.68 m, nearestActor 2.49 m), HUD excluded:
 *
 *   viewport 1007x900   mean L 37.5   sd 41.2   57.7% of pixels below L=24
 *   WALL BAND           mean L  8.9   sd 17.9
 *
 * R2 of the room-realism review wanted plaster albedo variation (measured sd 1.1 / 7.2). **That is
 * unevaluable**: you cannot judge whether a texture reads flat on a surface at luminance 9. R2 is
 * parked until a wall is gradeable, and adding variation to an invisible albedo is the same error
 * as painting a metal albedo — already ruled out of scope.
 *
 * ## THE LIGHTING RIG, MEASURED — and one correction to my own first reading
 *
 *   main.ts:3339   HemisphereLight(sky 0xf4f0dc, ground 0x223042, intensity 2.2)
 *   capture-shadow-map.ts:47-69  DirectionalLight(0xffffff, 2.5) at (3, 5, 4)
 *   scene.environment / PMREMGenerator / RoomEnvironment:  ZERO occurrences in apps/ui-xr/src
 *
 * **The key light is ALWAYS in the scene** — `input.scene.add(key)` at :68 sits OUTSIDE the
 * `if (input.active)` block; only `castShadow` and the shadow camera are conditional. I first read
 * it as capture-only. It is not. **The learner sees the same key, minus shadows, so the graded
 * capture was already the BRIGHTER path** and L=8.9 is a product property, not a capture artifact.
 * Do NOT "fix" this by widening `isCaptureShadowPath` — #249 forbids changing product lighting to
 * serve a grading instrument.
 *
 * MECHANISM, as far as it is established: `HemisphereLight` shades by normal orientation. Interior
 * wall normals face inward and downward-ish, so they take mostly the GROUND term —
 * `0x223042` = rgb(34,48,66), luminance ~46/255 — and there is no environment map to fill in.
 *
 * NOT ESTABLISHED, and nobody may inherit it as fact: whether the ceiling occludes the key light.
 * My probe of that was VOID — I read raw glTF `POSITION` as world coordinates without node
 * transforms and got `y 0.00..0.00` for a wall, which is impossible. Local space, not world. If
 * measured at all, go through world matrices (§6v). It is an adjacent reading, NOT a gate.
 *
 * ## KNOWN-GOOD COLUMN (§9h) — the isolated lab already solves this, in the same repo
 *
 *   isolated-subject-lab.ts:408-415   AmbientLight("#dceee6", 1.45)
 *                                     DirectionalLight("#ffffff", 2.2) at ( 3.2, 5.2,  4.1)
 *                                     DirectionalLight("#b6d8ca", 1.1) at (-3.5, 2.8, -2.2)  <- counter-fill
 *
 * The lab has an ambient and a counter-fill the station scene does not. That is a proven in-tree
 * configuration (D1), not a hypothesis, and it is why lab renders are legible while the station is
 * not. It is one candidate among several — NOT the decided answer.
 *
 * ## THIS CONTRACT ASSERTS A SWEEP, NOT A VALUE (§7a / §9k)
 *
 * No intensity, colour or HDRI choice appears here. A number in a contract becomes the product's
 * design target, and #171 showed a threshold fitted to an observation is worth nothing. The slice
 * must render a LABELLED VARIANT SHEET — control plus candidates — and the ORCHESTRATOR grades it
 * and picks. A worker that ships one tuned value has decided a product question it was not asked.
 *
 *   treatment                                                     | (1) | (2) | (3) | result
 *   ----------------------------------------------------------------|-----|-----|-----|--------
 *   a) today — hemisphere + key, no ambient, no fill, no IBL      |FAIL |FAIL |pass | REFUSED
 *   b) pick one intensity and ship it                             |pass |FAIL |pass | REFUSED
 *   c) brighten only the capture path                             |FAIL |FAIL |FAIL | REFUSED
 *   d) replace room GLBs / rebake lighting into albedo            |pass |pass |FAIL | REFUSED
 *   e) product-path variant sheet, orchestrator grades and picks  |pass |pass |pass | ALL PASS
 *
 * **(c) is the one #249 already named**: brightening the grading instrument makes the evidence lie
 * while the learner's room stays dark. Clause (3) pins it — the change must be on the product path.
 * **(d)** is closed: the rooms campaign forbids replacing a shipped GLB, and baking light into
 * albedo is refused by MADR 0056's own anti-pattern table.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are RED. (3) is a NET.
 *
 * NOT TESTED:
 *   - Which variant is right. That is the orchestrator's grade, deliberately not encoded here.
 *   - `infinigen-stepdown` and the other 12 rooms. One room until a wall is legible.
 *   - Whether the five metals change appearance once anything reflective exists. Predicted and
 *     EXPECTED — grade it, do not file it as a regression.
 *   - Ceiling occlusion. Void probe, see above.
 *
 * ## FIXED (#525)
 * Product-path lighting variants in `apps/ui-xr/src/station-interior-lighting.ts`; main.ts
 * applies via `?stationLighting=` (default remains `control` — orchestrator picks). Labelled
 * sheet: `tools/openclinxr/evidence/interior-wall-lighting-variants.json` with control +
 * lab_ambient_fill + raised_hemisphere_ground + room_environment_ibl, each with measured
 * wallBandMeanL on primary-care interior framing. No room GLB change; no capture-only fill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const SHEET = join(REPO, "tools/openclinxr/evidence/interior-wall-lighting-variants.json");
const MAIN = join(REPO, "apps/ui-xr/src/main.ts");
const CAPTURE_SHADOW = join(REPO, "apps/ui-xr/src/capture-shadow-map.ts");
const ENV = join(REPO, "apps/ui-xr/public/xr-assets/environment");

/** Measured 2026-08-21 on the shipped interior camera. The wall must beat this to be gradeable. */
const MEASURED_WALL_BAND_L = 8.9;

type Variant = { label: string; wallBandMeanL: number; image?: string };

function sheet(): { variants?: Variant[]; room?: string; graderNote?: string } {
  expect(existsSync(SHEET), `${SHEET} — no lighting variant sheet has ever been rendered`).toBe(true);
  return JSON.parse(readFileSync(SHEET, "utf8")) as ReturnType<typeof sheet>;
}

describe("an interior wall is gradeable", () => {
  it("(1) RED: a labelled variant sheet exists with a control and candidates", () => {
    const s = sheet();
    const v = s.variants ?? [];
    expect(v.length, "control plus at least two candidates").toBeGreaterThanOrEqual(3);
    expect(
      v.some((x) => /control|current|baseline/i.test(x.label)),
      "one variant must be the CURRENT rig, unchanged — without it there is no before",
    ).toBe(true);
    for (const x of v) {
      expect(typeof x.wallBandMeanL, `${x.label}: wall band mean L must be measured`).toBe("number");
    }
    expect(existsSync(join(ENV, `${String(s.room ?? "").replace(/\.glb$/, "")}.glb`)),
      "the sheet must name a shipped room it was rendered from").toBe(true);
  });

  it("(2) RED: at least one variant lifts the wall band clear of the measured floor", () => {
    // Refuses (a). No target value is named — only that SOMETHING beats today, so the orchestrator
    // has a real choice to grade. A sheet where every row matches the control has swept nothing.
    const v = (sheet().variants ?? []).filter((x) => Number.isFinite(x.wallBandMeanL));
    const control = v.find((x) => /control|current|baseline/i.test(x.label));
    expect(control?.wallBandMeanL, "control must reproduce roughly today's measurement")
      .toBeLessThan(MEASURED_WALL_BAND_L * 3);
    expect(
      v.some((x) => x.wallBandMeanL > MEASURED_WALL_BAND_L * 3),
      "at least one candidate must move the wall band materially above the control",
    ).toBe(true);
  });

  it("(3) NET: the change is on the PRODUCT path, and no room GLB is replaced", () => {
    // Refuses (c) — #249: never brighten the grading instrument instead of the product. And (d) —
    // the rooms campaign is closed; door-leaf 5c81ffd5 and the shipped Infinigen set stay untouched.
    const capture = readFileSync(CAPTURE_SHADOW, "utf8");
    expect(
      /isCaptureShadowPath[\s\S]{0,200}(Ambient|Hemisphere|fill)/i.test(capture),
      "no fill light may be hidden behind the capture-only shadow path",
    ).toBe(false);
    expect(existsSync(MAIN), "the product lighting rig lives in main.ts").toBe(true);
    expect(existsSync(join(ENV, "infinigen-primary-care-clinic.glb")), "shipped room still present").toBe(true);
  });
});
