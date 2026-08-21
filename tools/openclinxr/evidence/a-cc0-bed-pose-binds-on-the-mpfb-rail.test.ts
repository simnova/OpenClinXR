import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #492 DURABLE PATH — can a CC0 recumbent BVH drive the MPFB rail? **Measure-only.
 * `reject_measured` closes this successfully.**
 *
 * ## WHY THIS EXISTS
 *
 * `#495` graded the ablation: the 17 `SUPINE_BONE_EULERS`, tuned against the 23-bone Anny rest
 * pose, ARE the crumple on MPFB. `#496` (in flight, separate worker) ships `root_only` as an INTERIM
 * so four learner stations stop showing refuse. `root_only` is a person but a **stiff plank** — arms
 * slightly out, no elbow or knee flex. The durable answer is a real recumbent pose.
 *
 * The alternative was hand-authoring an MPFB-native euler table. A read-only researcher found a
 * proven asset first, which is the whole point of running one (D1: wire it, do not hand-author).
 *
 * ## WHAT THE TREE ALREADY HAS — MEASURED THIS TICK, IMMUTABLE
 *
 * More is built than anyone in this chain had said. Four of the five pieces exist:
 *
 *   `motion_bind_stage.py:8`   usage is literally
 *                              `--actor <mpfb.glb> --clip <walk.bvh> --map <mpfb2-default-no-toes.json>`
 *   `:37`                      `--map` is a REQUIRED arg; `:89 _inject_target_map` loads a custom
 *                              target map into `retarget_bvh` via `CTargetInfo.readFile`
 *   `known-rigs/mpfb2-default-no-toes.json`   COMMITTED. Maps MPFB names to canonical:
 *                              `root->hips`, `spine05->spine`, `spine03->chest`, `neck01->neck`,
 *                              `clavicle.L->shoulder.L`, `upperarm01.L->upper_arm.L`,
 *                              `lowerarm01.L->forearm.L`
 *   `motion-bind-stage.test.ts`  an existing contract: *"fails if the stage output clip is missing
 *                              or has zero channels"*
 *   `retarget-drives-the-library-rig.test.ts:71`  `retarget_bvh` PROVEN headless — a CMU walk onto
 *                              the hm08 rig, 65 frames, 26 driven bones
 *
 * **The missing piece is a recumbent CLIP.** Everything else is wired.
 *
 * ## A CAVEAT THAT IS TRUE BUT NARROWER THAN IT SOUNDS
 *
 * `retarget-drives-the-library-rig.test.ts:22-24` measured target-map coverage:
 *
 *   hm08 library bodies    64 joints   **52/52**
 *   mpfb-ob-patient-aisha 137 joints   **0/52**
 *   peds_anxious_parent    23 joints     0/52
 *
 * That is the **stock Mixamo** target map. It says nothing about `mpfb2-default-no-toes.json`, which
 * this repo built for exactly this reason. **My licence-ledger row originally claimed the CC0 BVH is
 * "hm08-native, no retarget required" — the superagent corrected that, and this table is why.**
 * TARGET side looks solved; the **SOURCE** map for a MakeHuman-authored BVH is the open question.
 *
 * ## THE ASSET, NOT ACQUIRED
 *
 * `Laying on Bed 001/002` -> `Laying on Back 0001.bvh` / `0002.bvh`, **VERIFIED CC0 on both pages**
 * (`makehumancommunity.org/content/laying_on_bed_001.html`). 001: *"laying on bed with arms to the
 * sides, head & neck tilted up to rest on pillow"*; 002 also raises the knees. Ledger rows exist;
 * nothing downloaded.
 *
 * ## WHAT THIS MUST DISTINGUISH (SS10t)
 *
 * > **Does a CC0 recumbent BVH drive the MPFB rig through the existing stage — and does the result
 * > grade better than `root_only`?**
 *
 * `bound_and_better`, `bound_but_not_better`, `reject_measured` (it does not bind) and `other` are
 * ALL successful closes. **Do not make one outcome happen.**
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) report | (2) licence | (3) no hand-author | result
 *   ------------------------------------------------|------------|-------------|--------------------|--------
 *   a) today — no attempt                            |  **FAIL**  |    pass     |       pass         | REFUSED
 *   b) acquire without reading the .bvh header       |    pass    |  **FAIL**   |       pass         | REFUSED
 *   c) hand-author an MPFB euler table instead       |    pass    |    pass     |     **FAIL**       | REFUSED
 *   d) run the existing stage with the existing map  |    pass    |    pass     |       pass         | ALL PASS
 *
 * **(b) is the one to watch.** This site has served page-CC0 over an **AGPL3 header** (`mhair02`)
 * and page-CC0 over **MIXED** contents (`hair01`). A page badge is not a licence. Clause (2)
 * requires the header read and recorded, whatever it says — **an AGPL header is a `reject_measured`,
 * not a problem to work around.**
 *
 * **(c)** is the thing the researcher superseded. Clause (3) pins `SUPINE_BONE_EULERS` unchanged so
 * this slice cannot quietly become the euler-authoring slice it replaced.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today.
 * (4) is a vacuity guard.
 *
 * NOT TESTED: whether the pose looks clinically right — that is the orchestrator's grade, against
 * `#495`'s `root_only` cell as the known-good. Incline follow and HOB articulation, which stay with
 * the deck plant (`#494`). `seated`. The other 13 stations.
 */

