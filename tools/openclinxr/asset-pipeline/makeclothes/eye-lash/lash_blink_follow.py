#!/usr/bin/env python3
"""lash_blink_follow.py — T2b+A3 lash blink-follow as a tracked post-step tool.

Settled in realism-95 `.openclinxr/realism-spike/lash/RESULT.md`:
T1 rigid alpha-card alignment FAILED (17mm card rides into brow; recorded as
a failed treatment, not picked). T2 thinned strand mesh (drop faces with any
vert y<1.546) + A3 lid-morph transfer (nearest SAME-SIDE MOVING body vert,
|d|>0.05mm, nn 2.0mm) WORKED: G2 closure lash centroid 5.9/6.0mm vs lid
margin 2.4/2.4mm, renders attached.

T2b (lash-tick tsk_0a4a6ccf5ebb0da0) REPLACES the T2 blanket lower-drop: T2
hid every lower lash (L 4560/5640 kept, R 4608/5448 kept), which the lash-tick
card forbids (G2: card count per eye within 5% of base; hiding all lower
lashes is a fail). T2b drops only the detached lower-lash cards: each lower
card (12-vert connected component) is scored against the LOWER LID-MARGIN
LOOP — the body eye-opening boundary (topology-derived: edges used by exactly
one face, eye-region filtered, per-side 3mm x-bins, min-y vert per bin) —
by tipDrop (loop y at card x minus card tip y) and card length, and dropped
when tipDrop > med+2*MAD or length > med+2.5*MAD per side (population-derived
bars; k-sweep in lash-tick-report.json). No hand-placed geometry, no vertex
index constants.

Licence: Mindfront eyelashes01, CC0 (Data Collection AB; eyelashes01.mhclo
released CC0 September 2020; strands opaque near-black, no texture).
Licence line lives in manifest.json (same directory).

Two measured facts force this shape:
(a) closure/slit morphs are razor-sharp (skin 0.09mm off the lid margin reads
    exactly 0.000), so the donor pool is masked to union |d| > 0.05mm;
(b) body prim target order swaps left/right vs mesh extras targetNames
    (prim0 target[0..2] named eye-left-* move +x verts), so side is measured
    from bytes (motion mass per side), never from names.

Usage:
  lash_blink_follow.py <in.glb> <out.glb> [--dry] [--probe]

Fail-closed: throws unless exactly one /eyelash/i mesh is present. Dry-run
and probe print the report without writing. Runs on a baked GLB; no
materialize.py / catalog-mod.ts edits. Deterministic (row-major argmin ties).
"""
import argparse
import json
import struct
import sys

CTINV = {'i1': 5120, 'u1': 5121, 'u2': 5123, 'u4': 5125, 'f4': 5126}
DT_NAMES = {5120: 'i1', 5121: 'u1', 5123: 'u2', 5125: 'u4', 5126: 'f4'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
MORPH6 = ['eye-left-closure', 'eye-left-slit', 'eye-left-opened-up',
          'eye-right-closure', 'eye-right-slit', 'eye-right-opened-up']
THRESH_Y = 1.546  # gap between lower (<=1.545) and upper (>=1.547) lash clusters
MOVE_EPS = 0.00005  # 0.05mm donor moving mask
NN_BATCH = 256
LID_BIN = 0.003  # 3mm x-bins for the lid-margin loop (eye fissure ~30mm: 10 bins)
K_TIPDROP = 2.0  # tipDrop outlier bar in MAD multiples (lash-tick k-sweep)
K_LEN = 2.5  # card-length outlier bar in MAD multiples (lash-tick k-sweep)
# Eye-region selectors (boxes, not vertex indices): donor eye band (settled),
# lid-boundary window around the lid aperture (measured lid y-extent 1.53-1.56,
# forward skin z>0.10 excludes the socket interior; x>5mm excludes the mirror
# seam duplicates at x=0).
EYE_BOX = {'x': 0.06, 'y0': 1.50, 'y1': 1.60}
LID_WIN = {'x0': 0.005, 'x1': 0.06, 'y0': 1.535, 'y1': 1.558, 'zmin': 0.10}

try:
    import numpy as np
except ImportError:
    sys.exit('numpy required: `mise exec -- python3`')


def load(path):
    raw = open(path, 'rb').read()
    assert raw[:4] == b'glTF', path
    jl = struct.unpack('<I', raw[12:16])[0]
    g = json.loads(raw[20:20 + jl])
    rest = raw[20 + jl:]
    blob = bytearray(rest[8:] if rest[4:8] == b'BIN\x00' else rest)
    return g, blob


def save(g, blob, path):
    g['buffers'][0]['byteLength'] = len(blob)
    nj = json.dumps(g, separators=(',', ':')).encode()
    total = 12 + 8 + len(nj) + 8 + len(blob)
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, total)
                            + struct.pack('<I', len(nj)) + b'JSON' + nj
                            + struct.pack('<I', len(blob)) + b'BIN\x00' + bytes(blob))


