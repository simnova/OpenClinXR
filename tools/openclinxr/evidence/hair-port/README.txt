hair-port (2026-11-06): hair-tgt2 (838234da8) + hair-part1 staged probe, squashed onto main.

Source: hair-tgt2 tree diff vs merge-base 1ed4e6a5b = 10127 added files, 0 modified,
0 deleted, all under tools/openclinxr/hair-groom/** and tools/openclinxr/evidence/hair-*/.
No shared file touched. hair-part1 patch applied without its hand edit to
docs/openclinxr/doc-authority-registry-2026-05-27.json.

In git: 3577 files (209 MB): all code/json/txt/log <= 1 MB, and PNGs <= 1 MB that sit
directly in an evidence dir (sheets, crops) or are cited by name in that dir's
RESULT/STATE/DONE text. Plus hair-part1/sheet.png (1.48 MB, named by the operator).

Not in git (EXCLUDED.tsv lists every path, bytes, reason, sha256 prefix):
  gt1MB          2437 files  9837 MB  (npz builds, full-res renders, blend1, glb)
  uncited-render 3914 files  1929 MB  (renders-*/ frames <= 1 MB not cited by a RESULT)
  binary-data     199 files    83 MB  (npz/npy/obj <= 1 MB; main tracks no npz)
  hair-part1         5 files          (cells/*/front.png > 1 MB)
Store copies (byte-identical, written from the 838234da8 git objects):
  /Volumes/files/openclinxr-assets/store/hair-port/excluded/<repo path>      SHA256SUMS sha256 8cf516b20d2a
  /Volumes/files/openclinxr-assets/store/hair-port/excluded-part1/<repo path> SHA256SUMS sha256 5e7eedcde685
Restore into a checkout so old evidence drivers find their in-repo inputs:
  rsync -a /Volumes/files/openclinxr-assets/store/hair-port/excluded/ ./
History: blob history up to ae5fbe3d3 is in store/git-archive/hair-tgt2.bundle.

PNG evidence moved to the store (2026-11-06): 428 render PNGs are not tracked. Their paths,
sizes and sha256 are in png-manifest.tsv. Old evidence drivers that read them (children_station.py,
cmaes.py, etc.) need them restored first:
  rsync -a /Volumes/files/openclinxr-assets/store/hair-port/evidence-png/ <repo-root>/
Contact sheets (*sheet*.png) stay tracked.
Run logs (*.log, 172 files, 0.8 MB) are refused in git by workspace-architecture.test.ts:1666
(tracked .log/.tmp/.pyc); they are in store/hair-port/evidence-log/, listed in log-manifest.tsv:
  rsync -a /Volumes/files/openclinxr-assets/store/hair-port/evidence-log/ <repo-root>/