/**
 * ## FIXED (#497)
 *
 * Measured 2026-08-20, MEASURE ONLY — `reject_measured` (this closes successfully).
 *
 * The CC0 recumbent BVH does NOT bind on the MPFB rail through the existing stage and map.
 * `motion_bind_stage.py` ran the full path — actor imported (137 pose bones), target map injected
 * (target identified as `MPFB2 default_no_toes`), `mcp.load_and_retarget` invoked — and the target
 * armature ended with `action=None`, `drivenBoneCount=0`, stage verdict `zero_or_thin_channels`.
 *
 * Root cause is the SOURCE map, the open question #492 named: retarget_bvh source-rig
 * auto-identification misidentifies the MakeHuman `breast.L`/`breast.R` leaf joints as shoulders and
 * raises `Shoulder breast.R has no children` (retarget_bvh armature.py:215) before any action is baked.
 *
 * Two further findings, both recorded in the report:
 * - The asset is a SINGLE-FRAME pose (`Frames: 1`), not a motion clip — even a successful retarget
 *   would face the stage's `_driven_bones` ≥2-keyframe / >0.01 rad-delta filter (motion_bind_stage.py).
 * - The .bvh file contains NO licence line anywhere in its 1016 lines; the page states `License: CC0`.
 *
 * Pre-existing environment issue (NOT this slice): `_import_actor` (motion_bind_stage.py:77) crashes
 * on every shipped MPFB actor in Blender 5.1 — the glTF `weights` animation
 * `ClinicalExpressionMicroTransition` raises `IndexError` in `animation_weight.py:73`. The measurement
 * above stripped the actor's animations (armature-only) into a temp GLB to reach the bind path; this
 * regression blocks the stage on the shipped actors independently of the source-map result.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const REPORT = join(HERE, "cc0-bed-pose-bind-report.json");
const SUPINE_SRC = join(REPO_ROOT, "apps/ui-xr/src/supine-pose.ts");
const MPFB_MAP = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json");

const VERDICTS = ["bound_and_better", "bound_but_not_better", "reject_measured", "other"] as const;

type Report = {
  schemaVersion: string;
  verdict: (typeof VERDICTS)[number];
  verdictNote?: string;
  /** Verbatim licence text READ FROM THE .bvh / archive, not from the pack page. */
  headerLicence: string;
  sourceUrl: string;
  targetMap: string;
  drivenBoneCount: number;
  obtainedBy: string;
};

function requireReport(): Report {
  expect(existsSync(REPORT), `${REPORT} must exist`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("a CC0 recumbent BVH is measured against the MPFB rail", () => {
  it("(1) RED: the bind was attempted and a verdict recorded", () => {
    const r = requireReport();
    expect(VERDICTS as readonly string[], `verdict was ${JSON.stringify(r.verdict)}`).toContain(r.verdict);
    if (r.verdict === "other") {
      expect(r.verdictNote?.length ?? 0, "'other' requires a note (SS7c escape value)").toBeGreaterThan(20);
    }
    expect(
      /motion_bind_stage|retarget_bvh|load_and_retarget/.test(r.obtainedBy ?? ""),
      `obtainedBy must name the real bind path; got ${JSON.stringify(r.obtainedBy)}`,
    ).toBe(true);
    // A bind that claims success must say how many bones it actually drove — the existing
    // motion-bind contract already refuses a zero-channel clip.
    if (r.verdict.startsWith("bound")) {
      expect(r.drivenBoneCount, "a bound clip drives bones; zero channels is not a bind").toBeGreaterThan(0);
    }
  });

  it("(2) COUNTERWEIGHT: the header licence was read and recorded, whatever it says", () => {
    // Refuses (b). mhair02 was page-CC0 with an AGPL3 header; hair01 page-CC0 with MIXED contents.
    // Same site. An AGPL header is a reject_measured, not an obstacle to route around.
    if (!existsSync(REPORT)) return;
    const r = requireReport();
    expect(r.headerLicence?.length ?? 0, "headerLicence must be the text READ FROM THE FILE").toBeGreaterThan(1);
    expect(
      /page says|pack page|assumed|per the website/i.test(r.headerLicence ?? ""),
      "headerLicence must not restate the pack page — read the .bvh/archive header",
    ).toBe(false);
    expect(r.sourceUrl?.includes("makehuman"), "record where it came from").toBe(true);
  });

  it("(3) COUNTERWEIGHT: no euler table was hand-authored", () => {
    // Refuses (c) — the plan this slice replaced. The 17 authored keys stay exactly as they are;
    // #496 owns the rail switch and this slice must not become the euler-authoring slice.
    const src = readFileSync(SUPINE_SRC, "utf8");
    for (const b of ["pelvis", "spine", "chest", "thighL", "upper_armL", "neck", "head"]) {
      expect(src.includes(`["${b}"`), `SUPINE_BONE_EULERS must still author "${b}"`).toBe(true);
    }
  });

  it("(4) VACUITY GUARD: the MPFB target map this rests on still ships", () => {
    // If the map vanished, clause (1) would be unachievable rather than merely red, and this says so.
    expect(existsSync(MPFB_MAP), "known-rigs/mpfb2-default-no-toes.json is the target-side answer").toBe(true);
    const m = JSON.parse(readFileSync(MPFB_MAP, "utf8")) as { bones?: Record<string, string> };
    expect(Object.keys(m.bones ?? {}).length, "the map must carry bone entries").toBeGreaterThan(5);
    expect(m.bones?.["root"], "root must map — it is the on-back basis carrier").toBeTruthy();
    expect(new Set(VERDICTS).size, "the vocabulary can express a loss").toBeGreaterThan(1);
  });
});
