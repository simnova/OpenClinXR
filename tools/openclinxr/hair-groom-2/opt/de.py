"""de.py: numpy DE rand/1/bin as a pure function of trials.csv rows (SPEC S1, DRIVER LAYOUT).

propose(rows, stage, space, seed, ...) -> [{"trial": idx, "knobs": {name: value}}, ...]
  rows   : csv rows (dicts) for any stage; only rows with row['stage'] == stage count. Needs columns trial, knob names,
           D, feasible (0/1/'True'/'False'), optional violation.
  space  : {knob: [lo, hi]} (ordered; the order fixes the vector layout).
Trials 0..pop-1: seeded Latin hypercube (the sensitivity design). Trial idx >= pop is in generation g = idx // pop and
targets population member j = idx % pop; the population is the synchronous replay of selection over generations < g
(a trial replaces member j when its rank key is <= the member's). Mutation draws (r1, r2, r3) distinct from j with an
rng seeded by (seed, stage, idx) only, so the same csv gives the same proposal and nothing depends on call history.
Rank key: feasible beats infeasible; feasible compares D; infeasible compares violation (D when absent).
A proposal for a (stage, idx) that already has a row is skipped: propose returns the next `count` missing indices.
Work is in the normalised [0, 1] cube and clipped there.

CLI: python3 de.py propose --csv trials.csv --stage S --space-json '{"K":[.4,1]}' [--seed 0] [--count 1]
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sys

import numpy as np

POP, F, CR = 16, 0.6, 0.9


def _truthy(v):
    return str(v).strip().lower() in ("1", "true", "yes", "1.0")


def _stage_seed(stage: str) -> int:
    return int.from_bytes(hashlib.sha256(stage.encode()).digest()[:4], "little")


def lhs(n: int, d: int, seed: int, stage: str = "") -> np.ndarray:
    """Seeded Latin hypercube, n points in [0,1]^d, one point per stratum per axis."""
    rng = np.random.default_rng([seed, _stage_seed(stage), 7919])
    out = np.empty((n, d))
    for k in range(d):
        out[:, k] = (rng.permutation(n) + rng.random(n)) / n
    return out


def rank_key(row):
    feasible = _truthy(row.get("feasible", False))
    D = _f(row.get("D"))
    if feasible:
        return (0, D, 0.0)
    v = row.get("violation")
    v = _f(v) if v not in (None, "") else D
    return (1, v, 0.0)


def _f(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return math.inf
    return math.inf if math.isnan(v) else v


def _norm(row, names, bounds):
    return np.array([(float(row[n]) - lo) / (hi - lo) for n, (lo, hi) in zip(names, bounds)])


def _denorm(u, names, bounds):
    u = np.clip(u, 0.0, 1.0)
    return {n: float(lo + x * (hi - lo)) for n, x, (lo, hi) in zip(names, u, bounds)}


def population(rows_by_idx, g, names, bounds, seed, stage, pop=POP):
    """Population (pop x d array, keys) at the start of generation g (g >= 1)."""
    design = lhs(pop, len(names), seed, stage)
    X = [None] * pop
    K = [(2, math.inf, 0.0)] * pop
    for j in range(pop):
        r = rows_by_idx.get(j)
        if r is not None:
            X[j], K[j] = _norm(r, names, bounds), rank_key(r)
        else:
            X[j] = design[j]  # unevaluated slot, worst key
    for gg in range(1, g):
        for j in range(pop):
            r = rows_by_idx.get(gg * pop + j)
            if r is None:
                continue
            k = rank_key(r)
            if k <= K[j]:
                X[j], K[j] = _norm(r, names, bounds), k
    return np.array(X), K


def propose_one(rows_by_idx, idx, names, bounds, seed, stage, pop=POP, F=F, CR=CR, start=None):
    d = len(names)
    if idx < pop:
        u = lhs(pop, d, seed, stage)[idx]
        if start is not None and idx == 0:
            u = np.array([(start[n] - lo) / (hi - lo) for n, (lo, hi) in zip(names, bounds)])
        return _denorm(u, names, bounds)
    g, j = divmod(idx, pop)
    X, _ = population(rows_by_idx, g, names, bounds, seed, stage, pop)
    rng = np.random.default_rng([seed, _stage_seed(stage), idx])
    others = [i for i in range(pop) if i != j]
    r1, r2, r3 = rng.choice(others, 3, replace=False)
    v = X[r1] + F * (X[r2] - X[r3])
    jr = int(rng.integers(d))
    cross = rng.random(d) < CR
    cross[jr] = True
    u = np.where(cross, v, X[j])
    return _denorm(u, names, bounds)


def propose(rows, stage, space, seed=0, count=1, pop=POP, F=F, CR=CR, start=None):
    names = list(space)
    bounds = [tuple(space[n]) for n in names]
    rb = {}
    for r in rows:
        if r.get("stage") == stage:
            rb[int(float(r["trial"]))] = r
    out, idx = [], 0
    while len(out) < count:
        if idx not in rb:
            out.append({"trial": idx, "knobs": propose_one(rb, idx, names, bounds, seed, stage, pop, F, CR, start)})
        idx += 1
    return out


def read_rows(path):
    try:
        with open(path, newline="") as fh:
            return list(csv.DictReader(fh))
    except FileNotFoundError:
        return []


def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["propose"])
    ap.add_argument("--csv", required=True)
    ap.add_argument("--stage", required=True)
    ap.add_argument("--space-json", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--count", type=int, default=1)
    a = ap.parse_args(argv)
    print(json.dumps(propose(read_rows(a.csv), a.stage, json.loads(a.space_json), a.seed, a.count), indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
