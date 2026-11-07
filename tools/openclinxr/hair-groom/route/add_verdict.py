import sys
sys.path.insert(0, 'tools/openclinxr/hair-groom/route')
import json
import common as C

E = C.E
g = json.loads((E / 'gates.json').read_text())
reg = g['regional']
fails = []
for view in ('front', 'profile_90', 'back'):
    for name in ('crown', 'side_curtain_L', 'side_curtain_R', 'hem'):
        s = reg[view][name]
        for m, lim in (('excessP50', 12), ('excessP95', 24), ('missP50', 12), ('missP95', 24)):
            if s[m] > lim:
                fails.append('%s/%s %s=%s' % (view, name, m, s[m]))
verdict = {'verdict': 'MODEL_INADEQUATE' if fails else 'ADEQUATE',
           'regionalFails': fails,
           'crownTangentFail': g['crownTangent']['mean'] >= g['crownTangentGate']}
if verdict['crownTangentFail'] and verdict['verdict'] == 'ADEQUATE':
    verdict['verdict'] = 'MODEL_INADEQUATE'
g.update(verdict)
(E / 'gates.json').write_text(json.dumps(g, indent=1) + '\n')
print(json.dumps(verdict, indent=1))
C.write_inputs_log([])
