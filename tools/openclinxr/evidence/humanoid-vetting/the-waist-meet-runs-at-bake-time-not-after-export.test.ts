/**
 * Waist-meet at bake time (diagnosis): the street actor's shirt-to-waistband
 * meet was produced by apply-waist-meet-glb.ts on exported Y-up vertices
 * (name-matched push, no hm08 indices). Operator 2026-09-12: garment fitting
 * must use the MakeClothes path in MakeHuman BODY SPACE.
 *
 * Diagnosis (measured 2026-09-12, instrument-only). Bake-time
 * `fit_upper_hem_to_waistband` while hm08 + mhclo bindings were live
 * (materialize_mpfb_humanoid_candidate.py, street skip already withdrawn):
 *
 * | subject | triangles | jeans tris | gapped | buckets | minMm | stage |
 * |---|---:|---:|---:|---:|---:|---|
 * | bake-time GLB (not shipped) | 115552 | 5708 | 1 | 34 | -22.08 | fit_upper_hem_to_waistband |
 * | live shipped | 115552 | 5708 | 0 | 31 | +5.0 | post-export apply-waist-meet-glb |
 *
 * The bake reproduces the HB-03 triangle count exactly and keeps
 * elvs_jeans_straight_leg (2,854 faces → 5,708 tris). It does not reach
 * 0 gapped / +5.0 mm. That shortfall is a bake-path finding; a post-export
 * patch is not applied to hide it. Live shipped bytes stay the 2026-09-12
 * GLB push.
 *
 * This clause asserts the REPORT and that the set of actors whose provenance
 * records a CURRENT post-export waist-meet (`waistMeet.stage ===
 * "post_export_glb"`) is a subset of a frozen allow-list that does not grow.
 *
 * NOT TESTED: whether a later bake closes the remaining bucket; whether any
 * other actor would need the post-export path; the cover-shell actors.
 *
 * ## FIXED (#0)
 *
 * Allow-list is frozen at `mpfb-street-adult-male` only (the one actor whose
 * live bytes still record post-export). Growth of the list or of the recorded
 * set fails closed. Report: street-waist-meet-at-bake-time-2026-09-12.md.
 * Diagnosis table is unchanged.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REPORT = join(HERE, "street-waist-meet-at-bake-time-2026-09-12.md");
const HUMANOIDS = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const GLB_STAGE = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts",
);
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const NURSE_GLB = join(HUMANOIDS, "mpfb-clinical-nurse-adult.glb");
const STREET_GLB = join(HUMANOIDS, "mpfb-street-adult-male.glb");

/**
 * Frozen. The only actor whose live bytes still record a post-export waist-meet
 * (bake-time 2026-09-12 measured gapped 1 / min -22.08 mm and was not shipped).
 * Adding a name here is how the list grows — this equality is the fence.
 */
const POST_EXPORT_WAIST_MEET_ACTOR_ALLOWLIST = ["mpfb-street-adult-male"] as const;

type Provenance = {
  waistMeet?: { stage?: string };
};

function recordedPostExportActors(): string[] {
  return readdirSync(HUMANOIDS)
    .filter((f: string) => f.endsWith(".provenance.json"))
    .flatMap((f: string) => {
      const raw = JSON.parse(readFileSync(join(HUMANOIDS, f), "utf8")) as Provenance;
      if (raw.waistMeet?.stage === "post_export_glb") {
        return [f.replace(/\.provenance\.json$/u, "")];
      }
      return [];
    })
    .sort();
}

function triangleCount(glbPath: string): number {
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes?: { primitives?: { indices?: number }[] }[];
    accessors?: { count?: number }[];
  };
  let total = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const count = prim.indices !== undefined ? json.accessors?.[prim.indices]?.count : undefined;
      if (count !== undefined) total += count / 3;
    }
  }
  return Math.round(total);
}

describe("the waist-meet runs at bake time not after export", () => {
  it("report exists and records the bake-time shortfall", () => {
    expect(existsSync(REPORT), `${REPORT} exists`).toBe(true);
    expect(statSync(REPORT).size, "min-bytes 900").toBeGreaterThanOrEqual(900);
    const text = readFileSync(REPORT, "utf8");
    expect(text.includes("gapped | 1"), "report records bake-time gapped: 1").toBe(true);
    expect(text.includes("minMm | -22.08"), "report records bake-time minMm: -22.08").toBe(true);
    expect(text.includes("115552"), "report records triangle count 115552").toBe(true);
    expect(text.includes("NOT TESTED"), "report has NOT TESTED").toBe(true);
    expect(text.includes("apply-waist-meet-glb"), "report names the GLB stage").toBe(true);
  });

  it("the post-export actor set is a subset of a frozen allow-list that does not grow", () => {
    expect(
      POST_EXPORT_WAIST_MEET_ACTOR_ALLOWLIST,
      "allow-list is frozen; adding a name is how it grows",
    ).toEqual(["mpfb-street-adult-male"]);
    expect(POST_EXPORT_WAIST_MEET_ACTOR_ALLOWLIST.length, "allow-list length frozen at 1").toBe(1);
    const recorded = recordedPostExportActors();
    const extra = recorded.filter(
      (a) => !(POST_EXPORT_WAIST_MEET_ACTOR_ALLOWLIST as readonly string[]).includes(a),
    );
    expect(extra, "provenance recorded a post-export waist-meet for an actor not on the allow-list").toEqual(
      [],
    );
    expect(recorded, "street still records the live post-export stage").toEqual([
      "mpfb-street-adult-male",
    ]);
  });

  it("the materializer does not call the post-export GLB stage", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src, "bake path still calls fit_upper_hem_to_waistband").toContain("fit_upper_hem_to_waistband");
    expect(src, "bake path must not import apply-waist-meet-glb").not.toContain("apply-waist-meet-glb");
    expect(existsSync(GLB_STAGE), "GLB stage kept as diagnostic; this card does not delete it").toBe(true);
  });

  it("COUNTERWEIGHT: nurse triangle count and street jeans mesh stay put", () => {
    expect(existsSync(NURSE_GLB), "nurse GLB exists").toBe(true);
    expect(triangleCount(NURSE_GLB), "nurse stays 38,958 triangles").toBe(38958);
    expect(existsSync(STREET_GLB), "street GLB exists").toBe(true);
    expect(triangleCount(STREET_GLB), "street stays the HB-03 115,552-triangle exception").toBe(115552);
    const streetBytes = readFileSync(STREET_GLB);
    const jsonLength = streetBytes.readUInt32LE(12);
    const json = JSON.parse(streetBytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
      meshes?: { name?: string; primitives?: { indices?: number }[] }[];
      accessors?: { count?: number }[];
    };
    const jeans = (json.meshes ?? []).find((m) => /straight_leg_jeans/i.test(m.name ?? ""));
    expect(jeans, "street lower is still elvs straight-leg jeans").toBeDefined();
    let jeansTris = 0;
    for (const prim of jeans?.primitives ?? []) {
      const count = prim.indices !== undefined ? json.accessors?.[prim.indices]?.count : undefined;
      if (count !== undefined) jeansTris += count / 3;
    }
    expect(Math.round(jeansTris), "street jeans stay 5,708 tris (2,854 faces × 2)").toBe(5708);
  });
});
