import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractLandmarks } from "./anny-mpfb-landmark-compare.ts";

/**
 * #297's landmark instrument measures stature EXACTLY and waist girth increasingly WRONG.
 *
 * MEASURED 2026-08-10, two instruments on the same two bodies. `anny.Anthropometry` is native to the
 * Anny package (installed this session) and computes `waist_circumference` from the model itself; the
 * mesh instrument computes it from exported geometry. Neither derives from the other.
 *
 *   body              | landmark | mesh instrument | anny native | delta
 *   ------------------|----------|-----------------|-------------|--------
 *   lean, BMI 20.63   | stature  |          1.7800 |      1.7800 |  0.0000
 *   lean, BMI 20.63   | waist    |          0.7533 |      0.7976 | -0.0443
 *   BMI 45.00         | stature  |          1.7800 |      1.7800 |  0.0000
 *   BMI 45.00         | waist    |          0.9756 |      1.3992 | -0.4236
 *
 * Stature agreeing to 0.0000 on both bodies is what makes this a waist defect rather than a broken
 * instrument: the parse, the units, the up-axis and the floor reference are all demonstrably right.
 * The waist error is 4 cm on a lean body and 42 cm at BMI 45 — it GROWS WITH BODY SIZE. MADR 0051's
 * whole purpose is matching a BMI-45 subject, so the instrument is least trustworthy exactly where the
 * protocol needs it.
 *
 * THE CHEAP FIX THIS CONTRACT REFUSES — proven analytically, not by probe:
 *
 *   lean  ratio mesh/native = 0.9445
 *   BMI45 ratio mesh/native = 0.6973
 *
 * A single constant scale cannot satisfy both, and the two contracts below pin both ends:
 *   scale 1.0588 (fixes lean)  -> BMI45 becomes 1.0330 against native 1.3992  (36 cm short)
 *   scale 1.4342 (fixes BMI45) -> lean  becomes 1.0804 against native 0.7976  (28 cm over)
 * Any correction must be shape-dependent. A calibration constant is refused by construction.
 *
 * WHICH PROOFS ARE REDS AND WHICH ARE REGRESSION NETS (#227):
 *   (1) and (2) are the REDs — they fail today and are the defect.
 *   (3) and (4) PASS today and are nets: stature must stay exact, and #297's arm-exclusion
 *   counterweight must keep holding. A "fix" that reaches the waist band by re-admitting arm
 *   geometry would green (1) and (2) and break (4).
 *
 * MESHES: regenerated from `anny` at test time rather than committed, so the comparison is always
 * against the live package. This test therefore REQUIRES `anny` installed — a stated dependency of
 * MADR 0051, satisfied on this machine 2026-08-10.
 *
 * NOT TESTED: whether `anny.Anthropometry.waist_circumference` is itself correct. It is treated as the
 * reference because it is the package's own measurement of its own body, not because it has been
 * validated against a human. If the two disagree it is possible in principle that Anny is wrong; the
 * error growing with size makes the mesh side the likelier suspect, and that is a judgement, not a
 * measurement.
 */

const OUT_DIR = "/Volumes/files/src/openclinxr/.openclinxr/evidence/issue-298";
const BAND_M = 0.02; // MADR 0051 §5 — ordinary tape tolerance, an external floor, not fitted.

type Subject = { tag: string; weight: number; nativeWaist: number; nativeStature: number };

/** Solved 2026-08-10: height=0.7081 gives 1.780 m; weight 5.0663 gives BMI 45.00. */
const SUBJECTS: Subject[] = [
  { tag: "lean", weight: 1.0, nativeWaist: 0.7976, nativeStature: 1.78 },
  { tag: "bmi45", weight: 5.0663, nativeWaist: 1.3992, nativeStature: 1.78 },
];

