"""measure8: render-level G3/G4-profile/G4-front on blend passB (same HS framing as blend)."""
import argparse, importlib.util, json, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector
HERE = Path(__file__).resolve().parent
E = HERE

def load_hs():
    p = HERE.parent / "hair-scene" / "hair_scene.py"
    s = importlib.util.spec_from_file_location("oclx_hs", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m

def load_c3():
    p = HERE.parent / "hair-children" / "children3.py"
    s = importlib.util.spec_from_file_location("c3m", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m

def hair_mask(png):
    from PIL import Image
    im = Image.open(png)
    if im.mode == "RGBA":
        a = np.array(im)[:, :, 3].astype(np.float64)
        hi = (a >= 0.9 * 255).mean(); lo = (a <= 0.1 * 255).mean()
        if hi > 0.01 and lo > 0.01: return a >= 0.9 * 255
        return np.array(im.convert("RGB")).astype(np.float64).mean(axis=2) > 0.5
    return np.array(im.convert("L")).astype(np.float64) > 0.5 * 255

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cell", choices=("A", "B"), required=True)
    cell = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).cell
    CD = E / cell; stats = json.loads((CD / "stats8.json").read_text())
    ears = {nm: {kk: np.array(vv) for kk, vv in e.items() if kk != "n"} for nm, e in stats["ears"].items()}
    HS = load_hs(); h = HS.build_scene(); body = h.head
    c3 = load_c3()
    bpy.context.view_layer.update()
    W = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices])
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    medy = float(np.median(W[:, 1])); menton = float(stats["menton_z"])
    sc = bpy.context.scene; cam = h.camera
    import bpy_extras.object_utils as OU
    out = {}
    # pinna verts: M1 hull input box per side
    pin = {}
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        e = ears[nm]
        ylo, yhi = float(e["ear_front"][1]) - 0.015, float(e["ear_back"][1]) + 0.020
        zlo, zhi = float(e["lobe"][2]) - 0.025, float(e["ear_top"][2]) + 0.015
        pin[nm] = W[((W[:, 0] - cx) * sgn > 0.030) & (W[:, 1] >= ylo) & (W[:, 1] <= yhi)
                    & (W[:, 2] >= zlo) & (W[:, 2] <= zhi)]
        print("MEASURE pin %s n=%d" % (nm, len(pin[nm])))
    # front: verify menton row vs judge chin 583, ear band rows
    c3.set_final_view(h, "front"); bpy.context.view_layer.update()
    Hpx = Wpx = 1024
    def rc(p):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * Hpx), int(v.x * Wpx)
    rment, cment = rc((cx, medy, menton))
    print("MEASURE front menton row=%d col=%d (judge chin=583 centre=512)" % (rment, cment))
    out["menton_row"] = rment; out["menton_col"] = cment
    fimg = hair_mask(CD / "blend" / "passB" / "front-id.png")
    from PIL import Image
    beau = np.asarray(Image.open(CD / "blend" / "passB" / "front.png").convert("RGB")).astype(np.int32)
    Rb, Gb, Bb = beau[..., 0], beau[..., 1], beau[..., 2]
    skin = (Rb > 100) & (Rb - Gb > 8) & (Rb - Bb > 8) & (Gb > 80) & (Bb > 60) & (Rb < 245)
    # ear band rows from projected ear_top / lobe (both sides)
    rws = []; 
    for nm in ("L", "R"):
        rws.append(rc(ears[nm]["ear_top"])[0]); rws.append(rc(ears[nm]["lobe"])[0])
    rlo, rhi = max(min(rws) - 5, 0), min(max(rws) + 5, Hpx - 1)
    eL = eR = 0
    for r in range(rlo, rhi + 1):
        cols = np.where(fimg[r] > 0)[0]
        if len(cols) == 0: continue
        Lr, Rr = int(cols.min()), int(cols.max())
        eL += int(skin[r, :Lr].sum()); eR += int(skin[r, Rr + 1:].sum())
    print("MEASURE front earSkinL=%d earSkinR=%d band=%d-%d" % (eL, eR, rlo, rhi))
    out.update({"earSkinL": eL, "earSkinR": eR, "ear_band": [rlo, rhi]})
    # profile (right ear visible): pinna bbox coverage on passB profile-id
    c3.set_final_view(h, "profile_90"); bpy.context.view_layer.update()
    pimg = hair_mask(CD / "blend" / "passB" / "profile_90-id.png")
    PHr, PWr = pimg.shape
    pr, pc = [], []
    for p in pin["R"]:
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        pr.append(int((1 - v.y) * PHr)); pc.append(int(v.x * PWr))
    rmin, rmax = max(min(pr), 0), min(max(pr), PHr - 1)
    cmin, cmax = max(min(pc), 0), min(max(pc), PWr - 1)
    area = max((rmax - rmin + 1) * (cmax - cmin + 1), 1)
    cov = float(pimg[rmin:rmax + 1, cmin:cmax + 1].sum() / area)
    print("MEASURE profile bbox rows %d-%d cols %d-%d hairCov=%.3f" % (rmin, rmax, cmin, cmax, cov))
    out.update({"prof_bbox": [rmin, rmax, cmin, cmax], "profHair": cov})
    (CD / "measure8.json").write_text(json.dumps(out, indent=1))
    print("WROTE", CD / "measure8.json")
main()