def np_dt(ctype):
    return {'i1': np.int8, 'u1': np.uint8, 'u2': np.uint16,
            'u4': np.uint32, 'f4': np.float32}[DT_NAMES[ctype]]


def rd(g, blob, ai):
    ac = g['accessors'][ai]
    if 'bufferView' not in ac:
        sp = ac.get('sparse')
        if not sp:
            return np.zeros((ac['count'], NC[ac['type']]))
        ibv = g['bufferViews'][sp['indices']['bufferView']]
        ibase = ibv.get('byteOffset', 0) + sp['indices'].get('byteOffset', 0)
        idx = np.frombuffer(blob, dtype=np_dt(sp['indices']['componentType']),
                            count=sp['count'], offset=ibase).astype(int)
        vbv = g['bufferViews'][sp['values']['bufferView']]
        vbase = vbv.get('byteOffset', 0) + sp['values'].get('byteOffset', 0)
        val = np.frombuffer(blob, dtype=np_dt(ac['componentType']),
                            count=sp['count'] * NC[ac['type']], offset=vbase).reshape(-1, NC[ac['type']])
        out = np.zeros((ac['count'], NC[ac['type']]))
        out[idx] = val
        return out
    bv = g['bufferViews'][ac['bufferView']]
    base = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
    n, nc = ac['count'], NC[ac['type']]
    dt = np_dt(ac['componentType'])
    st = bv.get('byteStride')
    if st and st != nc * np.dtype(dt).itemsize:
        s = np.frombuffer(blob, dtype=np.uint8, count=n * st, offset=base).reshape(n, st)
        sz = np.dtype(dt).itemsize
        cols = []
        for k in range(nc):
            c = s[:, k * sz:(k + 1) * sz].copy()
            cols.append(c.view(dt).reshape(n))
        return np.stack(cols, 1)
    return np.frombuffer(blob, dtype=dt, count=n * nc, offset=base).reshape(n, nc)


