import json,glob,os,sys
for f in sorted(glob.glob(sys.argv[1]+"/*.json")):
    r=json.load(open(f)); n=os.path.basename(f)[:-5]
    print(f"### {n} pass={r['pass']} meshes={len(r['per_object'])} s={r['seconds']} diag-derived eps={r['eps']} tol={r['tol']} gap={r['gap']}")
    for e in r['errors']: print("  E", e[:230])
    for w in r['warnings']: print("  W", w[:230])
