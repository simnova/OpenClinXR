"""Fixed-d5 hair look probe and CMA-ES station for hair-light-2.

Run only with Blender. Geometry is constructed once per strand-count variant;
all ordinary candidates mutate material/lights/profile only.
"""
from __future__ import annotations

import importlib.util
import json
import math
import shutil
import statistics
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from PIL import Image
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
VIEWS = ("front", "three_quarter", "profile_90", "back", "crown_top")

sys.path.insert(0, str(HERE))
import children as ch
from cmaes import CMAES
from measure import rgb, mask, lum, stats, front_regions, cheek_stats, measure_set


BASE = json.load(open(ROOT / "tools/openclinxr/evidence/hair-search2/best.json"))["params"]
DIAG = json.load(open(HERE / "diagnosis.json"))
BASE_FACE = DIAG["ours"]["cheek"]["p50"]
BASE_MASK = DIAG["ours"]["mask_area"]["front_px"]
TARGET_METRICS = DIAG["target"]


def smooth(u):
    u = np.clip(u, 0., 1.)
    return u*u*(3.-2.*u)


def generate_geometry(state, count):
    """Exact copied d5 construction, with count as the sole variable."""
    bp, c3, handle, cap_obj = state["bp"], state["c3"], state["handle"], state["cap"]
    gd = np.load(HERE / "guides16.npz")
    cd = np.load(CAP)
    style = json.load(open(HERE / "style.json"))
    meta = {}
    override = ch.front_fill_override(bp, cd, count, bp.SEED, False)
    kids = bp._blend_children_base(gd, cd, len(override[0]), bp.SEED, meta,
        _roots_override=override, _closure_on=True, _same_side_ahead_only=True,
        _weight_jitter=False)
    roots = np.asarray(meta["roots_cap"])
    normals = np.asarray(meta["root_nor"])
    kids, semantic = ch.curtain_preserving_children(
        gd, cd, roots, float(style["curtain_blend_band_mm"]), None, 0., False)
    kids = ch.apply_side_clearance(kids, roots, semantic, float(cd["cx"]),
                                   float(style["curtain_clearance_max_mm"]))
    kids, construction = ch.repair_outside(kids, handle)
    kids, smoothing = ch.resample_smooth(kids, cd)
    kids = ch.apply_rounded_hem(kids, roots, cd, float(style["hem_u_mm"]),
                                float(style["hem_raise_mm"]))
    kids, collision = ch.repair_outside(kids, handle)
    return kids, {"requested": count, "generated": len(kids),
                  "construction": construction, "smoothing": smoothing,
                  "collision": collision, "root_count": len(roots)}


def make_object(state, count, tag):
    started = time.monotonic()
    kids, meta = generate_geometry(state, count)
    obj = state["bp"].build_blend_curves(state["handle"], state["cap"], kids,
                                          "UVMap", tag)
    obj.data.materials.clear()
    obj.data.materials.append(state["material"])
    meta["build_seconds"] = time.monotonic() - started
    return obj, meta


def build_state():
    bp = ch.load_blend()
    c3 = bp.import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = bp.load_groups_blend()
    uv = next((x for x in handle.head.data.uv_layers if x.active_render), None)
    uvn = uv.name if uv else handle.head.data.uv_layers[0].name
    cap_obj, cap_info = c3.build_cap_surface(handle, uvn)
    material = canonical.data.materials[0]
    state = {"bp":bp, "c3":c3, "hs":hs, "handle":handle, "canonical":canonical,
             "groups":groups, "cap":cap_obj, "cap_info":cap_info,
             "material":material, "objects":{}}
    obj, meta = make_object(state, 50000, "look_base")
    state["objects"]["base"] = obj
    state["geometry_meta"] = {"base":meta}
    bp.apply_r4_visibility(handle, obj)
    state["light_xy"] = {light.name:(float(light.location.x), float(light.location.y))
                         for light in handle.lights}
    return state


def shader_node(material):
    return next(n for n in material.node_tree.nodes if n.type == "BSDF_HAIR_PRINCIPLED")


