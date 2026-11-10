"""driver.py: numeric optimizer loop, no LLM (SPEC DRIVER LAYOUT). propose (de.py) -> skip if row exists -> build
(build_trial.sh) -> render (render_trial.sh) -> score (score_trial.py) -> append row (write-temp + atomic rename) ->
STOP check -> STATUS.md; exits 0 on a STOP rule. Designed for nohup:
    nohup python3 driver.py --stage material > driver.log 2>&1 &      (writes opt/driver.pid)
    python3 driver.py --dry-run --stage material                       (stub build/render/score, synthetic objective)
State: W2/.openclinxr/opt/hair-groom-2/trials.csv. Stage label in the csv = <stage>@<code_sha[:8]>; a change to the
tool files changes code_sha, hence the label, so a changed scorer never mixes with old rows (old rows kept).
code_sha = sha1 over `git hash-object` of opt/ (minus driver.py, test_de.py), grade/ and cards/ tool files.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
W2 = HERE.parents[3]
sys.path.insert(0, str(HERE))
import de  # noqa: E402
import score_trial as st  # noqa: E402

LANE_W = Path(os.environ.get("LANE_W", "/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2"))
EV = LANE_W / ".openclinxr/evidence/hair-groom-2"
STATE = W2 / ".openclinxr/opt/hair-groom-2"
PUBLIC = W2 / "apps/ui-xr/public"
INC_GLB_REL = "generated-humanoids/_hair-transplant-probe/aisha-cards-p2-b.glb"
VIEWS = st.VIEWS
SHEEN_FIELDS = ["peak", "base", "black", "streak", "bandRow", "runs", "hue", "sat", "bandRowCol", "bandCont", "cols", "iou"]
BASE_COLS = ["trial", "stage", "seed", "code_sha", "glb_sha", "frame_id"]


def code_sha():
    files = []
    for d, pats in ((HERE, ("*.py", "*.sh", "*.ts", "*.json")), (HERE.parent / "grade", ("*.py",)), (HERE.parent / "cards", ("*.py", "*.sh", "*.ts"))):
        for p in pats:
            files += [f for f in d.glob(p) if f.name not in ("driver.py", "test_de.py")]
    h = hashlib.sha1()
    for f in sorted(files):
        h.update(f.name.encode())
        h.update(subprocess.run(["git", "hash-object", str(f)], capture_output=True, text=True, cwd=W2).stdout.strip().encode())
    return h.hexdigest()[:12]


def read_csv(path):
    if not Path(path).exists():
        return [], []
    with open(path, newline="") as fh:
        r = csv.DictReader(fh)
        return list(r), list(r.fieldnames or [])


def append_row(path, row):
    """Rewrite the whole file (header = union of columns) to a temp file and rename it over the original."""
    rows, cols = read_csv(path)
    for k in row:
        if k not in cols:
            cols.append(k)
    rows.append(row)
    tmp = str(path) + ".tmp.%d" % os.getpid()
    with open(tmp, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, restval="")
        w.writeheader()
        w.writerows(rows)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


# ---------- stop rules ----------

def delta_v(ob):
    n = ob["noise"]
    return {v: max(n["delta_seed_v"].get(v) or 0.0, n["delta_grader_v"].get(v) or 0.0) for v in VIEWS}


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return math.inf


def check_stop(rows, inc, ob, stage, elapsed_s):
    """rows: this stage-label's trial rows in trial order. Returns (reason|None, info dict)."""
    bud = ob["search"][stage]["budget"]
    st_ = ob["stop"]
    dv = delta_v(ob)
    sd = sum(dv.values())
    n = len(rows)
    feas = [r for r in rows if int(float(r.get("feasible") or 0)) == 1]
    info = dict(n=n, feasible=len(feas), sum_delta=sd)
    best = min(feas, key=lambda r: fnum(r["D"])) if feas else None
    info["best_trial"] = int(float(best["trial"])) if best else None
    info["best_D"] = fnum(best["D"]) if best else None
    if best and inc:
        Dv = ob["noise"]["Delta_v_A3"]
        need = {v: max(2 * dv[v], Dv[v] / 4) for v in VIEWS}
        info["ship_margin_need"] = need
        gap = {v: fnum(inc["D_" + v]) - fnum(best["D_" + v]) for v in VIEWS}
        info["ship_gap"] = gap
        for r in feas:  # any feasible row meeting the margin in every view
            if all(fnum(inc["D_" + v]) - fnum(r["D_" + v]) >= need[v] for v in VIEWS):
                return "ship-candidate trial %s" % r["trial"], info
    if n >= st_["infeasible"]["afterTrials"] and not feas:
        return "infeasible: 0 feasible after %d trials" % n, info
    win = st_["plateau"]["trials"]
    if n >= win + 16:
        before = [fnum(r["D"]) for r in rows[:n - win] if int(float(r.get("feasible") or 0)) == 1]
        if before:
            imp = min(before) - (info["best_D"] if info["best_D"] is not None else math.inf)
            info["plateau_improvement"] = imp
            if imp < max(sd, 1e-9):
                return "plateau: best sum D improved %.4g < sum delta %.4g over %d trials" % (imp, sd, win), info
    if n >= bud["trials"]:
        return "budget: %d trials" % n, info
    if bud.get("wallHours") and elapsed_s >= bud["wallHours"] * 3600:
        return "budget: %.2f h wall" % (elapsed_s / 3600), info
    return None, info


