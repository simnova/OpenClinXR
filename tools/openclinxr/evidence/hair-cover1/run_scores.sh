#!/bin/zsh
E=tools/openclinxr/evidence/hair-cover1
for tag in c_den c_rad c_spr c_hem; do
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/openclinxr/evidence/hair-count2/score_tt.py -- --strands $E/cells/$tag/strands.npz --params $E/base/params.json --out $E/scores/$tag --crown-top
done