def rebuild_material(state, params, obj):
    mat = state["material"]
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.parametrization = "MELANIN"
    links.new(hair.outputs[0], out.inputs["Surface"])
    melanin = float(params.get("melanin", BASE["melanin"]))
    roughness = float(params.get("roughness", BASE["roughness"]))
    root_dark = float(params.get("root_dark", 0.0))
    random_amount = float(params.get("random", 0.0))
    hair.inputs["Melanin Redness"].default_value = float(params.get("redness", BASE["redness"]))
    hair.inputs["Radial Roughness"].default_value = .2
    if "Coat" in hair.inputs:
        hair.inputs["Coat"].default_value = float(params.get("coat", hair.inputs["Coat"].default_value))
    if "IOR" in hair.inputs:
        hair.inputs["IOR"].default_value = float(params.get("ior", hair.inputs["IOR"].default_value))

    mel_out = None
    rough_out = None
    if root_dark:
        info = nodes.new("ShaderNodeHairInfo")
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (min(1., melanin*(1.+root_dark)),)*3 + (1.,)
        ramp.color_ramp.elements[1].position = .075  # 15 mm of ~200 mm sheet
        ramp.color_ramp.elements[1].color = (melanin, melanin, melanin, 1.)
        links.new(info.outputs["Intercept"], ramp.inputs["Fac"])
        mel_out = ramp.outputs["Color"]
    if random_amount:
        attr = obj.data.attributes.get("look_random")
        if attr is None:
            attr = obj.data.attributes.new("look_random", "FLOAT", "CURVE")
            rng = np.random.default_rng(20261014)
            values = rng.random(len(obj.data.curves)).astype(np.float32)
            attr.data.foreach_set("value", values)
        named = nodes.new("ShaderNodeAttribute")
        named.attribute_name = "look_random"
        mm = nodes.new("ShaderNodeMapRange")
        mm.inputs["From Min"].default_value = 0.
        mm.inputs["From Max"].default_value = 1.
        mm.inputs["To Min"].default_value = melanin*(1.-random_amount)
        mm.inputs["To Max"].default_value = min(1., melanin*(1.+random_amount))
        links.new(named.outputs["Fac"], mm.inputs["Value"])
        if mel_out:
            mul = nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
            # Normalize the random melanin about the nominal value before multiply.
            scale = nodes.new("ShaderNodeMath"); scale.operation = "DIVIDE"
            scale.inputs[1].default_value = melanin
            links.new(mm.outputs["Result"], scale.inputs[0])
            links.new(mel_out, mul.inputs[0]); links.new(scale.outputs[0], mul.inputs[1])
            mel_out = mul.outputs[0]
        else:
            mel_out = mm.outputs["Result"]
        rr = nodes.new("ShaderNodeMapRange")
        rr.inputs["To Min"].default_value = roughness*(1.-random_amount)
        rr.inputs["To Max"].default_value = roughness*(1.+random_amount)
        links.new(named.outputs["Fac"], rr.inputs["Value"])
        rough_out = rr.outputs["Result"]
    if mel_out: links.new(mel_out, hair.inputs["Melanin"])
    else: hair.inputs["Melanin"].default_value = melanin
    if rough_out: links.new(rough_out, hair.inputs["Roughness"])
    else: hair.inputs["Roughness"].default_value = roughness
    return {name:float(hair.inputs[name].default_value) if not hair.inputs[name].is_linked else "linked"
            for name in ("Melanin", "Melanin Redness", "Roughness", "Radial Roughness", "Coat", "IOR")
            if name in hair.inputs}


def set_profile(state, obj, radius):
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    _, readback = state["bp"].add_profile(state["c3"], obj, state["groups"], radius)
    return readback


