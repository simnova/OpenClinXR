#!/bin/zsh
# hair-part1 calibration: hair-top1 t1 strands through part1_metric must
# reproduce hair-top1 metrics.json t1 (crown 1.068110, front 0.925895).
cd /Users/patrick/.grok/worktrees/hair-hairdeck
B=/Applications/Blender.app/Contents/MacOS/Blender
E=tools/openclinxr/evidence/hair-part1
S=tools/openclinxr/evidence/hair-top1/cells/t1/strands.npz
$B -b --python $E/part1_metric.py -- --strands $S --tag calib-t1 > $E/calib-t1-render.log 2>&1
$B -b --python $E/part1_metric.py -- --strands $S --tag calib-t1 --measure > $E/calib-t1-measure.log 2>&1
echo CALIBDONE >> $E/calib-t1-measure.log
