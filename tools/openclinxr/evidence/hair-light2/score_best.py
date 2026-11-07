#!/usr/bin/env python3
"""Run judge v6 on the selected refinement row with projected landmarks."""
from __future__ import annotations
import importlib.util, json, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
JUDGE=Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
MASKS=JUDGE/"target-set-back"

def triple(d, keys):return ",".join(str(d[k]) for k in keys)

def main():
 sys.path.insert(0,str(JUDGE))
 spec=importlib.util.spec_from_file_location("hair_judge_v6_light2",JUDGE/"hair_judge.py")
 mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
 lm=json.load(open(HERE/"landmarks.json"))["judge"]
 root=HERE/"refine-best/seed-0";out=HERE/"best/judge";out.mkdir(parents=True,exist_ok=True)
 doc=mod.judge(str(root/"front.png"),str(root/"front-id.png"),"hair-light-2-best",
  triple(lm["front"],("crown_top_row","chin_row","face_centre_col")),str(out),
  target_set="back",id_mask_path=str(root/"front-id.png"),
  profile_mask_path=str(root/"profile_90-id.png"),
  profile_landmarks=triple(lm["profile"],("crown_top_row","chin_row","forehead_front_col")),
  back_mask_path=str(root/"back-id.png"),
  back_landmarks=triple(lm["back"],("crown_top_row","shoulder_row","hair_centre_col")),
  target_front_mask=str(MASKS/"mask-front-v2.png"),
  target_profile_mask=str(MASKS/"mask-profile-v2.png"),
  target_back_mask=str(MASKS/"mask-back-v3.png"),overlay_prefix="overlay-")
 (out/"best.json").write_text(json.dumps(doc,indent=2,sort_keys=True)+"\n")

if __name__=="__main__":main()