def write_status(path, label, stage, ob, rows, inc, reason, info, space, dry):
    L = ["# hair-groom-2-opt driver status%s" % (" (DRY RUN, synthetic objective)" if dry else ""), "",
         "updated %s" % time.strftime("%Y-%m-%d %H:%M:%S"), "stage label: `%s`" % label,
         "state: %s" % ("STOPPED: " + reason if reason else "running"),
         "trials %d, feasible %d, sum delta_v %.4g%s" % (info["n"], info["feasible"], info["sum_delta"],
                                                         " (noise floors null: treated as 0)" if info["sum_delta"] == 0 else ""), ""]
    if inc:
        L.append("incumbent D_v: " + ", ".join("%s %.3f" % (v, fnum(inc["D_" + v])) for v in VIEWS) + "; D %.3f" % fnum(inc["D"]))
    if info.get("best_trial") is not None:
        b = next(r for r in rows if int(float(r["trial"])) == info["best_trial"])
        L.append("best feasible: trial %s D %.3f; D_v " % (b["trial"], fnum(b["D"])) + ", ".join("%s %.3f" % (v, fnum(b["D_" + v])) for v in VIEWS))
        L.append("knobs: " + ", ".join("%s=%s" % (k, b[k]) for k in space))
        if "ship_gap" in info:
            L.append("gap vs incumbent / margin needed: " + ", ".join("%s %.3f/%.3f" % (v, info["ship_gap"][v], info["ship_margin_need"][v]) for v in VIEWS))
    else:
        L.append("no feasible trial yet")
    for k in ("plateau_improvement",):
        if k in info:
            L.append("%s %.4g" % (k, info[k]))
    L += ["", "last 5: trial, D, feasible, violation, seconds"]
    for r in rows[-5:]:
        L.append("- %s, %.3f, %s, %.3f, %s" % (r["trial"], fnum(r["D"]), r["feasible"], fnum(r.get("violation")), r.get("seconds")))
    Path(path).write_text("\n".join(L) + "\n")


# ---------- real build / render / score ----------

