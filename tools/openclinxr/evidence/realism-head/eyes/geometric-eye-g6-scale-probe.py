"""G6 handoff probe: second-subject scaling rule (ANALYTIC ONLY, no mesh).

Question from scope risk #5: child globe is smaller (fitted dia 22.76 vs
adult 23.81) while cap/recess numbers are absolute mm. Which scales?

Inputs (re-derived from committed artifacts, trusted nothing carried):
- Adult params: geometric-eye-g1-params.json (R 11.9, r 7.8, WTW 11.507, p 1.05)
- Child globe: child-conform-report.json gates.g1.globeDiameterMm [22.77, 22.752]
  -> R_child = 11.3805 (mean). Scale factor k = 11.3805/11.9 = 0.95634.

Two candidate rules, both closed by two-sphere intersection from first
principles (same formulation as the G1 gate):
  (A) PROPORTIONAL: every linear dim x k (r 7.458, WTW 11.003, p 1.004,
      iris 10.335, chamber 2.869). Closes EXACTLY by similarity.
  (B) ABSOLUTE cap+opening (r 7.8, WTW 11.5 on R 11.38): re-solved here;
      iris/chamber absolute (10.807 / 3.0).

Verdict rule: candidate passes if (i) protrusion in [0.5, 1.5],
(ii) iris edge inside sclera at its plane with margin >= 0.5/side,
(iii) iris plane behind limbus plane. Recommendation recorded, NOT enacted:
enacting needs the G6 bake (second-subject GLB + station re-run), which is
OPEN work, not this probe.
"""
import json, math, sys

R_ADULT = 11.9
child = json.load(open(
    "tools/openclinxr/asset-pipeline/realism-head/lid-conform/"
    "child-conform-report.json"))
dias = child["gates"]["g1"]["globeDiameterMm"]
R_CHILD = sum(dias) / 2 / 2
k = R_CHILD / R_ADULT
print(f"child dias {dias} -> R {R_CHILD:.4f}, k {k:.5f}")

def intersect(R, r, opening_dia):
    a = opening_dia / 2
    assert a < min(R, r), "opening wider than a sphere"
    z_ring = math.sqrt(R ** 2 - a ** 2)          # limbus plane on sclera
    dz = math.sqrt(r ** 2 - a ** 2)              # ring-to-cap-centre depth
    z_cap = z_ring - dz
    apex = z_cap + r
    p = apex - R
    return z_ring, apex, p

def check(name, R, r, opening, iris_dia, chamber):
    z_ring, apex, p = intersect(R, r, opening)
    z_iris = apex - chamber
    assert z_iris < z_ring, f"{name}: iris ahead of limbus"
    scl_half = math.sqrt(R ** 2 - z_iris ** 2)
    margin = scl_half - iris_dia / 2
    ok = (0.5 <= p <= 1.5) and (margin >= 0.5)
    print(f"{name}: R={R:.3f} r={r:.3f} open={opening:.3f} p={p:.3f} "
          f"apex={apex:.3f} iris_z={z_iris:.3f} sclera_half={scl_half:.3f} "
          f"margin={margin:.3f} -> {'PASS' if ok else 'FAIL'}")
    return ok, {"p": p, "apex": apex, "margin": margin}

results = {}
results["A_proportional"], a = check("A proportional", R_CHILD, 7.8 * k,
                                     11.507 * k, 10.807 * k, 3.0 * k)
results["B_absolute"], b = check("B absolute   ", R_CHILD, 7.8,
                                 11.5, 10.807, 3.0)
assert all(results.values()), "a candidate failed closure — G6 bake BLOCKED"
print("probe: both candidates close; recommendation: (A) proportional "
      "(k=0.95634 from fitted child globe), pending bake proof in G6.")