/** Regenerate both bodies from anny, ground feet at y=0, and return native measurements. */
function generate(): Map<string, { objPath: string; waist: number; stature: number }> {
  mkdirSync(OUT_DIR, { recursive: true });
  const script = `
import anny, warnings, numpy as np, torch, json
warnings.filterwarnings("ignore")
m = anny.create_fullbody_model(triangulate_faces=True, extrapolate_phenotypes=True)
a = anny.Anthropometry(m)
R = np.array([[1,0,0],[0,0,1],[0,-1,0]], float)
res = {}
for tag, w in ${JSON.stringify(SUBJECTS.map((s) => [s.tag, s.weight]))}:
    out = m.forward(phenotype_kwargs=dict(gender=1.0, age=0.5, muscle=0.5, height=0.7081, weight=w))
    rv = out["rest_vertices"] if isinstance(out, dict) and "rest_vertices" in out else (out[0] if isinstance(out,(tuple,list)) else out)
    if isinstance(rv, dict): rv = list(rv.values())[0]
    V = rv.detach().cpu().numpy().squeeze()
    F = m.faces.detach().cpu().numpy() if torch.is_tensor(m.faces) else np.asarray(m.faces)
    Vy = V @ R.T; Vy[:,1] -= Vy[:,1].min()
    p = "${OUT_DIR}/anny-man-" + tag + ".obj"
    with open(p, "w") as f:
        for v in Vy: f.write("v %.6f %.6f %.6f\\n" % (v[0], v[1], v[2]))
        for t in F: f.write("f %d %d %d\\n" % (t[0]+1, t[1]+1, t[2]+1))
    res[tag] = {"objPath": p, "waist": float(a.waist_circumference(rv)), "stature": float(a.height(rv))}
print("JSON" + json.dumps(res))
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const line = out.split("\n").find((l: string) => l.startsWith("JSON"))!;
  return new Map(Object.entries(JSON.parse(line.slice(4))));
}

const generated = generate();

function meshWaist(tag: string): { waist: number; stature: number } {
  const g = generated.get(tag)!;
  const L = extractLandmarks(tag, readFileSync(g.objPath, "utf8")) as unknown as Record<string, number>;
  return { waist: L["waistGirthMeters"]!, stature: L["statureMeters"]! };
}

describe("the mesh waist girth agrees with anny's own anthropometry", () => {
  it.fails("(1) RED: lean body waist girth is within 2 cm of anny native", () => {
    const g = generated.get("lean")!;
    expect(Math.abs(meshWaist("lean").waist - g.waist)).toBeLessThanOrEqual(BAND_M);
  });

  it.fails("(2) RED: BMI-45 body waist girth is within 2 cm of anny native — no constant scale can satisfy this AND (1)", () => {
    const g = generated.get("bmi45")!;
    expect(Math.abs(meshWaist("bmi45").waist - g.waist)).toBeLessThanOrEqual(BAND_M);
  });

  it("(3) NET: stature stays exact on both bodies — this is what makes the waist error a waist error", () => {
    for (const { tag } of SUBJECTS) {
      const g = generated.get(tag)!;
      expect(Math.abs(meshWaist(tag).stature - g.stature)).toBeLessThanOrEqual(0.001);
    }
  });

  it("(4) NET: #297's arm exclusion still holds — a fix must not re-admit arm geometry", () => {
    const objText = readFileSync(
      "/Volumes/files/src/openclinxr/apps/ui-xr/public/generated-humanoids/adult_male_street_casual.anny_base.obj",
      "utf8",
    );
    const L = extractLandmarks("adult_male_street_casual", objText) as unknown as Record<string, number>;
    expect(L["waistGirthWidthMeters"]!).toBeLessThan(0.5);
    expect(L["waistGirthWidthMeters"]!).toBeLessThan(L["shoulderSpanMeters"]!);
  });

  it("(5) writes the two-instrument comparison artifact", () => {
    const rows = SUBJECTS.map(({ tag }) => {
      const g = generated.get(tag)!;
      const m = meshWaist(tag);
      return {
        tag,
        statureMesh: m.stature, statureAnny: g.stature, statureDelta: m.stature - g.stature,
        waistMesh: m.waist, waistAnny: g.waist, waistDelta: m.waist - g.waist,
        waistRatio: m.waist / g.waist,
        bandMeters: BAND_M,
      };
    });
    writeFileSync(`${OUT_DIR}/waist-two-instrument-comparison.json`, JSON.stringify({
      generatedAt: new Date().toISOString(),
      claimScope: ["mesh_landmark_instrument_vs_anny_native_anthropometry_on_two_synthetic_anny_bodies"],
      notEvidenceFor: [
        "anthropometric_or_clinical_validity",
        "mpfb_geometry_female_bodies_children_or_real_subjects",
        "correctness_of_anny_Anthropometry_itself",
      ],
      rows,
    }, null, 2) + "\n");
    expect(rows.length).toBe(2);
  });
});
