"""P3 card tolerance and its non-vacuous proof (DESIGN-realism.md, Appearance metrics and glossary "card tolerance").

    p3_tol.py <out.json> <score.json> [<score.json> ...]

Inputs are `sheen_gate.py score` outputs in one frame (the P3 target-camera frame), merged by label. Required labels:
s1..s6 (strand seeds; s1 is the reference). cs1..cs3 (cards rebuilt from s1 at clustering seeds) are optional; without
them B is not measured and tol = A (recorded as B null). Other labels are scored as candidates (e.g. r10, p2b).
Under OP6 the tol gates structural metrics only; the sheen_gate metrics here report the seed spread.

Per metric m and view v:
  A = max_{i=2..5} |m(s_i) - m(s1)|          (strand seed spread; s6 is held out for the proof)
  B = max over pairs of |m(cs_j) - m(cs_k)|    (card perturbation floor)
  tol = max(A, B)
Cell (m, v) of a label passes when |m(label) - m(s1)| <= tol.
Proof the gate is not vacuous: s6 passes >= 70% of gated cells, and r10 (lit-atlas cards) fails at least one gated
metric in >= 2 views.
"""
import json
import sys
from itertools import combinations

GATED = ('peak', 'base', 'black', 'streak', 'bandRowCol', 'bandCont')
VIEWS = ('front', 'three_quarter_left', 'side', 'back')


def main(out, paths):
    d = {}
    for p in paths:
        for label, rows in json.load(open(p)).items():
            d.setdefault(label, {}).update(rows)
    need = ['s%d' % i for i in range(1, 7)]
    have_cs = all(k in d for k in ('cs1', 'cs2', 'cs3'))
    miss = [k for k in need if k not in d]
    if miss:
        raise SystemExit('missing labels %s' % miss)
    tol = {}
    for v in VIEWS:
        for m in GATED:
            ref = d['s1'][v][m]
            a = max(abs(d['s%d' % i][v][m] - ref) for i in range(2, 6))
            b = max(abs(d[x][v][m] - d[y][v][m]) for x, y in combinations(('cs1', 'cs2', 'cs3'), 2)) \
                if have_cs else None
            tol.setdefault(v, {})[m] = {'A': round(a, 4), 'B': None if b is None else round(b, 4),
                                        'tol': round(max(a, b or 0.0), 4)}
    res = {'tol': tol, 'labels': {}}
    for label in d:
        if label in ('s1', 's2', 's3', 's4', 's5'):
            continue
        cells = {}
        for v in VIEWS:
            for m in GATED:
                diff = abs(d[label][v][m] - d['s1'][v][m])
                cells['%s.%s' % (v, m)] = {'diff': round(diff, 4), 'pass': diff <= tol[v][m]['tol']}
        npass = sum(c['pass'] for c in cells.values())
        fail_views = sorted({k.split('.')[0] for k, c in cells.items() if not c['pass']})
        res['labels'][label] = {'pass': npass, 'cells': len(cells), 'failViews': fail_views, 'detail': cells}
    proof = {}
    if 's6' in res['labels']:
        s6 = res['labels']['s6']
        proof['s6PassFrac'] = round(s6['pass'] / s6['cells'], 3)
        proof['s6Ok'] = proof['s6PassFrac'] >= 0.70
    if 'r10' in res['labels']:
        proof['r10FailViews'] = res['labels']['r10']['failViews']
        proof['r10Ok'] = len(proof['r10FailViews']) >= 2
    res['proof'] = proof
    json.dump(res, open(out, 'w'), indent=1)
    print('tol (view: ' + ' '.join(GATED) + ')')
    for v in VIEWS:
        print('  %-18s' % v, ' '.join('%.4f' % tol[v][m]['tol'] for m in GATED))
    for label, r in res['labels'].items():
        print('%-6s pass %d/%d failViews %s' % (label, r['pass'], r['cells'], ','.join(r['failViews']) or '-'))
    print('proof', json.dumps(proof))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
