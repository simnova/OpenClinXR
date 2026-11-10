import json
EV='/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2/.openclinxr/evidence/hair-groom-2/'
L=lambda f:json.load(open(EV+f))
sc=L('p1/score-ts-rt.json'); s1=L('p3/score-s1.json'); pp=L('p3/part-s1.json'); p2=L('p2/part-p2ab.json'); pg=L('p2/part-g.json')
VIEWS=['front','three_quarter_left','side','back']
# (term, metric field, scale(target)->s, weight)
SHEEN=[('peak','peak',lambda t:.3*t,1),('base','base',lambda t:.3*t,1),('black','black',lambda t:.05,1),
 ('hue','hue',lambda t:10.,.5),('sat','sat',lambda t:.3*t,1),('bandRowCol','bandRowCol',lambda t:.05,1),
 ('bandCont','bandCont',lambda t:.10,.5),('streak','streak',lambda t:.5*t,1)]
PART=[('partWidthMedPx','partWidthMedPx',lambda t:2.,1),('hairlineFalloffMedPx','hairlineFalloffMedPx',lambda t:4.,1),('hairlineRow','hairlineRow',lambda t:4.,1)]
def terms(c,t,spec):
    out={}
    for n,f,s,w in spec:
        if f not in c or f not in t: out[n]={'status':'MISSING'}; continue
        sc_=s(t[f]); nd=abs(c[f]-t[f])/sc_
        out[n]={'raw':c[f],'target':t[f],'scale':sc_,'w':w,'norm':nd,'wnorm':w*nd}
    return out
def tot(o): return sum(v['wnorm'] for v in o.values() if 'wnorm' in v)
R={'sheen':{}, 'part':{}}
def sheen(src,tgt='target',cands=()):
    for c in cands:
        R['sheen'].setdefault(src,{})[c]={}
        for v in VIEWS:
            o=terms(L_[src][c][v],L_[src][tgt][v],SHEEN)
            R['sheen'][src][c][v]={'terms':o,'D_v':tot(o)}
        R['sheen'][src][c]['D']=sum(R['sheen'][src][c][v]['D_v'] for v in VIEWS)
L_={'p1':sc,'p3':s1}
sheen('p1',cands=['r10','best3','ns15']); sheen('p3',cands=['strands','cards'])
def part(src,name,d,cands):
    R['part'][name]={}
    for c in cands:
        o=terms(d[c],d['target'],PART); R['part'][name][c]={'terms':o,'D_front_part':tot(o)}
part('p2','p2ab',p2,['best3','st14','p2a','p2b']); part('p2g','g',pg,['p2a','g1','g2'])
part('p3','s1',pp,['strands','cards'])
rows={}
p1=R['sheen']['p1']
for k in ['r10','ns15']:
    f={v:p1['best3'][v]['D_v']<p1[k][v]['D_v'] for v in VIEWS}
    inv={}
    for v in VIEWS:
        if not f[v]:
            inv[v]=[(t,round(p1['best3'][v]['terms'][t]['wnorm']-p1[k][v]['terms'][t]['wnorm'],3)) for t in p1['best3'][v]['terms'] if p1['best3'][v]['terms'][t]['wnorm']>p1[k][v]['terms'][t]['wnorm']]
    rows['E1' if k=='r10' else 'E2']={'status':'PASS' if all(f.values()) else 'FAIL','per_view':{v:{'D_best3':p1['best3'][v]['D_v'],'D_other':p1[k][v]['D_v'],'ratio':p1['best3'][v]['D_v']/p1[k][v]['D_v'],'pass':f[v]} for v in VIEWS},'inverting_terms_best3_minus_other':inv}
# E2 non-streak-only check
rows['E2']['D_v_excluding_streak']={v:{'best3':p1['best3'][v]['D_v']-p1['best3'][v]['terms']['streak']['wnorm'],'ns15':p1['ns15'][v]['D_v']-p1['ns15'][v]['terms']['streak']['wnorm']} for v in VIEWS}
pa=R['part']['p2ab']
e3=lambda c:pa[c]['terms']['partWidthMedPx']['wnorm']+pa[c]['terms']['hairlineFalloffMedPx']['wnorm']
rows['E3']={'status':'PASS' if e3('p2a')<e3('best3') else 'FAIL','p2a_width_falloff':e3('p2a'),'best3_width_falloff':e3('best3'),
 'with_hairlineRow':{'p2a':pa['p2a']['D_front_part'],'best3':pa['best3']['D_front_part']},
 'per_term':{t:{'p2a':pa['p2a']['terms'][t].get('wnorm'),'best3':pa['best3']['terms'][t].get('wnorm')} for t in pa['p2a']['terms']}}
pgd=R['part']['g']; a=pgd['p2a']['D_front_part']; g=pgd['g2']['D_front_part']
rows['E4']={'status':'PASS' if abs(g-a)<.02*a else 'FAIL','D_p2a_part_only':a,'D_g2_part_only':g,'rel_delta':(g-a)/a if a else None,
 'note':'sheen terms MISSING for p2a and g2 (no score-ts-rt entry); D = front part terms only, not full D; p2a is identical front-part record in part-p2ab and part-g except falloff',
 'per_term':{t:{'p2a':pgd['p2a']['terms'][t]['wnorm'],'g2':pgd['g2']['terms'][t]['wnorm']} for t in pgd['p2a']['terms']}}
ps=R['sheen']['p3']; 
rows['X1']={'sheen_D_v':{v:{'strands':ps['strands'][v]['D_v'],'cards':ps['cards'][v]['D_v']} for v in VIEWS},
 'sheen_D':{'strands':ps['strands']['D'],'cards':ps['cards']['D']},
 'sheen_per_term_wnorm':{v:{t:{'strands':ps['strands'][v]['terms'][t]['wnorm'],'cards':ps['cards'][v]['terms'][t]['wnorm']} for t in ps['strands'][v]['terms']} for v in VIEWS},
 'part_front':{c:R['part']['s1'][c] for c in ['strands','cards']},
 'caveat':'p3 target differs from p1 target (different frame: cols 431-522 vs 255-345); not comparable to E1/E2 numbers'}
R['rows']=rows
R['D_totals_p1']={c:p1[c]['D'] for c in p1}
R['missing']=['hairlineRow has no field in any sheen score; part-*.json have hairlineRow for front only','part metrics exist for front view only','p2a/g2 sheen metrics: absent','no grader verdict names ns15 literally: p1/grade-p1-map.md compares BEST3 vs NOMAP (control), grade.md sheen3-v1 compares BEST3 vs r10 and ALT']
json.dump(R,open('result.json','w'),indent=1)
print(json.dumps(rows,indent=1)[:6000]); print(R['D_totals_p1'])
