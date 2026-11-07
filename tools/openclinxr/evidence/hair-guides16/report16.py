"""Pack the immutable guide rows and judge report into row-guides16.json."""
import json
from pathlib import Path
E=Path(__file__).resolve().parent
j=json.load(open(E/'final/judge/guides16-children.json'))
r=json.load(open(E/'v7f9/row.json'))
r['name']='v7f9'; r['X3']={
 'front_iou':j['iou'],'eroded_iou':j['iou_eroded'],'width_rms_head':j['width_rms_head'],
 'face_gaps':j['face_gaps'],'eye_box':j['eye_box_hair'],'profile_iou':j['profile_view']['iou'],
 'back_iou':j['back_view']['iou'],'back_hem':j['back_hem_v5'],'id_show_through':j['id_show_through'],
 'standing_hair':j['standing_hair'],'clauses_v5':j['clauses_v5']}
final=json.loads(json.dumps(r)); final['name']='final'; final['run']['fallback']=True
final['run']['fallback_reason']='cap-v8/flow-v10 producer RESULT has G4-flow-forward MISS and G5 MISS'
doc={'schemaVersion':1,'slice':'hair-guides-16','runs':[r,final],
     'attempts':[
      {'name':'attempt1','result':'G1,G3,G5,G6,G9 PASS; G2,G4,G7,G8 MISS'},
      {'name':'attempt2','result':'G1,G2,G3,G5,G6,G8,G9 PASS; G4,G7 MISS'},
      {'name':'attempt3-v7f9','result':'G1,G3,G4,G5,G6,G7,G8,G9 PASS; G2 MISS'}]}
(E/'row-guides16.json').write_text(json.dumps(doc,indent=2)+'\n')
