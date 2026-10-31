#!/bin/sh
R=/private/tmp/claude-501/-Volumes-files-src-openclinxr/57db6c23-5419-4e11-aa19-7e17843b76f7/scratchpad/run
LIB=/private/tmp/claude-501/-Volumes-files-src-openclinxr/57db6c23-5419-4e11-aa19-7e17843b76f7/scratchpad/dl/skills/skills/dcc/blender/scenario-blender-expert/scripts
n=$(basename "$1" .glb)
"$HOME/Applications/Blender-5.2.2.app/Contents/MacOS/Blender" -b --factory-startup --python-exit-code 1 --python "$R/drive.py" -- "$LIB" "$1" "$R/out/$n.json" > "$R/out/$n.log" 2>&1
tail -1 "$R/out/$n.log"
