"""noise_floors.py: STEP E. Noise floors on matte masks in the registered frame (A1/A2/A3), resolution check, and
(only on PASS) the freeze of objective.json. Run with Blender's python (numpy + PIL), from anywhere.
  delta_grader_v = |D_v(g2) - D_v(p2a)|
  delta_seed_v   = sum over metrics shared by tol.json and the objective of w_m * tol_m / s_m   (s_m from the target in the
                   registered frame; metrics peak, base, black, streak, bandCont; bandRowCol has no objective term)
  delta_v        = max(delta_seed_v, delta_grader_v)
  Delta_v        = D_v(r10) - D_v(best3), STEP C E1 on matte masks (p1-rt frame, A3 terms)
  check          sum delta_v >= sum Delta_v / 4  ->  FAIL (do not run DE)
  iou HARD floor_v = IoU_v(g2, registered, matte) - delta_seed_v * 0.05   (delta_seed in D units back to IoU units with the
                   iou scale .05: one D unit of the iou term is .05 IoU)
"""
import datetime
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import matte_check as mc  # noqa: E402
import score_trial as st  # noqa: E402

OPT = mc.OPT
VIEWS = st.VIEWS
FRAMES = OPT / 'frames-fithead.json'
FRAME_ID = 'fithead-' + hashlib.sha256(FRAMES.read_bytes()).hexdigest()[:8]
TG = str(OPT / 'tgt-fithead') + '/target-%s.png'
TOL = json.load(open(str(mc.EV / 'p3/tol.json')))['tol']
OBJ = HERE / 'objective.json'
SHARED = [('peak', 1.0, lambda t: .3 * t), ('base', 1.0, lambda t: .3 * t), ('black', 1.0, lambda t: .05),
          ('streak', 1.0, lambda t: .5 * t), ('bandCont', .5, lambda t: .10)]


def score(tag):
    return st.score_views(mc.COLOUR[tag], mc.NOHAIR[tag], TG, FRAME_ID, None, 'objective', None, None,
                          matte='%s/matte/mask-%s' % (OPT, tag))


def main():
    g2, p2a = score('g2'), score('p2a')
    r10, b3 = score('r10'), score('best3')
    e1 = json.load(open(str(mc.MD / 'check.json')))['e123']['matte']['E1']
    out = dict(frame_id=FRAME_ID, frames_sha256=hashlib.sha256(FRAMES.read_bytes()).hexdigest(), views={})
    for v in VIEWS:
        tr = g2['views'][v]['target']
        seed_terms = {m: w * TOL[v][m]['tol'] / f(tr[m]) for m, w, f in SHARED}
        ds = sum(seed_terms.values())
        dg = abs(g2['views'][v]['D_v'] - p2a['views'][v]['D_v'])
        Dl = e1[v]['r10'] - e1[v]['best3']
        out['views'][v] = dict(D_g2=g2['views'][v]['D_v'], D_p2a=p2a['views'][v]['D_v'], delta_grader=dg, delta_seed=ds, delta=max(ds, dg),
                               seed_terms=seed_terms, iou_g2=g2['views'][v]['metrics']['iou'], iou_p2a=p2a['views'][v]['metrics']['iou'],
                               iou_floor=g2['views'][v]['metrics']['iou'] - ds * 0.05,
                               Delta_E1_matte=Dl,
                               Delta_registered=r10['views'][v]['D_v'] - b3['views'][v]['D_v'],
                               D_r10_reg=r10['views'][v]['D_v'], D_best3_reg=b3['views'][v]['D_v'])
    V = out['views']
    out['sum_delta'] = sum(V[v]['delta'] for v in VIEWS)
    out['sum_Delta_E1_matte'] = sum(V[v]['Delta_E1_matte'] for v in VIEWS)
    out['sum_Delta_registered'] = sum(V[v]['Delta_registered'] for v in VIEWS)
    out['threshold'] = out['sum_Delta_E1_matte'] / 4
    out['pass'] = bool(out['sum_delta'] < out['threshold'])  # SPEC: sum delta >= sum Delta/4 => FAIL
    out['verdict'] = 'PASS' if out['pass'] else 'FAIL'
    (OPT / 'noise-floors-registered.json').write_text(json.dumps(out, indent=1, default=float))
    print(json.dumps({k: v for k, v in out.items() if k != 'views'}, indent=1, default=float))
    for v in VIEWS:
        print(v, {k: (round(x, 4) if isinstance(x, float) else x) for k, x in V[v].items() if k != 'seed_terms'})
    if not out['pass']:
        print('FAIL: objective.json not modified')
        return 1
    ob = json.load(open(OBJ))
    ob['frozen'] = True
    ob['frozenAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    ob['scoreTrialSha256'] = hashlib.sha256((HERE / 'score_trial.py').read_bytes()).hexdigest()
    ob['frame'] = dict(id=FRAME_ID, framesFile='.openclinxr/opt/hair-groom-2/frames-fithead.json', framesSha256=out['frames_sha256'],
                       direction='to-runtime (targets mapped into the runtime crop frame; crops, nohair and matte stay native)',
                       fit='runtime_frame.py fit-head, g2 nohair crops vs EV/p3/srcdir (same body)',
                       headIoU={v: json.load(open(FRAMES))[v]['headIoU'] for v in VIEWS},
                       targetsDir='.openclinxr/opt/hair-groom-2/tgt-fithead', mask='matte (batch.ts matte:true, matte.py)')
    ob['hard']['iouFloor'] = {v: round(V[v]['iou_floor'], 4) for v in VIEWS}
    ob['hard']['iouFloorRule'] = 'IoU_v(g2, registered frame, matte) - delta_seed_v * 0.05 (A2; delta_seed D units -> IoU units by the iou scale .05)'
    ob['hard'].pop('backRule', None)
    ob['noise'] = dict(
        delta_seed_v={v: V[v]['delta_seed'] for v in VIEWS}, delta_grader_v={v: V[v]['delta_grader'] for v in VIEWS},
        Delta_v_A3={v: V[v]['Delta_E1_matte'] for v in VIEWS},
        delta_v={v: V[v]['delta'] for v in VIEWS},
        note='measured %s on matte masks in frame %s; delta_seed from EV/p3/tol.json (peak, base, black, streak, bandCont); '
             'delta_grader=|D_v(g2)-D_v(p2a)|; Delta_v_A3 key now holds STEP C E1 matte values D_v(r10)-D_v(best3) (p1-rt frame). '
             'Source: .openclinxr/opt/hair-groom-2/noise-floors-registered.json' % (ob['frozenAt'], FRAME_ID))
    ob['source'] = ob['source'].replace('frozen 2026-11-10', 'frozen %s (A1-A3 applied)' % ob['frozenAt'])
    OBJ.write_text(json.dumps(ob, indent=2) + '\n')
    chk = st.score_views(mc.COLOUR['g2'], mc.NOHAIR['g2'], TG, FRAME_ID, None, 'objective', None, None,
                         matte='%s/matte/mask-g2' % OPT)
    print('objective.json frozen; g2 incumbent under the frozen floors: feasible=%s violation=%.3f hard=%s' % (chk['feasible'], chk['violation'], chk['hard']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