def set_lights(state, params):
    target = Vector(state["handle"].target)
    values = {
        "OCLX_key": (float(params.get("key_elev_deg", BASE["key_elev_deg"])),
                     float(params.get("key_energy", 150.)),
                     float(params.get("key_size_m", BASE["key_size_m"]))),
        "OCLX_fill": (float(params.get("fill_elev_deg", BASE["fill_elev_deg"])),
                      float(params.get("fill_W", BASE["fill_W"])), 1.7),
        "OCLX_rim": (40., BASE["rim_W"], 1.0),
    }
    report = {}
    for light in state["handle"].lights:
        elev, energy, size = values[light.name]
        x, y = state["light_xy"][light.name]
        if light.name == "OCLX_key" and params.get("key_azimuth_delta_deg"):
            angle = math.radians(float(params["key_azimuth_delta_deg"]))
            dx, dy = x-target.x, y-target.y
            x = target.x + dx*math.cos(angle)-dy*math.sin(angle)
            y = target.y + dx*math.sin(angle)+dy*math.cos(angle)
        light.location.x, light.location.y = x, y
        radial = math.hypot(x-target.x, y-target.y)
        light.location.z = target.z + radial*math.tan(math.radians(elev))
        light.data.energy, light.data.size = energy, size
        state["hs"]._track(light, target) if hasattr(state["hs"], "_track") else None
        # hair_scene exports _track; fallback is direct quaternion.
        light.rotation_euler = (target-light.location).to_track_quat("-Z", "Y").to_euler()
        report[light.name] = {"position":[float(x) for x in light.location],
                              "energy_W":energy, "size_m":size, "elevation_deg":elev}
    return report


def select_object(state, variant):
    if variant == "dense" and "dense" not in state["objects"]:
        obj, meta = make_object(state, 85000, "look_dense")
        state["objects"]["dense"] = obj
        state["geometry_meta"]["dense"] = meta
    return state["objects"][variant]


def render_id(state, obj, path, size):
    old = state["handle"].hair
    state["handle"].hair = obj
    try: state["hs"]._render_id(state["handle"], path, size)
    finally: state["handle"].hair = old


def prepare_visibility(state, obj):
    for other in state["objects"].values():
        other.hide_render = other is not obj
        other.hide_viewport = other is not obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False


def render_candidate(state, tag, params, views, size=1024, samples=64, seed=0):
    variant = params.get("variant", "base")
    obj = select_object(state, variant)
    prepare_visibility(state, obj)
    material = rebuild_material(state, params, obj)
    profile = set_profile(state, obj, float(params.get("radius_m", .00005)))
    lights = set_lights(state, params)
    out = HERE / tag
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    result = {"tag":tag, "params":params, "variant":variant, "material":material,
              "profileReadback":profile, "lights":lights, "size":size,
              "samples":samples, "cyclesSeed":seed, "renders":{}}
    old = state["handle"].hair
    state["handle"].hair = obj
    started = time.monotonic()
    try:
        for view in views:
            state["c3"].set_final_view(state["handle"], view)
            beauty, ident = out/(view+".png"), out/(view+"-id.png")
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.cycles.samples = samples
            scene.cycles.seed = seed
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            render_id(state, obj, ident, size)
            result["renders"][view] = {"png":str(beauty), "id_png":str(ident)}
            print("LOOK_RENDERED", tag, view, flush=True)
    finally:
        state["handle"].hair = old
    result["seconds"] = time.monotonic()-started
    return result


def front_metrics(beauty_path, id_path):
    image, m = rgb(Path(beauty_path)), mask(Path(id_path))
    regions = {n:stats(image, s) for n,s in front_regions(m).items()}
    whole = stats(image, m)
    regions["whole_front"] = whole
    regions["part_side_ratio"] = regions["crown_part_band"]["mean_luminance"] / max(regions["sides"]["mean_luminance"], 1e-9)
    regions["cheek"] = cheek_stats(image, m)
    native_px = int(m.sum())
    equiv_px = native_px * (1024.0 / m.shape[0])**2
    regions["mask_area_px_native"] = native_px
    regions["mask_area_px"] = int(round(equiv_px))
    regions["mask_area_change_pct"] = 100.*(equiv_px-BASE_MASK)/BASE_MASK
    return regions


