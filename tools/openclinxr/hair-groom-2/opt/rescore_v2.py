"""rescore_v2.py: re-score every trials.csv row (and the 4 t24 seed builds) from existing crops under objective-v2.json.
CPU only, no renders. Writes trials-v2.csv (same columns + objective); trials.csv is not modified.
Usage: python3 rescore_v2.py [--objective opt/objective-v2.json] [--out S/trials-v2.csv] [--check-v1]
"""
import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import score_trial as st  # noqa: E402

W2 = HERE.parents[3]
S = W2 / ".openclinxr/opt/hair-groom-2"
PUB = W2 / "apps/ui-xr/public/generated-humanoids/_hair-transplant-probe"
INC_GLB = PUB / "aisha-cards-p2-b.glb"
VIEWS = st.VIEWS
SHEEN = ["peak", "base", "black", "streak", "bandRow", "runs", "hue", "sat", "bandRowCol", "bandCont", "cols", "iou"]
TARGETS = str(S / "tgt-fithead/target-%s.png")


def tag_of(r):
    if r["stage"].startswith("incumbent@"):
        return "incumbent"
    return "%s-%04d" % (r["stage"].replace("@", "-"), int(float(r["trial"])))


def score(tag, glb, objective):
    b = S / "build" / tag
    return st.score_views(str(b / ("ts-" + tag)), str(b / "nohair"), TARGETS, "", None, "objective",
                          st.glb_hair_tris(str(glb)), None, objective, matte=str(b / ("matte-" + tag)))


def apply(row, res):
    row = dict(row)
    for v in VIEWS:
        d = res["views"][v]
        for f in SHEEN:
            if f in d["metrics"]:
                row["m_%s_%s" % (v, f)] = d["metrics"][f]
        for k in [k for k in row if k.startswith("w_%s_" % v)]:
            row[k] = ""
        for k, t in d["terms"].items():
            if "wnorm" in t:
                row["w_%s_%s" % (v, k)] = round(t["wnorm"], 6)
        row["D_" + v] = round(d["D_v"], 6)
    row["D"] = round(res["D"], 6)
    row["violation"] = round(res.get("violation", 0.0), 6)
    row["feasible"] = int(bool(res.get("feasible")))
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--objective", default=str(HERE / "objective-v2.json"))
    ap.add_argument("--out", default=str(S / "trials-v2.csv"))
    ap.add_argument("--check-v1", action="store_true", help="also score with objective.json and compare D to trials.csv")
    a = ap.parse_args()
    rows = list(csv.DictReader(open(S / "trials.csv")))
    cols = list(rows[0].keys())
    out, changed, deltas, v1bad = [], 0, [], []
    for r in rows:
        r2 = dict(r, objective="v2")
        if r["error"]:  # errored in v1, no crops: stays errored
            out.append(r2)
            continue
        tag = tag_of(r)
        glb = INC_GLB if tag == "incumbent" else PUB / "opt" / (tag + ".glb")
        if a.check_v1:
            d1 = score(tag, glb, None)["D"]
            if abs(d1 - float(r["D"])) > 1e-4:
                v1bad.append((r["stage"], r["trial"], float(r["D"]), d1))
        res = score(tag, glb, a.objective)
        if res["missing"]:
            print("MISSING", r["stage"], r["trial"], res["missing"])
        r2 = apply(r2, res)
        dd = float(r2["D"]) - float(r["D"])
        if abs(dd) > 5e-6:
            changed += 1
        deltas.append(abs(dd))
        out.append(r2)
    base = next(r for r in rows if r["stage"] == "tint@aa73aeec" and r["trial"] == "24")
    for s in range(4):
        tag = "t24seed-s%d" % s
        glb = PUB / "opt" / (tag + ".glb")
        res = score(tag, glb, a.objective)
        r2 = apply(dict(base, objective="v2"), res)
        r2.update(trial=s, stage="t24seed@aa73aeec", glb_sha=hashlib.sha256(glb.read_bytes()).hexdigest())
        if res["missing"]:
            print("MISSING", tag, res["missing"])
        out.append(r2)
    with open(a.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols + ["objective"])
        w.writeheader()
        w.writerows(out)
    import statistics
    print("rows %d scored %d changed %d max|dD| %.4f median|dD| %.4f" % (len(rows), len(deltas), changed, max(deltas), statistics.median(deltas)))
    if a.check_v1:
        print("v1 reproduction mismatches:", len(v1bad), v1bad[:5])


if __name__ == "__main__":
    main()
