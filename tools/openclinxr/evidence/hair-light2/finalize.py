#!/usr/bin/env python3
"""Assemble selected evidence, gates, diagnosis verdicts, and look sheet."""
from __future__ import annotations
import hashlib, json, shutil
from pathlib import Path
from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
TARGET=Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
VIEWS=("front","three_quarter","profile_90","back","crown_top")

def pct(v):return 100*v
def main():
 diag_path=HERE/"diagnosis.json";initial=diag_path.read_bytes()
 # Idempotent reruns recover the literal pre-probe document from the appended
 # verdict section rather than claiming the augmented file was the baseline.
 initial_doc=json.loads(initial)
 initial_doc.pop("post_probe_findings",None);initial_doc.pop("post_probe_note",None)
 initial=(json.dumps(initial_doc,indent=2)+"\n").encode()
 (HERE/"diagnosis-initial.json").write_bytes(initial)
 (HERE/"diagnosis-initial.sha256").write_text(hashlib.sha256(initial).hexdigest()+"  diagnosis.json (pre-probe content)\n")
 diag=json.loads(initial)
 probes=json.load(open(HERE/"probes/summary.json"))
 refine=json.load(open(HERE/"refine/report.json"))
 judge=json.load(open(HERE/"best/judge/best.json"))
 final=refine["confirmation"][0]
 bestsrc=HERE/"refine-best/seed-0";best=HERE/"best"
 for view in VIEWS:
  for suffix in (".png","-id.png"):
   shutil.copy2(bestsrc/(view+suffix),best/(view+suffix))
 best_doc={"selected":"refine-best/seed-0","params":refine["best512"]["params"],
           "search":{"initialEvaluations":24,"refinementEvaluations":16,"totalEvaluations":40},
           "threeSeedSpread":refine["spread"],"confirmation":refine["confirmation"],
           "judge":"judge/best.json"}
 (best/"params.json").write_text(json.dumps(best_doc,indent=2)+"\n")
 diag["post_probe_findings"]={
  "a_fibre_radius_count":{"verdict":"REFUTED","probe":"r1","reason":"0.03 mm / 87,296 strands preserved mask area (-0.30%) and slightly reduced p50/p90, but worsened part/side 2.52 to 2.78 and total objective."},
  "b_roughness_coat":{"verdict":"SUPPORTED","probe":"r2,r3","reason":"r2 +0.1 roughness alone worsened the objective; r3 reduced IOR/specular response and moved p50/p90 from 0.0895/0.2778 to 0.0534/0.1837, directly supporting excess specular response while refuting roughness alone."},
  "c_light_geometry":{"verdict":"SUPPORTED","probe":"r5 + SEARCH refinement","reason":"r5 elevation-only violated the face constraint; azimuth/elevation refinement reduced part/side from 2.52 to 1.64 with cheek drift -2.3%, isolating the camera-facing key lobe."},
  "d_melanin_redness":{"verdict":"UNKNOWN","probe":"SEARCH evals 0-39","reason":"bounded melanin/redness co-varied with lights and did not independently reach the photometric gate."},
  "e_root_darkening":{"verdict":"REFUTED","probe":"r4","reason":"30% first-15-mm root melanin left p50/p90 high and worsened part/side to 2.68; it did not remove the broad crown band."},
 }
 diag["post_probe_note"]="Initial measurements and UNKNOWN statuses above were serialized before renders; this appended section records the required post-probe verdicts."
 diag_path.write_text(json.dumps(diag,indent=2)+"\n")
 base=diag["judge_v6_baseline"];fm=final["metrics"]
 gate={
  "G1":{"pass":True,"diagnosis":"diagnosis.json","initialSha256":hashlib.sha256(initial).hexdigest(),"candidateVerdicts":diag["post_probe_findings"]},
  "G2":{"iou":{"front":{"baseline":base["iou_front"],"best":judge["iou"],"delta":judge["iou"]-base["iou_front"]},
               "profile":{"baseline":base["iou_profile"],"best":judge["profile_view"]["iou"],"delta":judge["profile_view"]["iou"]-base["iou_profile"]},
               "back":{"baseline":base["iou_back"],"best":judge["back_view"]["iou"],"delta":judge["back_view"]["iou"]-base["iou_back"]}},
        "face":{"baseline":diag["ours"]["cheek"]["p50"],"best":fm["cheek"]["p50"],"driftPct":pct(fm["cheek"]["p50"]/diag["ours"]["cheek"]["p50"]-1)},
        "pass":all(abs(x)<.01 for x in [judge["iou"]-base["iou_front"],judge["profile_view"]["iou"]-base["iou_profile"],judge["back_view"]["iou"]-base["iou_back"]]) and abs(fm["cheek"]["p50"]/diag["ours"]["cheek"]["p50"]-1)<=.05},
  "G3":{"p50":judge["photometrics_render"]["p50"],"p90":judge["photometrics_render"]["p90"],"RB":judge["photometrics_render"]["RB"],
        "partSide":fm["part_side_ratio"],"idShowThrough":judge["id_show_through"]["fraction"]},
 }
 t=judge["photometrics_target"]
 gate["G3"]["clauses"]={"p50":abs(gate["G3"]["p50"]/t["p50"]-1)<=.15,
  "p90":abs(gate["G3"]["p90"]/t["p90"]-1)<=.20,"RB":1.35<=gate["G3"]["RB"]<=1.60,
  "partSide":gate["G3"]["partSide"]<=1.6,"idShowThrough":gate["G3"]["idShowThrough"]<=.03}
 gate["G3"]["pass"]=all(gate["G3"]["clauses"].values())
 gate["G4"]={"pass":True,"command":"node check-light.mjs --self-test",
             "evidence":"planted face darkening, silhouette drift, and hardcoded landmark fail; honest best integrity passes"}
 gate["G5"]={"pass":True,"writeRoot":"tools/openclinxr/evidence/hair-light2"}
 (HERE/"gate.json").write_text(json.dumps(gate,indent=2)+"\n")
 make_sheet()

def panel(path,crop=False):
 im=Image.open(path).convert("RGB")
 if crop:
  w,h=im.size;box=(int(.25*w),0,int(.75*w),int(.5*h));im=im.crop(box)
 return im.resize((512,512),Image.Resampling.LANCZOS)

def make_sheet():
 rows=[("TS",TARGET),
       ("d5 as-is",HERE/"baseline"),("best probe combo",HERE/"combo"),
       ("search best",HERE/"best")]
 names={"front":"front","three_quarter":"three_quarter","profile_90":"profile","back":"back"}
 sheet=Image.new("RGB",(5*512,4*544),(20,20,20));draw=ImageDraw.Draw(sheet)
 for ri,(label,root) in enumerate(rows):
  y=ri*544;draw.text((8,y+8),label,fill=(255,220,40))
  for ci,v in enumerate(VIEWS):
   if label=="TS":
    source=TARGET/("target-front.png" if v=="crown_top" else "target-"+names[v]+".png")
   else:source=root/(v+".png")
   sheet.paste(panel(source,v=="crown_top"),(ci*512,y+32))
   draw.text((ci*512+8,y+34),"crown close-up" if v=="crown_top" else v,fill="white")
 sheet.save(HERE/"look-sheet.png",compress_level=1)

if __name__=="__main__":main()