def score(metrics):
    whole, target = metrics["whole_front"], TARGET_METRICS["whole_front"]
    terms = {
        "p50": 2.*abs(math.log(max(whole["p50"],1e-8)/target["p50"])),
        "p90": 2.*abs(math.log(max(whole["p90"],1e-8)/target["p90"])),
        "RB": abs(math.log(max(whole["RB"],1e-8)/target["RB"])),
        "part_side": 2.*max(0., metrics["part_side_ratio"]-1.6),
        "face": 100.*max(0., abs(metrics["cheek"]["p50"]/BASE_FACE-1.)-.05),
        "mask": 20.*max(0., abs(metrics["mask_area_change_pct"])-2.)/100.,
    }
    terms["total"] = sum(terms.values())
    return terms


def baseline_score():
    m = dict(DIAG["ours"])
    m["mask_area_px"] = BASE_MASK
    m["mask_area_change_pct"] = 0.
    return score(m)


PROBES = {
    "r1": {"variant":"dense", "radius_m":.00003},
    "r2": {"roughness":BASE["roughness"]+.1},
    "r3": {"coat":0., "ior":1.30},
    "r4": {"root_dark":.30},
    "r5": {"key_elev_deg":46., "key_size_m":2.0},
    "r6": {"random":.10},
}


def run_probes(state):
    rows = []
    for tag, change in PROBES.items():
        rec = render_candidate(state, "probes/"+tag, change, ("front","back"), 1024, 64, 0)
        rec["metrics"] = measure_set(Path(rec["renders"]["front"]["png"]), Path(rec["renders"]["front"]["id_png"]),
                                     Path(rec["renders"]["back"]["png"]), Path(rec["renders"]["back"]["id_png"]))
        # Flatten the common front metrics contract for scoring.
        fm = {**rec["metrics"], "mask_area_px":rec["metrics"]["mask_area"]["front_px"]}
        fm["mask_area_change_pct"] = 100.*(fm["mask_area_px"]-BASE_MASK)/BASE_MASK
        rec["score"] = score(fm)
        rec["face_drift_pct"] = 100.*(rec["metrics"]["cheek"]["p50"]/BASE_FACE-1.)
        rec["mask_area_change_pct"] = fm["mask_area_change_pct"]
        rows.append(rec)
        (HERE/"probes"/(tag+".json")).write_text(json.dumps(rec,indent=2,default=str)+"\n")
    (HERE/"probes/summary.json").write_text(json.dumps({"baselineScore":baseline_score(),"probes":rows},indent=2,default=str)+"\n")
    return rows


def combo_from_probes(rows):
    base = baseline_score()["total"]
    improving = [row for row in rows if row["score"]["total"] < base
                 and abs(row["face_drift_pct"]) <= 5.
                 and abs(row["mask_area_change_pct"]) <= 2.]
    params = {}
    for row in improving:
        params.update(PROBES[row["tag"].split("/")[-1]])
    if not improving:
        best = min(rows, key=lambda r:r["score"]["total"])
        params.update(PROBES[best["tag"].split("/")[-1]])
    # Avoid silently losing r1 when later dictionary updates omit variant.
    if any(r["tag"].endswith("r1") for r in improving): params["variant"]="dense"; params["radius_m"]=.00003
    return params, [r["tag"].split("/")[-1] for r in improving]


SEARCH_NAMES = ("roughness","melanin","redness","key_elev_deg","key_energy","key_size_m","root_dark","random")
SEARCH_BOUNDS = ((.12,.45),(.72,1.0),(.55,.90),(38.,58.),(100.,170.),(1.4,3.0),(0.,.40),(0.,.12))


def normalize(params):
    defaults = {**BASE, "key_energy":150., "root_dark":0., "random":0.}
    defaults.update(params)
    return [(defaults[n]-lo)/(hi-lo) for n,(lo,hi) in zip(SEARCH_NAMES,SEARCH_BOUNDS)]


def denormalize(vec, fixed):
    out = dict(fixed)
    out.update({n:lo+float(x)*(hi-lo) for n,x,(lo,hi) in zip(SEARCH_NAMES,vec,SEARCH_BOUNDS)})
    return out


