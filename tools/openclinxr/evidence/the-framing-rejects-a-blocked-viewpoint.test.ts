/**
 * #503 — the capture framing ALREADY rejects viewpoints whose eye→look ray crosses room geometry.
 * It works on four stations and returned an EMPTY rejection list for the one station where a
 * near-black panel demonstrably fills the frame.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#503)` block below; do not rewrite these tables.
 *
 * THE MECHANISM, located by #500 and re-verified by me against the tree:
 *   infinigen-ed-stroke-bay.glb -> wall mesh Circle.022 -> primitive[1], 25 tris,
 *   material shader_dark_art.001, baseColour text_texture = 400x400, median 0, p90 0,
 *   92.6% pure black. Live: full-height panel, x[-1.50,-1.39] y[0,2.425] z[-0.963,2.537].
 *   Capture eye (-3.162,1.643,2.312) -> look (0.25,0.80,0.27) crosses x=-1.44 at z~1.29,
 *   inside that panel's z span.
 *
 * THE REJECTION THAT DID NOT FIRE — ui-xr-environment-room-capture.ts:769-800, per-triangle
 * eye→look intersection over roomRoot, its own comment: "eye→look ray crosses a room
 * wall/floor/ceiling/exterior OR a door-leaf AABB before the look point."
 *
 *   station                              rejected=
 *   adult_abdominal_pain_v1              "-0.0/2.1"
 *   ob_headache_preeclampsia_triage_v1   "2.8/1.6"
 *   oncology_bad_news_family_v1          "2.5/1.8"
 *   peds_asthma_parent_anxiety_v1        "-2.4/1.9"
 *   ed_stroke_alert_handoff_v1           ""          <- EMPTY
 *
 * So this is not "build a rejection test" — one exists, it is proven on four stations, and it
 * produced nothing here (D1: the wired component makes no usable output).
 *
 * VIEWPORT LUMINANCE (y 70:820, x 0:1005; HUD starts ~1020px), re-measured twice independently:
 *   ward_delirium_med_rec_v1          median 28  (known-good)
 *   postop_fever_consult_pressure_v1  median 26-27 (known-good)
 *   ed_stroke_alert_handoff_v1        median  0  (treatment)
 * p90 is BLIND (136/152/141) — the lit doorway and actors are as bright in the bad frame.
 *
 * TWO UNRANKED CANDIDATES, and they may both be wrong (§6l). I did not distinguish them:
 *   - the ray genuinely misses the panel and it merely fills the periphery
 *   - the per-triangle test does not reach primitive[1] of a multi-primitive room mesh
 * Do not take a rank from me: six of my hypotheses died on this station before #500 located it.
 *
 * ALSO: the function's docstring is STALE. It says `eyeX = centre X of the actor bounds` and
 * `look = centre of the actor bounds`; the code scores interior corners and edge midpoints by
 * distance to the NEAREST actor box. Measured eye X -3.16 vs look X +0.25 cannot both be the
 * actor centre. Correct the docstring where it is stated (§7q), do not append to it.
 *
 * claimScope: whether every shipped station's capture is bright enough to grade, with the dark
 *             panel still present and the camera still inside the room.
 * notEvidenceFor: clinical realism, Quest readiness, or that this is the only cause of a dark frame.
 *
 * ## FIXED (#503) — 2026-08-21
 *
 * `it.fails` flipped. `reframeCameraForRoom`'s occlusion walk now classifies a room-surface mesh
 * by its own name OR its nearest ancestor up to roomRoot (a multi-primitive GLB wall wraps its
 * primitives in a Group carrying e.g. bedroom_0/1.wall while the primitives are named Circle022 /
 * Circle022_1), and treats a wall the camera stands OUTSIDE of as a solid partition (world-AABB
 * reject) rather than per-triangle — so the eye→look ray cannot pass through the dark wall's
 * doorway to the cast.
 *
 * MEASURED LIVE (framing-rejection-report.json, tracked):
 *   ward_delirium_med_rec_v1      median 28, p90 133, rejected [-4.3/3.0], panel false
 *   ed_stroke_alert_handoff_v1    median 24, p90  69, rejected [-3.2/2.3, -1.6/2.3], panel true
 * Both cameras inside; the dark panel (shader_dark_art) stays present and visible. The previously
 * chosen -3.16 corner is now rejected and the capture picks +3.27, on the cast's side of the panel.
 */
import { describe, expect, it } from "vitest";

const KNOWN_GOOD = "ward_delirium_med_rec_v1";
const TREATMENT = "ed_stroke_alert_handoff_v1";
const REPORT = "tools/openclinxr/evidence/framing-rejection-report.json";

type Row = { median: number; p90: number; cameraInsideInterior: boolean; darkPanelPresentAndVisible: boolean;
  rejectedViewpoints: string[] };

async function load(): Promise<Record<string, Row>> {
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync(REPORT)) throw new Error(`${REPORT} missing — the capture must write it (TRACKED path, #396)`);
  return (JSON.parse(readFileSync(REPORT, "utf8")) as { stations: Record<string, Row> }).stations;
}

describe("#503 the framing rejects a viewpoint blocked by room geometry", () => {
  it("(1) BOTH stations capture bright enough to grade — median >= 12", async () => {
    const s = await load();
    for (const id of [KNOWN_GOOD, TREATMENT]) {
      expect(s[id], `${id} missing from the report`).toBeTruthy();
      expect(s[id]!.median, `${id} viewport median`).toBeGreaterThanOrEqual(12);
    }
  });

  it(
    "(2) COUNTERWEIGHT: the known-good station is not brightened to get there — it stays in band 18..45",
    async () => {
      const s = await load();
      expect(s[KNOWN_GOOD]!.median).toBeGreaterThanOrEqual(18);
      expect(s[KNOWN_GOOD]!.median).toBeLessThanOrEqual(45);
    },
  );

  it(
    "(3) COUNTERWEIGHT: the dark panel is STILL in the scene and STILL visible — it is legitimate wall art, not the thing to delete",
    async () => {
      const s = await load();
      expect(s[TREATMENT]!.darkPanelPresentAndVisible, "shader_dark_art panel must not be hidden or removed").toBe(true);
    },
  );

  it(
    "(5) THE MECHANISM, not the outcome: the rejection actually FIRES on the blocked station — today its list is empty",
    async () => {
      const s = await load();
      // A camera that happens to land somewhere brighter is not this fix. The existing
      // per-triangle eye->look test must reject at least one candidate viewpoint here, as it
      // already does on adult_abdominal_pain, ob_headache, oncology and peds_asthma.
      expect(Array.isArray(s[TREATMENT]!.rejectedViewpoints)).toBe(true);
      expect(s[TREATMENT]!.rejectedViewpoints.length,
        "ed_stroke rejected nothing while a 25-tri black panel filled the frame").toBeGreaterThan(0);
    },
  );

  it(
    "(4) COUNTERWEIGHT: the camera stays INSIDE the measured interior for both stations",
    async () => {
      const s = await load();
      for (const id of [KNOWN_GOOD, TREATMENT]) expect(s[id]!.cameraInsideInterior, `${id} camera inside`).toBe(true);
    },
  );
});
