import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The parent and nurse comparator captures photograph the PATIENT. Both frames show the same child,
 * and nothing in the artifact records which actor the camera was aimed at — so the mislabelling is
 * invisible to every gate and was only caught by a human opening the PNGs.
 *
 * MEASURED 2026-08-11, live scene world positions:
 *
 *   patient_maya_johnson_character   (-0.12, 0.01, -1.05)
 *   nurse_kevin_lee_character        ( 1.25, 0.04, -0.72)
 *   parent_tara_johnson_character    (-1.35, 0.08,  0.42)
 *
 * Both the `peds_anny_real_garment_parent` and `..._nurse` branches in `main.ts` hardcode
 * `camera.position.set(0, 1.05, 2.55)` / `lookAt(0, 0.95, 0)` under a comment reading "center primary
 * humanoid (x≈0)". The origin is nearest the PATIENT. At 2.55 m with fov 42 the frame half-width is
 * 2.55·tan(21°) ≈ 0.98 m, so a subject 1.25–1.35 m off-axis is outside the frustum entirely. The two
 * captures came out as near-identical children at 73,172 and 73,442 bytes.
 *
 * TWO FIXES WERE TRIED BY HAND AND BOTH REVERTED. Recorded so they are not retried:
 *   1. Deriving the target from `runtimeActorPlacement(actorId).position` — those coordinates are NOT
 *      the world frame. The camera aimed at empty space and produced a 7,479-byte BLANK png.
 *   2. Hardcoding the measured world positions as literals — parent rendered (51 kB) but nurse still
 *      blank (7.5 kB). Per-actor magic numbers do not survive an actor moving, and there are more
 *      actors coming.
 *
 * THE PROVEN TOOL IS ALREADY IN THE REPO (D1). `apps/ui-xr/src/isolated-subject-lab.ts:255`
 * `frameCamera(camera, bounds, view)` takes a `Box3`, derives centre and size, and iterates distance
 * until the subject occupies `PACK_FRAME_TARGET` of the frame — the standard fit-to-bounds solve. It
 * is what makes the isolated posture renders correctly framed with no authored numbers. The full-scene
 * comparator branches should call the same math against the named actor's bounds, AFTER the actor
 * loads — which is why construction-time literals were always going to fail: the camera is built at
 * `main.ts:3215`, before any humanoid exists.
 *
 * WHY THIS CONTRACT ASSERTS ON RECORDED INTENT, NOT PIXELS. A test cannot see a picture, and byte size
 * is not identity — the two wrong frames differed by 270 bytes while showing the same subject. What is
 * checkable is whether the capture RECORDS the actor it framed, and whether that recording differs
 * between two runs that name different actors. That turns a defect only a human could catch into one a
 * gate can.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                  | (1) records target | (2) differs per run | result
 *   -------------------------------------------|--------------------|---------------------|--------
 *   a) today — no field at all                 |       FAIL         |        FAIL         | REFUSED
 *   b) record a constant actor id              |       pass         |      **FAIL**       | REFUSED
 *   c) record the comparator string as "target"|       pass         |        pass         | see (3)
 *   d) frame the named actor's bounds          |       pass         |        pass         | ALL PASS
 *
 * (c) is why (3) exists: echoing the comparator name back proves nothing about the camera. (3) requires
 * the recorded target to be an ACTOR ID that appears in the same run's loaded-asset list, so the field
 * has to come from the scene rather than from the URL.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2) and (3) are REDs and fail today — the field does
 * not exist. (4) PASSES today and is the known-good column: the capture already exits zero and writes
 * both frames (that was #314), and a framing fix must not regress it.
 *
 * NOT TESTED: whether the resulting frame is well composed, or whether the actor is fully in shot
 * rather than clipped at an edge. This asserts the camera was aimed at the right subject and recorded
 * it. Judging the picture remains a human grade — which is how this defect was found.
 */
/**
 * ## FIXED (#315)
 *
 * The camera is no longer framed by construction-time literals. The fit-to-bounds solve was
 * extracted from the isolated-subject-lab into `apps/ui-xr/src/camera-fit-to-bounds.ts` (D1 reuse)
 * and is called from `loadGeneratedHumanoidIntoActorSlot` AFTER the named actor loads: the parent
 * comparator frames `runtimeFamilyActorId()`, the nurse comparator frames
 * `runtimeClinicalTeamActorId()`, both via the loaded humanoid's world AABB (front view, 80% pack
 * target). The solve is parent-aware: the comparator camera lives under the locomotion rig
 * (z=-0.62 for `openclinxrPortalStart=encounter`), so `frameCamera` subtracts the parent's world
 * position and solves in camera-local space; isolated-lab cameras have no parent and are unchanged.
 *
 * Recorded intent: `window.__openClinXrComparatorCameraTargetActorId` is set to the framed actor's
 * MODEL assetId (`parent_tara_johnson_character` / `nurse_kevin_lee_character`) — the same value
 * `recordSceneAssetStatus` writes into the loaded-asset list, so rule (3) matches by construction
 * and echoing the comparator string back would fail. `ui-xr-parent-nurse-sleeve-deform-capture.ts`
 * copies it into each run's inspection.json entry. The two hand-fixed literals from the header
 * remain reverted; no per-actor magic numbers survive.
 *
 * ## FIXED (#315) — follow-up: framing measurement + named-subject visibility
 *
 * The first landing framed the named actor's camera correctly (aim NDC x = 0.000) yet the
 * frames showed a small figure at the OPPOSITE edge. The measurement (framingDump per run in
 * inspection.json) showed the cause: the named actor's SLOT was hidden for clean comparator
 * capture (`nurse.visible=false` / `spouse.visible=false`), so the only visible humanoid — the
 * patient — rendered at the frame edge relative to the new side aim. The camera was never wrong;
 * its subject was invisible. Fixed by making the comparator's NAMED subject the only visible
 * actor (`comparatorCaptureSubjectActorId`: parent→family, nurse→clinical, patient comparators→
 * patient), applied to the four slot-visibility blocks AND the mouth-gaze review slot-hide,
 * which previously hard-hid every non-patient actor and re-blanked the frame (7,479-byte PNG)
 * after the slot-visibility change. Measured post-fix, per run (framingDump): parent
 * ndcBoundsCenter (0, -0.073), nurse (0, -0.074); frameSpanFraction 0.80 both; only the named
 * slot visible in each run; front frames 130,414 / 122,375 bytes (both > 20 kB). The room the
 * pre-fix frames appeared to show is not in this capture's pixel data — pre-fix frames were
 * 4.0% non-background (the child figure) on the same flat theme background; the clean-source
 * policy has always hidden station/floor/exterior.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CAPTURE_DIR = join(
  REPO_ROOT,
  ".openclinxr/evidence/ui-xr-parent-nurse-sleeve-deform-2026-08-02",
);
const INSPECTION = join(CAPTURE_DIR, "inspection.json");

type Run = {
  label?: string;
  comparator?: string;
  cameraTargetActorId?: string;
  sceneAssets?: { assets?: Array<{ assetId?: string; status?: string }> };
};

/** The artifact keys runs by label: `{ parent: {...}, nurse: {...} }` — not a `runs` array. */
function runs(): Run[] {
  if (!existsSync(INSPECTION)) return [];
  const parsed = JSON.parse(readFileSync(INSPECTION, "utf8")) as Record<string, unknown>;
  return (["parent", "nurse"] as const)
    .map((label) => {
      const entry = parsed[label];
      return entry && typeof entry === "object" ? ({ label, ...(entry as Run) }) : null;
    })
    .filter((r): r is Run => r !== null);
}

/** Every clause guards on this: an empty artifact must FAIL, never pass vacuously (§7t). */
function requireBothRuns(rows: Run[]): void {
  expect(rows.map((r) => r.label).sort(), "both comparator runs present in inspection.json")
    .toEqual(["nurse", "parent"]);
}

const captured = runs();

describe("a comparator capture records the actor it framed", () => {
  it("(1) RED: every run records a cameraTargetActorId", () => {
    expect(captured.length, "runs recorded in inspection.json").toBeGreaterThanOrEqual(2);
    const missing = captured
      .filter((r) => !r.cameraTargetActorId)
      .map((r) => `${r.label ?? r.comparator ?? "?"}: no cameraTargetActorId`);
    expect(missing, "runs with no recorded camera target").toEqual([]);
  });

  it(
    "(2) RED COUNTERWEIGHT: the parent and nurse runs record DIFFERENT actors — one constant is refused",
    () => {
        requireBothRuns(captured);
      const targets = captured.map((r) => r.cameraTargetActorId ?? null);
      expect(targets.every((t) => typeof t === "string" && t.length > 0), `targets: ${targets.join(", ")}`)
        .toBe(true);
      expect(new Set(targets).size, `distinct camera targets across runs: ${targets.join(", ")}`)
        .toBe(captured.length);
    },
  );

  it(
    "(3) RED COUNTERWEIGHT: the recorded target is an ACTOR present in that run's loaded assets — echoing the comparator name is refused",
    () => {
      requireBothRuns(captured);
      const broken: string[] = [];
      for (const r of captured) {
        const target = r.cameraTargetActorId;
        const loaded = (r.sceneAssets?.assets ?? [])
          .filter((a) => a.status === "loaded")
          .map((a) => a.assetId ?? "");
        if (!target) {
          broken.push(`${r.label ?? "?"}: no target`);
          continue;
        }
        if (!loaded.some((id) => id.includes(target) || target.includes(id))) {
          broken.push(`${r.label ?? "?"}: target "${target}" is not a loaded actor (${loaded.join(", ")})`);
        }
      }
      expect(broken, "recorded targets that are not scene actors").toEqual([]);
    },
  );

  it("(4) NET known-good: the capture still produces a front frame for BOTH actors", () => {
    for (const label of ["parent", "nurse"]) {
      const p = join(CAPTURE_DIR, `${label}_real_garment_sleeve_front_2026-08-02.png`);
      expect(existsSync(p), `${label} front frame exists`).toBe(true);
      const bytes = readFileSync(p).byteLength;
      // 7.4 kB was the blank frame produced by a bad camera target; a rendered subject is far larger.
      expect(bytes, `${label} front frame is not a blank render (${bytes} bytes)`).toBeGreaterThan(20_000);
    }
  });
});
