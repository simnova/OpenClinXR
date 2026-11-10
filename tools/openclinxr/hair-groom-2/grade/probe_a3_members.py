# I19 probe: A3 on a card round from card-borne member tips, against the I7 strand-tip statistic.
# Usage: <blender python> probe_a3_members.py <scratch-dir> [cards-round, default cards-r4/s6]
# Uses tip_median_a3 and card_member_tips from grade.py itself (ast-extracted), then runs grade.py end to end.
#   known-good 1: groom-r7/s1 strands.npz tips through tip_median_a3 (I7) -> PASS
#   known-good 2: cards-r4/s6 card-borne member tips -> PASS
#   known-bad:    cards.npz copy with every card shortened by 60 mm of centreline arc (stations resampled on the
#                 original card surface, member file and atlas record unchanged) -> FAIL, in grade.py A3 as well
#   revert:       the unmodified cards.npz copy -> PASS, in grade.py A3 as well
import ast, json, os, shutil, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../..'))
E = os.path.join(WT, '.openclinxr/evidence/hair-groom-2')
SCR = os.path.abspath(sys.argv[1])
CR = os.path.join(E, sys.argv[2] if len(sys.argv) > 2 else 'cards-r4/s6')
TARGET_Z = 1.1710012237575196        # grade.py target side A3 z (target-profile-a1, I2)
SHORTEN_M = 0.060

src = open(os.path.join(HERE, 'grade.py')).read()
ns = dict(np=np, os=os, json=json, WT=WT)
for node in ast.parse(src).body:
    if isinstance(node, ast.FunctionDef) and node.name in ('tip_median_a3', 'card_member_tips'):
        exec(compile(ast.Module([node], []), 'grade.py', 'exec'), ns)
tip_median_a3, card_member_tips = ns['tip_median_a3'], ns['card_member_tips']


def show(label, r):
    print('%-44s median %.4f p10 %.4f p90 %.4f dz %+.1f mm -> %s' % (label, r['median'], r['p10'], r['p90'], r['dzMm'], 'PASS' if r['ok'] else 'FAIL'))
    return r['ok']


res = {}
s = np.load(os.path.join(E, 'groom-r7/s1/strands.npz'))
res['r7 strands (I7)'] = show('r7/s1 strand tips (I7)', tip_median_a3(s['positions'][s['offsets'][1:] - 1][:, 2], TARGET_Z))

st = json.load(open(os.path.join(CR, 'round/stats.json')))
mt = card_member_tips(st)
res['cards baseline'] = show('%s card-borne member tips' % os.path.relpath(CR, E), tip_median_a3(mt['tipsZ'], TARGET_Z))


def shorten(c, d):
    n = int(c['n_cards']); V = c['card_verts'].reshape(n, -1, 2, 3).copy(); S = V.shape[1]
    out = V.copy(); short = 0
    for i in range(n):
        C = V[i].mean(1); cs = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))]); L = cs[-1]
        L2 = max(L - d, 0.1 * L); short += L - d < 0.1 * L
        tq = np.linspace(0, L2, S)
        for e in range(2):
            for k in range(3):
                out[i, :, e, k] = np.interp(tq, cs, V[i, :, e, k])
    return out.reshape(-1, 3), short


def stage(name, modify):
    rd = os.path.join(SCR, name); cd = os.path.join(rd, 'cards'); os.makedirs(cd, exist_ok=True)
    for f in ('card-members.npz', 'atlas-record.json', 'body-geo.npz'):
        shutil.copyfile(os.path.join(os.path.dirname(os.path.join(WT, st['cards'])), f), os.path.join(cd, f))
    c = dict(np.load(os.path.join(WT, st['cards'])))
    if modify:
        c['card_verts'], short = shorten(c, SHORTEN_M); print('shortened %d cards by %.0f mm (%d floored at 10%% of length)' % (int(c['n_cards']), SHORTEN_M * 1000, short))
    np.savez(os.path.join(cd, 'cards.npz'), **c)
    rr = os.path.join(rd, 'round'); shutil.copytree(os.path.join(CR, 'round'), rr, dirs_exist_ok=True)
    s2 = dict(st); s2['cards'] = os.path.join(cd, 'cards.npz'); json.dump(s2, open(os.path.join(rr, 'stats.json'), 'w'), indent=1)
    r = card_member_tips(s2); ok = show('%s card-borne member tips' % name, tip_median_a3(r['tipsZ'], TARGET_Z))
    p = subprocess.run([sys.executable, os.path.join(HERE, 'grade.py'), rr, os.path.join(rd, 'grade')], capture_output=True, text=True)
    a3 = [l for l in p.stdout.splitlines() if l.startswith('A3 ')]
    print('  grade.py: ' + (a3[0] if a3 else p.stderr[-400:]))
    return ok, bool(a3) and ' PASS ' in a3[0]


res['shortened 60 mm'] = stage('shortened-60mm', True)
res['revert'] = stage('revert', False)
want = {'r7 strands (I7)': True, 'cards baseline': True, 'shortened 60 mm': (False, False), 'revert': (True, True)}
okall = all(res[k] == want[k] for k in want)
print('PROBE', 'OK' if okall else 'UNEXPECTED', res)
sys.exit(0 if okall else 1)
