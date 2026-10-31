#!/bin/sh
R=/private/tmp/claude-501/-Volumes-files-src-openclinxr/57db6c23-5419-4e11-aa19-7e17843b76f7/scratchpad/run
g=$(basename "$1" .glb)
"$HOME/Applications/Blender-5.2.2.app/Contents/MacOS/Blender" -b --factory-startup --python $R/zcheck.py -- "$1" $R/z/$g.json "$2" > $R/z/$g.log 2>&1; tail -1 $R/z/$g.log