def sh(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        raise RuntimeError("%s failed (%d): %s" % (cmd[0], r.returncode, (r.stdout + r.stderr)[-600:]))
    return r.stdout


def real_trial(stage, knobs, tag, a, nohair_key):
    bdir = STATE / "build" / tag
    bdir.mkdir(parents=True, exist_ok=True)
    kj = bdir / "knobs.json"
    extra = {"materialGlb": a.material_glb} if (stage == "tint" and a.material_glb) else {}
    kj.write_text(json.dumps({**knobs, **extra}))
    out = sh([str(HERE / "build_trial.sh"), stage, str(kj), str(bdir)])
    glb_sha = [l.split()[1] for l in out.splitlines() if l.startswith("GLB_SHA256")][0]
    glb = PUBLIC / ("generated-humanoids/_hair-transplant-probe/opt/%s.glb" % tag)
    ro = sh([str(HERE / "render_trial.sh"), "generated-humanoids/_hair-transplant-probe/opt/%s.glb" % tag, tag, str(bdir), nohair_key])
    # per-trial render record (A1b): crops = colour 4 + hair-only 4 + empty 4 (+ nohair 4 on a cache miss)
    sec = [l.split()[1] for l in ro.splitlines() if l.startswith("RENDER_SECONDS")]
    a.last_render = dict(render_seconds=float(sec[0]) if sec else "", crops=12 + (4 if "NOHAIR_RENDER" in ro else 0))
    return glb_sha, glb, bdir


def score_dir(bdir, tag, glb, a, iou_back):
    return st.score_views(str(bdir / ("ts-" + tag)), str(bdir / "nohair"), a.targets, a.frame_id, None, "objective",
                          st.glb_hair_tris(str(glb)), iou_back, matte=str(bdir / ("matte-" + tag)))


# ---------- dry run stub ----------

def stub_result(knobs, space, stage):
    """Synthetic quadratic objective in the normalised knob cube; hidden optimum off the start; knob0 > .92 infeasible."""
    names = list(space)
    u = np.array([(knobs[n] - space[n][0]) / (space[n][1] - space[n][0]) for n in names])
    opt = (np.arange(len(names)) % 3 + 1) / 4.0
    res = {"views": {}, "frame_id": "dry", "missing": [], "terms": "objective"}
    for i, v in enumerate(VIEWS):
        d = float(np.sum((u - opt) ** 2) * (1.0 + 0.2 * i) * 8.0 + 3.0 + 0.5 * i)
        res["views"][v] = dict(metrics={"peak": 0.3, "iou": 0.9}, target={}, terms={}, D_v=d)
    res["D"] = sum(res["views"][v]["D_v"] for v in VIEWS)
    viol = max(0.0, (u[0] - 0.92) / 0.05)
    res.update(feasible=viol == 0.0, violation=viol, hard={}, tris=63024)
    return res


def row_from(res, label, idx, knobs, a, seconds, sha, frame, error=""):
    r = dict(trial=idx, stage=label, seed=a.seed, code_sha=a.code_sha, glb_sha=sha, frame_id=frame)
    r.update({k: knobs[k] for k in knobs})
    for v in VIEWS:
        d = res["views"].get(v)
        if d:
            for f in SHEEN_FIELDS:
                if f in d["metrics"]:
                    r["m_%s_%s" % (v, f)] = d["metrics"][f]
            for k, t in d["terms"].items():
                if "wnorm" in t:
                    r["w_%s_%s" % (v, k)] = round(t["wnorm"], 6)
            r["D_" + v] = round(d["D_v"], 6)
    r["D"] = round(res["D"], 6)
    r["violation"] = round(res.get("violation", 0.0), 6)
    r["feasible"] = int(bool(res.get("feasible")))
    r["seconds"] = round(seconds, 2)
    r.update(getattr(a, "last_render", {}) or {})
    r["error"] = error
    return r


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["material", "tint"], required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--targets", default=str(STATE / "tgt-fithead/target-%s.png"))  # A2: targets mapped into the runtime frame
    ap.add_argument("--frame-id", default="")  # default: objective.json frame.id
    ap.add_argument("--material-glb", help="tint stage: fixed material GLB (default BEST3 material)")
    ap.add_argument("--max-trials", type=int, help="override the stage budget (testing)")
    ap.add_argument("--state-dir")
    ap.add_argument("--objective", default=str(HERE / "objective.json"))
    ap.add_argument("--dry-delta", type=float, default=0.5, help="dry run: delta_v for every view")
    a = ap.parse_args(argv)
    ob = json.load(open(a.objective))
    a.frame_id = a.frame_id or ob.get("frame", {}).get("id", "")
    S = ob["search"][a.stage]
    if a.max_trials:
        S["budget"]["trials"] = a.max_trials
    if a.dry_run:
        for k in ("delta_seed_v", "delta_grader_v"):
            ob["noise"][k] = {v: (a.dry_delta if k == "delta_seed_v" else 0.0) for v in VIEWS}
        ob["noise"]["Delta_v_A3"] = {v: 4.0 for v in VIEWS}
    state = Path(a.state_dir) if a.state_dir else (STATE.parent / "hair-groom-2-dry" if a.dry_run else STATE)
    state.mkdir(parents=True, exist_ok=True)
    csvp = state / "trials.csv"
    status = state / "STATUS.md" if a.dry_run else HERE / "STATUS.md"
    a.code_sha = code_sha()
    label = "%s@%s" % (a.stage, a.code_sha[:8])
    space = {k: v["range"] for k, v in S["knobs"].items()}
    start = {k: v["start"] for k, v in S["knobs"].items()}
    pidf = HERE / "driver.pid"
    if not a.dry_run:
        pidf.write_text(str(os.getpid()))
    t_start = time.time()
    inc_label = "incumbent@%s" % a.code_sha[:8]
    rows, _ = read_csv(csvp)
    inc = next((r for r in rows if r["stage"] == inc_label), None)
    # resolution check (SPEC NOISE FLOORS): needs measured delta
    dv = delta_v(ob)
    if sum(dv.values()) > 0 and sum(dv.values()) >= sum(ob["noise"]["Delta_v_A3"].values()) / 4:
        write_status(status, label, a.stage, ob, [], inc, "resolution check: sum delta_v >= sum Delta_v/4, do NOT run DE; add terms",
                     dict(n=0, feasible=0, sum_delta=sum(dv.values())), space, a.dry_run)
        print("resolution check failed; not running DE")
        return 0
    if inc is None:  # incumbent row: BEST3 + g2 GLB as it exists (real) or the stub at the start vector (dry)
        t0 = time.time()
        if a.dry_run:
            res, sha = stub_result(start, space, a.stage), "dry-incumbent"
            res["views"] = {v: dict(d, D_v=d["D_v"] + 0.0) for v, d in res["views"].items()}
        else:
            bdir = STATE / "build" / "incumbent"
            bdir.mkdir(parents=True, exist_ok=True)
            glb = PUBLIC / INC_GLB_REL
            sha = hashlib.sha256(glb.read_bytes()).hexdigest()
            sh([str(HERE / "render_trial.sh"), INC_GLB_REL, "incumbent", str(bdir), "g2" if a.stage == "material" else "inc"])
            res = score_dir(bdir, "incumbent", glb, a, None)
        append_row(csvp, row_from(res, inc_label, 0, start, a, time.time() - t0, sha, a.frame_id))
        rows, _ = read_csv(csvp)
        inc = next(r for r in rows if r["stage"] == inc_label)
    iou_back = None  # A2: all four HARD iou floors are in objective.json hard.iouFloor (registered, matte)
    elapsed0 = sum(fnum(r.get("seconds")) for r in rows if r["stage"] == label)
    reason = None
    while True:
        rows, _ = read_csv(csvp)
        mine = sorted((r for r in rows if r["stage"] == label), key=lambda r: int(float(r["trial"])))
        reason, info = check_stop(mine, inc, ob, a.stage, elapsed0 + (time.time() - t_start))
        write_status(status, label, a.stage, ob, mine, inc, reason, info, space, a.dry_run)
        if reason:
            print("STOP", reason, flush=True)
            if not a.dry_run:
                pidf.unlink(missing_ok=True)
            return 0
        prop = de.propose(rows, label, space, a.seed, 1, S["popsize"], S["F"], S["CR"], start=None)[0]
        idx, knobs = prop["trial"], {k: round(v, 6) for k, v in prop["knobs"].items()}
        tag = "%s-%04d" % (label.replace("@", "-"), idx)
        t0 = time.time()
        sha, err = "", ""
        try:
            if a.dry_run:
                res, sha = stub_result(knobs, space, a.stage), hashlib.sha1(json.dumps(knobs).encode()).hexdigest()
            else:
                nh = "g2" if a.stage == "material" else "tint-" + hashlib.sha1(json.dumps(knobs, sort_keys=True).encode()).hexdigest()[:10]
                sha, glb, bdir = real_trial(a.stage, knobs, tag, a, nh)
                res = score_dir(bdir, tag, glb, a, iou_back)
                (bdir / "score.json").write_text(json.dumps(res, indent=1, default=float))
        except Exception as e:  # a failed trial still takes its index: infeasible, worst violation
            err = str(e)[:300].replace("\n", " ")
            res = dict(views={}, D=math.inf, feasible=False, violation=1e9)
            print("trial %d failed: %s" % (idx, err), flush=True)
        append_row(csvp, row_from(res, label, idx, knobs, a, time.time() - t0, sha, a.frame_id, err))
        print("trial %d D=%.3f feasible=%s %.1fs" % (idx, res["D"], res.get("feasible"), time.time() - t0), flush=True)


if __name__ == "__main__":
    sys.exit(main())
