"""ship_a4.py: SPEC A4 ship rule S1-S4, applied post hoc to trials.csv rows of one stage label.

Usage: python3 ship_a4.py <trials.csv> <stage label> [--json out.json] [--bars v2]
--bars v2: D_BEST3_v, r_v from full-{best3,r10}-v2.json and noise from objective-v2.json (CEO 2026-11-10: bars and objective same version).
Bars from SPEC A4 (CEO 2026-11-10): incumbent D_v = the stage's incumbent row; D_BEST3_v and r_v from
.openclinxr/opt/hair-groom-2/full-best3.json / full-r10.json; delta_v = objective.json noise (max seed, grader).
"""
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
W2 = HERE.parents[3]
STATE = W2 / ".openclinxr/opt/hair-groom-2"
V = ["front", "three_quarter_left", "side", "back"]


def bars(inc, ver=""):
    sfx = "-" + ver if ver else ""
    ob = json.load(open(HERE / ("objective%s.json" % sfx)))["noise"]
    d = {v: max(ob["delta_seed_v"][v], ob["delta_grader_v"][v]) for v in V}
    r10 = json.load(open(STATE / ("full-r10%s.json" % sfx)))["views"]
    b3 = json.load(open(STATE / ("full-best3%s.json" % sfx)))["views"]
    r = {v: (r10[v]["D_v"] - b3[v]["D_v"]) / r10[v]["D_v"] for v in V}
    return dict(delta=d, best3={v: b3[v]["D_v"] for v in V}, r=r,
                s1={v: inc[v] + d[v] for v in V},
                s3={v: inc[v] - max(2 * d[v], inc[v] * r[v] / 4) for v in V},
                s4=sum(inc.values()) - 2 * sum(d.values()))


def check(D, B):
    s1 = [v for v in V if not D[v] <= B["s1"][v]]
    s2 = [v for v in V if not D[v] < B["best3"][v]]
    s3n = sum(D[v] <= B["s3"][v] for v in V)
    tot = sum(D.values())
    fails = {"S1": s1, "S2": s2, "S3": s3n < 2, "S4": tot > B["s4"]}
    failed = [k for k, x in fails.items() if x]
    # border: exactly one clause failed, by < delta_v (S1/S2: worst view excess; S3: 2nd-best view gap; S4: excess vs 2*mean delta)
    border = None
    if len(failed) == 1:
        k = failed[0]
        if k == "S1":
            ex = max(D[v] - B["s1"][v] for v in s1); border = all(D[v] - B["s1"][v] < B["delta"][v] for v in s1)
        elif k == "S2":
            ex = max(D[v] - B["best3"][v] for v in s2); border = all(D[v] - B["best3"][v] < B["delta"][v] for v in s2)
        elif k == "S3":
            gaps = sorted((D[v] - B["s3"][v], v) for v in V); ex, v2 = gaps[1]; border = ex < B["delta"][v2]
        else:
            ex = tot - B["s4"]; border = ex < sum(B["delta"].values())
    return dict(failed=failed, s3_views=s3n, total=tot, border=bool(border))


def main():
    rows = [r for r in csv.DictReader(open(sys.argv[1])) if r["stage"] in (sys.argv[2], "incumbent@" + sys.argv[2].split("@")[1])]
    inc_rows = [r for r in rows if r["stage"].startswith("incumbent@") and r["D"] not in ("", "inf")]
    inc = {v: float(inc_rows[-1]["D_" + v]) for v in V}
    B = bars(inc, sys.argv[sys.argv.index("--bars") + 1] if "--bars" in sys.argv else "")
    out = dict(incumbent=inc, bars=B, passing=[], border=[], n=0)
    for r in rows:
        if r["stage"] != sys.argv[2] or r["D"] in ("", "inf") or r["feasible"] not in ("True", "1", "true"):
            continue
        out["n"] += 1
        D = {v: float(r["D_" + v]) for v in V}
        c = check(D, B)
        rec = dict(trial=int(float(r["trial"])), D=D, **c)
        if not c["failed"]:
            out["passing"].append(rec)
        elif c["border"]:
            out["border"].append(rec)
    out["passing"].sort(key=lambda x: x["total"])
    print("feasible trials %d | pass S1-S4 %d | border %d" % (out["n"], len(out["passing"]), len(out["border"])))
    print("bars S1 %s | S3 %s | S4 %.2f" % ({v: round(x, 2) for v, x in B["s1"].items()}, {v: round(x, 2) for v, x in B["s3"].items()}, B["s4"]))
    for rec in out["passing"][:1] + out["border"][:5]:
        print("trial %d total %.2f failed %s D %s" % (rec["trial"], rec["total"], rec["failed"], {v: round(x, 2) for v, x in rec["D"].items()}))
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
