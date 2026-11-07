#!/bin/zsh
# hair-part1: build the four variants in parallel, then measure
# id, a, b, c, d one at a time (renders are serialised).
cd /Users/patrick/.grok/worktrees/hair-hairdeck
E=tools/openclinxr/evidence/hair-part1
ST=/Volumes/files/openclinxr-assets/store
R36=$ST/hair-groom36/roots-36.npz
BUILD_ONLY=1 zsh $E/run_variant.sh a $R36 --part-jitter-mm 3 --part-jitter-seed 20261106 &
BUILD_ONLY=1 zsh $E/run_variant.sh b $ST/hair-part1/roots-b.npz &
BUILD_ONLY=1 zsh $E/run_variant.sh c $R36 --flow-bias-deg 2 --flow-bias-side 1 &
BUILD_ONLY=1 zsh $E/run_variant.sh d $ST/hair-part1/roots-d.npz --part-jitter-mm 3 --part-jitter-seed 20261106 --flow-bias-deg 2 --flow-bias-side 1 &
SKIP_BUILD=1 zsh $E/run_variant.sh id $R36
wait
for t in a b c d; do SKIP_BUILD=1 zsh $E/run_variant.sh $t x; done
BUILD_ONLY=1 zsh $E/run_variant.sh ddet $ST/hair-part1/roots-d.npz --part-jitter-mm 3 --part-jitter-seed 20261106 --flow-bias-deg 2 --flow-bias-side 1
BUILD_ONLY=1 zsh $E/run_variant.sh adet $R36 --part-jitter-mm 3 --part-jitter-seed 20261106
echo ALLDONE > $E/ALLDONE.txt