def run_search(state, combo):
    rng = np.random.RandomState(20261014)
    es = CMAES(np.clip(normalize(combo),0,1), .18, 8, rng)
    rows=[]; index=0
    for generation in range(3):
        vectors=es.ask(); scores=[]
        for vector in vectors:
            params=denormalize(vector, {k:v for k,v in combo.items() if k not in SEARCH_NAMES})
            rec=render_candidate(state, f"search/eval-{index:03d}", params, ("front",), 512, 32, 0)
            metrics=front_metrics(rec["renders"]["front"]["png"],rec["renders"]["front"]["id_png"])
            fit=score(metrics); scores.append(fit["total"])
            row={"index":index,"generation":generation,"params":params,"metrics":metrics,"fitness":fit,
                 "beauty":rec["renders"]["front"]["png"],"id":rec["renders"]["front"]["id_png"],"seconds":rec["seconds"]}
            rows.append(row); index+=1
            with open(HERE/"search/lineage.jsonl","a") as f:f.write(json.dumps(row,sort_keys=True)+"\n")
        es.tell(vectors,scores)
    best=min(rows,key=lambda r:r["fitness"]["total"])
    (HERE/"search/report.json").write_text(json.dumps({"evaluations":len(rows),"generations":3,"population":8,
        "warmStart":combo,"best":best},indent=2)+"\n")
    return best, rows


def confirm_best(state, params):
    runs=[]
    for seed in (0,1,2):
        views=VIEWS if seed==0 else ("front",)
        rec=render_candidate(state, f"best/seed-{seed}", params, views, 1024, 64, seed)
        fm=front_metrics(rec["renders"]["front"]["png"], rec["renders"]["front"]["id_png"])
        runs.append({"seed":seed,"metrics":fm,"fitness":score(fm),"seconds":rec["seconds"],"renders":rec["renders"]})
    keys=("p50","p90","RB")
    spread={k:{"mean":statistics.fmean(r["metrics"]["whole_front"][k] for r in runs),
               "sd":statistics.pstdev(r["metrics"]["whole_front"][k] for r in runs),
               "min":min(r["metrics"]["whole_front"][k] for r in runs),
               "max":max(r["metrics"]["whole_front"][k] for r in runs)} for k in keys}
    doc={"params":params,"runs":runs,"spread":spread,"geometry":state["geometry_meta"]}
    (HERE/"best/params.json").write_text(json.dumps(doc,indent=2,default=str)+"\n")
    return doc


def copy_baselines():
    out=HERE/"baseline";out.mkdir(exist_ok=True)
    source=ROOT/"tools/openclinxr/evidence/hair-curtain4/best/children"
    for name in ("front","three_quarter","profile_90","back","crown_top"):
        for suffix in (".png","-id.png"):
            shutil.copy2(source/(name+suffix),out/(name+suffix))


def main():
    started=time.monotonic()
    copy_baselines()
    for d in (HERE/"probes",HERE/"search",HERE/"best",HERE/"combo"):
        d.mkdir(parents=True,exist_ok=True)
    (HERE/"search/lineage.jsonl").write_text("")
    state=build_state()
    rows=run_probes(state)
    combo,improving=combo_from_probes(rows)
    combo_rec=render_candidate(state,"combo",combo,VIEWS,1024,64,0)
    combo_doc={"params":combo,"improvingProbes":improving,"renders":combo_rec["renders"],
               "metrics":front_metrics(combo_rec["renders"]["front"]["png"],combo_rec["renders"]["front"]["id_png"])}
    (HERE/"combo/params.json").write_text(json.dumps(combo_doc,indent=2)+"\n")
    best,_=run_search(state,combo)
    final=confirm_best(state,best["params"])
    (HERE/"station.json").write_text(json.dumps({"wallSeconds":time.monotonic()-started,"probes":len(rows),
        "searchEvaluations":24,"combo":combo,"improvingProbes":improving,"bestParams":best["params"],
        "bestSpread":final["spread"],"geometry":state["geometry_meta"]},indent=2,default=str)+"\n")
    print("HAIR_LIGHT2_STATION_DONE",flush=True)


if __name__=="__main__": main()
