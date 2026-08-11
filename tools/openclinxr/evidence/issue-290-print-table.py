#!/usr/bin/env python3
"""Human-readable table printer for the issue-290 claim-region-extent artifact."""
import json, sys

def main(path: str) -> int:
    r = json.load(open(path))
    cam = r.get("camera", {})
    print("=" * 100)
    print(f"issue-290 claim-region-extent  scenario={r.get('scenarioId')}  mode={cam.get('mode')}")
    print(f"camera sanity: {cam.get('sanity')} — {cam.get('note', '')}")
    live = cam.get("liveRead") or {}
    if live:
        print(f"  live cam: pos={[round(v,3) for v in live.get('position',[])]} fov={live.get('fov')} "
              f"aspect={round(live.get('aspect',0),3)} framing=\"{live.get('framing','')}\"")
    ev = r.get("assetEvidence")
    if ev:
        print(f"asset evidence (post-load): pending={ev.get('pendingCount')} loaded={ev.get('loadedCount')} failed={ev.get('failedCount')}")
    print("=" * 100)
    for f in r.get("figures", []):
        print(f"\n### {f['bodyClassId']}  (actor {f['actorId']}, glb {f.get('glbPath','')}, bodyHeight {f['bodyHeightMeters']} m)")
        for slot in ("upper", "lower"):
            s = f["slots"].get(slot)
            if not s:
                continue
            band = s["bandBodyHeightFraction"]
            lat = s["lateralFootprintBodyHeightFraction"]
            print(f"\n  [{slot}] {s['garmentMeshName']} ({s['garmentTriangleCount']} tris)")
            print(f"    claim band (body-height fraction): {band[0]:.4f} .. {band[1]:.4f}   "
                  f"(meters {s['bandMeters'][0]:.3f} .. {s['bandMeters'][1]:.3f})")
            print(f"    lateral footprint (body-height fraction): min {lat['min']:.4f}, max {lat['max']:.4f}   "
                  f"(meters min {s['lateralFootprintMeters']['min']:.3f}, max {s['lateralFootprintMeters']['max']:.3f})")
            print(f"    region face count: {s['regionFaceCount']}")
            print(f"    {'boundary':<8} {'ring':>5} {'bare':>6} {'cov':>5} | {'vis':>5} {'frus':>5} {'back':>5} "
                  f"{'gOcc':>5} {'bOcc':>5} | {'full':>5} {'fullVis':>8} {'sampled':>8}")
            for b in ("above", "below", "lateral"):
                bd = s["boundaries"].get(b, {})
                ring = bd.get("immediateRing", {})
                full = bd.get("fullOutside", {})
                c = ring.get("camera", {})
                fc = full.get("camera", {})
                bare = ring.get("bareSkinCount")
                print(f"    {b:<8} {ring.get('faceCount',0):>5} {bare:>6} {ring.get('coveredByGarmentCount',0):>5} | "
                      f"{c.get('visible',0):>5} {c.get('outsideFrustum',0):>5} {c.get('backFacing',0):>5} "
                      f"{c.get('occludedByGarment',0):>5} {c.get('occludedByBodyOrOther',0):>5} | "
                      f"{full.get('faceCount',0):>5} {fc.get('visible',0):>8} {str(fc.get('occlusionSampled',False)):>8}")
            # ring position stats
            print(f"    ring positions:")
            for b in ("above", "below", "lateral"):
                bd = s["boundaries"].get(b, {})
                ring = bd.get("immediateRing", {})
                hf = ring.get("heightFraction") or {}
                lf = ring.get("lateralFraction") or {}
                if hf.get("mean") is not None:
                    print(f"      {b}: heightFrac mean={hf['mean']} min={hf['min']} max={hf['max']} | "
                          f"latFrac mean={lf.get('mean')} max={lf.get('max')}")
    rows = (r.get("summary") or {}).get("rows", [])
    print("\n" + "=" * 100)
    print("SUMMARY ROWS")
    for row in rows:
        print(json.dumps(row))
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ".openclinxr/evidence/issue-290/claim-region-extent.json"))