def append(g, blob, arr, ctype, gtype):
    arr = np.ascontiguousarray(arr)
    conv = {'u1': np.uint8, 'u2': np.uint16, 'u4': np.uint32, 'f4': np.float32}[ctype]
    a = arr.astype(conv)
    off = len(blob)
    blob.extend(a.tobytes())
    g['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(a.tobytes())})
    g['accessors'].append({'bufferView': len(g['bufferViews']) - 1,
                           'componentType': CTINV[ctype], 'count': len(a), 'type': gtype})
    return len(g['accessors']) - 1


def lash_mesh_idx(g):
    import re
    hits = [i for i, m in enumerate(g['meshes']) if re.search(r'eyelash', m['name'], re.I)]
    if len(hits) == 0:
        raise SystemExit('no lash mesh found')
    if len(hits) > 1:
        raise SystemExit('refusing: %d lash meshes: %s'
                         % (len(hits), [g['meshes'][i]['name'] for i in hits]))
    return hits[0]


def head_joint(g):
    jn = [g['nodes'][j].get('name') for j in g['skins'][0]['joints']]
    return jn.index('head')


def mad(a):
    a = np.asarray(a, dtype=float)
    med = float(np.median(a))
    return med, float(np.median(np.abs(a - med)))


def body_eye_prim(g, blob):
    """Body prim holding the eye band (most verts in the settled eye box)."""
    import re
    best = None
    for mi, m in enumerate(g['meshes']):
        if not re.search(r'body', m['name'], re.I):
            continue
        for pi, p in enumerate(m['primitives']):
            Bp = rd(g, blob, p['attributes']['POSITION']).astype(float)
            n = int(((np.abs(Bp[:, 0]) < EYE_BOX['x'])
                     & (Bp[:, 1] > EYE_BOX['y0']) & (Bp[:, 1] < EYE_BOX['y1'])).sum())
            if best is None or n > best[0]:
                best = (n, mi, pi)
    if best is None or best[0] < 100:
        raise SystemExit('refusing: no body prim holds the eye band')
    return best[1], best[2]


def lid_margin_lower_loops(g, blob):
    """Lower lid-margin loop per side, derived from mesh topology.

    The eye opening is a hole in the body mesh: its boundary is the set of
    edges used by exactly one face. Eye-window-filtered, coordinate-deduped,
    per-side 3mm x-bins, min-y vert per bin. Returns {side: (K,2) xy loop}
    plus a debug record. Fail-closed when a side yields <3 loop points.
    """
    bmi, bpi = body_eye_prim(g, blob)
    pr = g['meshes'][bmi]['primitives'][bpi]
    Bp = rd(g, blob, pr['attributes']['POSITION']).astype(float)
    tri = rd(g, blob, pr['indices']).reshape(-1).astype(int).reshape(-1, 3)
    counts = {}
    for t in tri:
        for a, b in ((int(t[0]), int(t[1])), (int(t[1]), int(t[2])), (int(t[2]), int(t[0]))):
            e = (a, b) if a < b else (b, a)
            counts[e] = counts.get(e, 0) + 1
    bverts = set()
    for e, c in counts.items():
        if c == 1:
            bverts.add(e[0])
            bverts.add(e[1])
    bverts = sorted(bverts)
    Pb = Bp[bverts]
    keep = ((np.abs(Pb[:, 0]) > LID_WIN['x0']) & (np.abs(Pb[:, 0]) < LID_WIN['x1'])
            & (Pb[:, 1] > LID_WIN['y0']) & (Pb[:, 1] < LID_WIN['y1'])
            & (Pb[:, 2] > LID_WIN['zmin']))
    cand = [bverts[i] for i in np.where(keep)[0]]
    seen = {}
    uniq = []
    for v in cand:
        k = (round(float(Bp[v, 0]), 4), round(float(Bp[v, 1]), 5), round(float(Bp[v, 2]), 4))
        if k not in seen:
            seen[k] = True
            uniq.append(v)
    loops, dbg = {}, {'bodyPrim': [bmi, bpi], 'boundaryEyeVerts': len(uniq)}
    for side, pred in (('L', lambda x: x < 0), ('R', lambda x: x >= 0)):
        pts = np.array([[Bp[v, 0], Bp[v, 1]] for v in uniq if pred(Bp[v, 0])])
        if len(pts) == 0:
            raise SystemExit(f'refusing: no lid boundary verts on {side}')
        lo = []
        b0 = 0.015
        while b0 < 0.045:
            m = (np.abs(pts[:, 0]) >= b0) & (np.abs(pts[:, 0]) < b0 + LID_BIN)
            q = pts[m]
            if len(q):
                j = int(np.argmin(q[:, 1]))
                lo.append((float(np.mean(q[:, 0])), float(q[j, 1])))
            b0 += LID_BIN
        lo = np.array(sorted(lo))
        if len(lo) < 3:
            raise SystemExit(f'refusing: lower lid-margin loop too short on {side} ({len(lo)} pts)')
        loops[side] = lo
        dbg[side] = {'loopPts': len(lo), 'loopYRange': [round(float(lo[:, 1].min()), 5),
                                                        round(float(lo[:, 1].max()), 5)]}
    return loops, dbg


def lash_card_table(P, tri):
    """Connected-component cards of the lash mesh (each tuft: 12 verts here).

    Deterministic union-find in index order. Returns a list of dicts with
    side (centroid x sign), lower flag (every vert y < THRESH_Y), root/tip.
    """
    parent = list(range(len(P)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for t in tri:
        a, b, c = int(t[0]), int(t[1]), int(t[2])
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[rc] = ra
    comp = {}
    for v in range(len(P)):
        comp.setdefault(find(v), []).append(v)
    cards = []
    for vs in comp.values():
        vs = np.array(sorted(vs))
        ys = P[vs, 1]
        cards.append({'verts': vs,
                      'side': 'L' if float(P[vs, 0].mean()) < 0 else 'R',
                      'lower': bool(np.all(ys < THRESH_Y)),
                      'cx': float(P[vs, 0].mean()),
                      'rootY': float(ys.max()),
                      'tipY': float(ys.min()),
                      'length': float(ys.max() - ys.min())})
    return cards


def measured_side_map(g, blob):
    """Per (mesh, prim): morph name -> target index with side measured from bytes."""
    import re
    remap = {}
    for mi, m in enumerate(g['meshes']):
        if not re.search(r'body', m['name'], re.I):
            continue
        names = (m.get('extras', {}) or {}).get('targetNames', [])
        for pi, p in enumerate(m['primitives']):
            tg = p.get('targets', [])
            if not tg:
                continue
            Bp = rd(g, blob, p['attributes']['POSITION']).astype(float)
            for kind in ('closure', 'slit', 'opened-up'):
                cands = [i for i, nm in enumerate(names[:len(tg)])
                         if kind in nm and ('left' in nm or 'right' in nm)]
                scored = []
                for i in cands:
                    D = rd(g, blob, tg[i]['POSITION']).astype(float)
                    n = np.linalg.norm(D, axis=1)
                    scored.append((i, n[Bp[:, 0] < 0].sum(), n[Bp[:, 0] >= 0].sum()))
                if not scored:
                    continue
                remap.setdefault((mi, pi), {})[f'eye-left-{kind}'] = max(scored, key=lambda s: s[1])[0]
                remap[(mi, pi)][f'eye-right-{kind}'] = max(scored, key=lambda s: s[2])[0]
    return remap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('out', nargs='?')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--probe', action='store_true')
    ap.add_argument('--measure', action='store_true')
    a = ap.parse_args()
    if not a.out and not (a.dry or a.probe or a.measure):
        ap.error('out.glb required unless --dry/--probe/--measure')

    g, blob = load(a.glb)
    mi = lash_mesh_idx(g)
    lash_name = g['meshes'][mi]['name']
    prim = g['meshes'][mi]['primitives'][0]
    remap = measured_side_map(g, blob)

    # donor pool per side: eye-band body verts with union|d|>MOVE_EPS, same-side only
    donors = {}
    for side in ('L', 'R'):
        Pside, Dall = [], []
        for (bmi, bpi), mp in remap.items():
            if len(mp) < 6:
                continue
            bp = g['meshes'][bmi]['primitives'][bpi]
            Bp = rd(g, blob, bp['attributes']['POSITION']).astype(float)
            Dp = [rd(g, blob, bp['targets'][mp[t]]['POSITION']).astype(float) for t in MORPH6]
            eye = (np.abs(Bp[:, 0]) < 0.06) & (Bp[:, 1] > 1.50) & (Bp[:, 1] < 1.60)
            ssel = (Bp[:, 0] < 0) if side == 'L' else (Bp[:, 0] >= 0)
            Pside.append(Bp[eye & ssel])
            Dall.append([d[eye & ssel] for d in Dp])
        Pside = np.concatenate(Pside) if Pside else np.zeros((0, 3))
        Dall = [np.concatenate([d[t] for d in Dall]) if Dall else np.zeros((0, 3))
                for t in range(6)]
        move = np.zeros(len(Pside), bool)
        for D in Dall:
            move |= np.linalg.norm(D, axis=1) > MOVE_EPS
        donors[side] = (Pside, Dall, move)

    report = {
        'schemaVersion': 'openclinxr.eye-lash-blink-follow.v1',
        'glb': a.glb,
        'lashMesh': lash_name,
        'lashPrimTargets': len(prim.get('targets', [])),
        'remappedPrims': len([k for k, v in remap.items() if len(v) == 6]),
        'donorPool': {s: {'pool': int(len(P)), 'moving': int(mv.sum())}
                      for s, (P, _D, mv) in donors.items()},
    }
    if a.probe or a.dry or a.measure:
        action = 'probe (no write)' if a.probe else ('measure (no write)' if a.measure else 'dry-run (no write)')
        report['action'] = action
        if a.measure:
            # blink-follow: eye-*-closure morph moves lash lid-margin verts
            # (lid margin = y within 2mm above T2 thin line), same direction
            # as donor lid margin, >=80% travel, count>0, per side.
            prim = g['meshes'][mi]['primitives'][0]
            meas = {}
            tg = prim.get('targets', [])
            tnames = (g['meshes'][mi].get('extras', {}) or {}).get('targetNames', [])
            Sp = rd(g, blob, prim['attributes']['POSITION']).astype(float)
            lid = (Sp[:, 1] >= THRESH_Y) & (Sp[:, 1] < THRESH_Y + 0.002)
            for side in ('L', 'R'):
                ssel = (Sp[:, 0] < 0) if side == 'L' else (Sp[:, 0] >= 0)
                sel = lid & ssel
                tname = ('eye-left-closure' if side == 'L' else 'eye-right-closure')
                row = {'lidMarginVerts': int(sel.sum())}
                if tname in tnames and len(tg) == len(tnames):
                    Ld = rd(g, blob, tg[tnames.index(tname)]['POSITION']).astype(float)
                    row['lashMeanDyMm'] = round(float(Ld[sel][:, 1].mean() * 1000), 3) if sel.sum() else 0.0
                    # donor lid margin mean dy for same closure target
                    dys = []
                    for (bmi, bpi), mp in remap.items():
                        if len(mp) < 6 or tname not in mp:
                            continue
                        bp = g['meshes'][bmi]['primitives'][bpi]
                        Bp = rd(g, blob, bp['attributes']['POSITION']).astype(float)
                        Bd = rd(g, blob, bp['targets'][mp[tname]]['POSITION']).astype(float)
                        band = (np.abs(Bp[:, 0]) < 0.06) & (Bp[:, 1] > 1.50) & (Bp[:, 1] < 1.60)
                        bs = (Bp[:, 0] < 0) if side == 'L' else (Bp[:, 0] >= 0)
                        m = np.linalg.norm(Bd, axis=1) > MOVE_EPS
                        if (band & bs & m).sum():
                            dys.append(Bd[band & bs & m][:, 1].mean())
                    row['donorMeanDyMm'] = round(float(np.mean(dys) * 1000), 3) if dys else 0.0
                    if row['donorMeanDyMm']:
                        row['travelPct'] = round(100 * row['lashMeanDyMm'] / row['donorMeanDyMm'], 1)
                        row['sameDirection'] = bool(row['lashMeanDyMm'] * row['donorMeanDyMm'] > 0)
                    row['pass'] = bool(row['lidMarginVerts'] > 0 and row.get('sameDirection')
                                       and row.get('travelPct', 0) >= 80)
                else:
                    row['pass'] = False
                    row['reason'] = f'{tname} target missing ({len(tg)} targets, no extras.targetNames)'
                meas[side] = row
            report['blinkFollow'] = meas
            report['pass'] = bool(meas.get('L', {}).get('pass') and meas.get('R', {}).get('pass'))
        print(json.dumps(report, indent=2))
        return

    for side, (P, _D, mv) in donors.items():
        if int(mv.sum()) < 100:
            raise SystemExit(f'refusing: {side} moving donor pool too small ({int(mv.sum())} < 100)')

    # T2b selective detach-drop (lash-tick): keep every card EXCEPT lower
    # cards detached from the lower lid-margin loop. Scores per lower card:
    # tipDrop = loop y at card x minus card tip y (how far the tuft hangs
    # below its own lid margin), and card length; drop when tipDrop >
    # med+K_TIPDROP*MAD or length > med+K_LEN*MAD per side. Upper cards and
    # attached lower cards are kept (G2: within 5% of base per eye).
    P = rd(g, blob, prim['attributes']['POSITION']).astype(float)
    I = rd(g, blob, prim['indices']).reshape(-1).astype(int)
    tri = I.reshape(-1, 3)
    loops, loop_dbg = lid_margin_lower_loops(g, blob)
    cards = lash_card_table(P, tri)
    drop_verts = np.zeros(len(P), bool)
    t2b_sides = {}
    for side in ('L', 'R'):
        loop = loops[side]
        low = [c for c in cards if c['lower'] and c['side'] == side]
        td = np.array([float(np.interp(c['cx'], loop[:, 0], loop[:, 1])) - c['tipY']
                       for c in low]) * 1000.0
        ln = np.array([c['length'] for c in low]) * 1000.0
        med_td, mad_td = mad(td)
        med_ln, mad_ln = mad(ln)
        thr_td = med_td + K_TIPDROP * mad_td if mad_td > 0 else float('inf')
        thr_ln = med_ln + K_LEN * mad_ln if mad_ln > 0 else float('inf')
        flags = [(a > thr_td or b > thr_ln) for a, b in zip(td, ln)]
        dropped = [c for c, f in zip(low, flags) if f]
        for c in dropped:
            drop_verts[c['verts']] = True
        base_cards = [c for c in cards if c['side'] == side]
        kept_td = [float(a) for a, f in zip(td, flags) if not f]
        kept_ln = [float(b) for b, f in zip(ln, flags) if not f]
        t2b_sides[side] = {'cardsBase': len(base_cards),
                           'cardsDrop': len(dropped),
                           'cardsKeep': len(base_cards) - len(dropped),
                           'lowerBase': len(low),
                           'tipDropMedMm': round(med_td, 3),
                           'tipDropMadMm': round(mad_td, 3),
                           'tipDropThrMm': round(thr_td, 3),
                           'lenMedMm': round(med_ln, 3),
                           'lenMadMm': round(mad_ln, 3),
                           'lenThrMm': round(thr_ln, 3),
                           'maxKeptTipDropMm': round(max(kept_td), 3) if kept_td else 0.0,
                           'maxKeptLenMm': round(max(kept_ln), 3) if kept_ln else 0.0,
                           'droppedCx': sorted(round(c['cx'], 4) for c in dropped)}
    keep = ~np.any(drop_verts[tri], axis=1)
    kept_tris = tri[keep]
    used = np.unique(kept_tris)
    rmp = np.full(len(P), -1, dtype=int)
    rmp[used] = np.arange(len(used))
    new_tris = rmp[kept_tris]
    report['t2b'] = {'treatment': 'T2b-selective-detach-drop+A3',
                     'trisTotal': int(len(tri)), 'trisKeep': int(keep.sum()),
                     'vertsBefore': int(len(P)), 'vertsAfter': int(len(used)),
                     'lidMarginLoop': loop_dbg, 'sides': t2b_sides,
                     'threshY': THRESH_Y, 'kTipDrop': K_TIPDROP, 'kLen': K_LEN}
    # Back-compat alias: the settled T2 report key with the same shape.
    report['t2'] = {'trisTotal': int(len(tri)), 'trisKeep': int(keep.sum()),
                    'vertsBefore': int(len(P)), 'vertsAfter': int(len(used))}
    carry = {}
    for attr in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'):
        if attr in prim['attributes']:
            arr = rd(g, blob, prim['attributes'][attr])
            carry[attr] = (arr[used], arr.dtype)
    Sp = P[used]
    prim['attributes']['POSITION'] = append(g, blob, Sp, 'f4', 'VEC3')
    if 'NORMAL' in carry:
        prim['attributes']['NORMAL'] = append(g, blob, carry['NORMAL'][0], 'f4', 'VEC3')
    if 'TEXCOORD_0' in carry:
        prim['attributes']['TEXCOORD_0'] = append(g, blob, carry['TEXCOORD_0'][0], 'f4', 'VEC2')
    if 'JOINTS_0' in carry:
        prim['attributes']['JOINTS_0'] = append(g, blob, carry['JOINTS_0'][0].astype(int), 'u1', 'VEC4')
    if 'WEIGHTS_0' in carry:
        prim['attributes']['WEIGHTS_0'] = append(g, blob, carry['WEIGHTS_0'][0], 'f4', 'VEC4')
    prim['indices'] = append(g, blob, new_tris.reshape(-1).astype(np.uint32), 'u4', 'SCALAR')
    new_name = lash_name.replace('_mindfront_eyelashes_01_', '_mindfront_eyelashes_01_thinned_')
    if new_name == lash_name:
        new_name = lash_name + '_thinned'
    g['meshes'][mi]['name'] = new_name
    for nd in g['nodes']:
        if nd.get('mesh') == mi and 'eyelash' in (nd.get('name') or ''):
            nd['name'] = new_name

    # A3 transfer: nearest same-side moving donor per kept lash vert
    per_side = {}
    nn = {}
    for side, sel in (('L', Sp[:, 0] < 0), ('R', Sp[:, 0] >= 0)):
        sidx = np.where(sel)[0]
        if len(sidx) == 0:
            continue
        want = [t for t in MORPH6 if ('left' if side == 'L' else 'right') in t]
        gi = [MORPH6.index(t) for t in want]
        Pside, Dall, mv = donors[side]
        Pmove = Pside[mv]
        Dmove = [Dall[t][mv] for t in gi]
        Sv = Sp[sidx]
        out = [np.zeros_like(Sv) for _ in gi]
        dists = []
        for c0 in range(0, len(Sv), NN_BATCH):
            C = Sv[c0:c0 + NN_BATCH]
            d2 = ((C[:, None, :] - Pmove[None, :, :]) ** 2).sum(2)
            bnn = d2.argmin(1)
            dists.append(np.sqrt(d2.min(1)))
            for j in range(len(gi)):
                out[j][c0:c0 + NN_BATCH] = Dmove[j][bnn]
        dists = np.concatenate(dists)
        nn[side] = {'pool': int(len(Pside)), 'moving': int(mv.sum()),
                    'nn_mean_mm': round(float(dists.mean() * 1000), 3),
                    'nn_max_mm': round(float(dists.max() * 1000), 3)}
        full = [np.zeros((len(Sp), 3)) for _ in gi]
        for j in range(len(gi)):
            full[j][sidx] = out[j]
        per_side[side] = (want, full)
    tgt = {}
    for _side, (want, full) in per_side.items():
        for tname, arr in zip(want, full):
            tgt[tname] = tgt.get(tname, np.zeros((len(Sp), 3))) + arr
    prim['targets'] = []
    for t in MORPH6:
        ni = append(g, blob, tgt[t], 'f4', 'VEC3')
        prim['targets'].append({'POSITION': ni})
    g['meshes'][mi]['extras'] = {'targetNames': list(MORPH6)}
    n = len(Sp)
    HJ = head_joint(g)
    prim['attributes']['JOINTS_0'] = append(g, blob, np.tile([HJ, 0, 0, 0], (n, 1)), 'u1', 'VEC4')
    prim['attributes']['WEIGHTS_0'] = append(g, blob,
                                            np.tile([1.0, 0.0, 0.0, 0.0], (n, 1)), 'f4', 'VEC4')
    report['a3'] = nn
    report['action'] = f't2b-selective+A3 -> {a.out}'
    save(g, blob, a.out)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
