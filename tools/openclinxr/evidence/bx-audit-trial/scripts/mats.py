import json,struct,sys,os,re
for p in sys.argv[1:]:
    b=open(p,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; g=json.loads(b[20:20+l])
    mats=g.get('materials',[])
    print("##",os.path.basename(p))
    for m in g.get('meshes',[]):
        n=m.get('name','')
        if not re.search(r'eyebrow|eyelash|garment|pants|jeans|gown|scrub|geometry|hair|teeth|iv_|pump|default|boots',n,re.I): continue
        ms=set()
        for pr in m['primitives']:
            mm=mats[pr['material']] if 'material' in pr else {}
            ms.add((mm.get('name','?')[:40],mm.get('doubleSided',False),mm.get('alphaMode','OPAQUE')))
        print("  ",n[:70],sorted(ms))
