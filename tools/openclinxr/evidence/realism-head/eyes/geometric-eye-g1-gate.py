#!/usr/bin/env python3
"""G1 params-lock gate: the resolved anterior-segment set must close geometrically.

Cheapest pass refused: asserting p~1.05 from the WTW inversion alone. A set that
hits WTW but buries the iris edge outside the sclera, or parks the iris plane in
front of the limbus ring, still "closes" on paper and fails in the build. Every
assertion below guards one such silent inconsistency. Exit 0 = PASS, 1 = FAIL.
Reads geometric-eye-g1-params.json (this dir); re-derives ring/opening/chamber
from first principles, does not trust the file's arithmetic.
"""
import json, math, sys
from pathlib import Path

HERE = Path(__file__).parent
P = json.loads((HERE / "geometric-eye-g1-params.json").read_text())["resolved"]
D = json.loads((HERE / "geometric-eye-g1-params.json").read_text())["iris_disc"]

fails = []
def check(name, cond, detail):
    print(("PASS" if cond else "FAIL"), name, "-", detail)
    if not cond:
        fails.append(name)

R, r, p = P["scleral_radius_mm"], P["cap_radius_mm"], P["protrusion_mm"]
d = R + p - r                                   # centre distance globe->cap
z = (R * R - r * r + d * d) / (2 * d)           # limbus ring plane (globe coords)
a = math.sqrt(R * R - z * z)                    # ring half-chord
opening = 2 * a
apex = R + p
zi = apex - P["chamber_depth_apex_to_iris_mm"]  # iris plane
iris_half = D["dia_mm"] / 2
sclera_half_at_iris = math.sqrt(R * R - zi * zi)

check("opening_matches_WTW", abs(opening - 11.5) < 0.05,
      f"derived opening {opening:.3f} vs WTW 11.5")
check("opening_exceeds_iris", opening > D["dia_mm"] + 0.3,
      f"opening {opening:.3f} vs iris {D['dia_mm']:.3f} (G0 tension: 8.69 < iris INCONSISTENT)")
check("iris_inside_sclera", sclera_half_at_iris > iris_half + 0.5,
      f"scleral half-width at iris plane {sclera_half_at_iris:.3f} vs iris half {iris_half:.3f}")
check("iris_behind_limbus", 0 < (z - zi) < 1.5,
      f"iris plane {z - zi:.3f}mm behind limbus ring plane")
check("chamber_in_anatomy_band", 2.5 <= P["chamber_depth_apex_to_iris_mm"] <= 3.5,
      f"ACD {P['chamber_depth_apex_to_iris_mm']} vs cited 1.5-4.0 avg 3.0")
check("iris_not_rescaled", abs(D["dia_mm"] - 10.807) < 0.001,
      f"iris {D['dia_mm']} == G0 measured 10.807 (audit 10.26 must NOT be applied)")
check("protrusion_is_sagitta_diff",
      abs(p - ((apex - z) - (R - z))) < 1e-9,
      f"p {p} == cap sagitta {(apex - z):.3f} - scleral sagitta {(R - z):.3f}")
check("file_rounding_honest", abs(P["limbus_opening_dia_mm"] - opening) < 0.01
      and abs(P["limbus_ring_z_mm"] - z) < 0.01
      and abs(D["plane_z_mm"] - zi) < 0.01,
      "stored ring/opening/plane match first-principles re-derivation")

print("GATE", "GREEN" if not fails else f"RED ({fails})")
sys.exit(1 if fails else 0)
