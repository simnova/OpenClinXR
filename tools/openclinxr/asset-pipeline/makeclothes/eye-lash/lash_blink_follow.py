#!/usr/bin/env python3
"""lash_blink_follow.py — T2+A3 lash blink-follow as a tracked post-step tool.

Settled in realism-95 `.openclinxr/realism-spike/lash/RESULT.md`:
T1 rigid alpha-card alignment FAILED (17mm card rides into brow; recorded as
a failed treatment, not picked). T2 thinned strand mesh (drop faces with any
vert y<1.546) + A3 lid-morph transfer (nearest SAME-SIDE MOVING body vert,
|d|>0.05mm, nn 2.0mm) WORKED: G2 closure lash centroid 5.9/6.0mm vs lid
margin 2.4/2.4mm, renders attached.

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

    # T2 thin: keep tris whose every vert has y >= THRESH_Y
    P = rd(g, blob, prim['attributes']['POSITION']).astype(float)
    I = rd(g, blob, prim['indices']).reshape(-1).astype(int)
    tri = I.reshape(-1, 3)
    keep = np.all(P[tri][:, :, 1] >= THRESH_Y, axis=1)
    kept_tris = tri[keep]
    used = np.unique(kept_tris)
    rmp = np.full(len(P), -1, dtype=int)
    rmp[used] = np.arange(len(used))
    new_tris = rmp[kept_tris]
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
    report['action'] = f't2+a3 -> {a.out}'
    save(g, blob, a.out)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
