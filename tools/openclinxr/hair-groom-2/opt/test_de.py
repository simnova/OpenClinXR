"""Unit checks for de.py: convergence on sphere/rosenbrock, restart determinism, clip, feasibility ranking.
Run: python3 test_de.py"""
import csv, os, tempfile
import numpy as np
import de

SPACE = {f"x{i}": [-2.0, 2.0] for i in range(6)}
sphere = lambda x: float(np.sum(x * x))
rosen = lambda x: float(np.sum(100 * (x[1:] - x[:-1] ** 2) ** 2 + (1 - x[:-1]) ** 2))


def run(fn, n, seed=0, rows=None):
    rows = rows if rows is not None else []
    while len([r for r in rows if r["stage"] == "s"]) < n:
        p = de.propose(rows, "s", SPACE, seed)[0]
        x = np.array([p["knobs"][k] for k in SPACE])
        rows.append(dict(trial=p["trial"], stage="s", feasible=1, D=fn(x), **p["knobs"]))
    return rows


for name, fn in (("sphere", sphere), ("rosenbrock", rosen)):
    for n in (16, 96, 320):
        rows = run(fn, n)
        print(name, "N=%d best=%.5g" % (n, min(r["D"] for r in rows)))

# restart: k trials, "kill", rebuild from csv text, same next proposal
rows = run(sphere, 53)
path = os.path.join(tempfile.mkdtemp(), "t.csv")
with open(path, "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
a = de.propose(rows, "s", SPACE, 0)[0]
b = de.propose(de.read_rows(path), "s", SPACE, 0)[0]
assert a["trial"] == b["trial"] == 53 and all(abs(a["knobs"][k] - b["knobs"][k]) < 1e-12 for k in SPACE), (a, b)
print("restart: next trial", a["trial"], "identical from csv: OK")
# skip: with trial 53 present the proposal moves to 54
rows2 = rows + [dict(trial=53, stage="s", feasible=1, D=1.0, **a["knobs"])]
assert de.propose(rows2, "s", SPACE, 0)[0]["trial"] == 54
print("skip existing (stage, trial): OK")
# clip: hugging a corner with huge F still lands inside the box
rows = run(sphere, 40)
for p in de.propose(rows, "s", SPACE, 3, count=20, F=5.0):
    assert all(-2.0 <= v <= 2.0 for v in p["knobs"].values())
print("clip: 20 proposals F=5 all within [-2,2]: OK")
# feasibility ranking: an infeasible low-D row never replaces a feasible member; less violation wins among infeasible
assert de.rank_key(dict(feasible=1, D=9)) < de.rank_key(dict(feasible=0, D=0.1, violation=0.01))
assert de.rank_key(dict(feasible=0, D=1, violation=0.2)) < de.rank_key(dict(feasible=0, D=1, violation=0.5))
print("rank key (feasible < infeasible; lower violation first): OK")
