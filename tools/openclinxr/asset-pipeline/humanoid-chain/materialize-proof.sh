#!/bin/sh
# materialize-proof.sh <manifest> <out-glb> <expected-sha256-prefix>
#
# Re-derive the recorded Blender bake command from the manifest via
# print-materialize-invocation.ts (the ONLY source of the blender command
# below), run it, write the output sha256 beside the out file, and print
# MATCH when the digest starts with the expected prefix, MISMATCH otherwise.
# Refuses when the out file already exists (write-once store semantics).
#
# Preflight (cap36): before Blender starts, every provider-cache path that
# run-fix-bake.sh:47-52 stages is checked under
# ${MATERIALIZE_PROOF_CACHE_ROOT:-<repo-root>/.openclinxr-local/provider-cache}.
# The first missing path prints `PREFLIGHT_MISSING <path>` (cache-relative)
# and exits 6 without starting Blender. The Blender command is
# ${MATERIALIZE_PROOF_BLENDER:-blender} so tests can stub it.
set -eu

manifest="$1"
out="$2"
expected="$3"

if [ -e "$out" ]; then
  echo "refusing: out already exists: $out" >&2
  exit 3
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$script_dir"
while [ ! -e "$repo_root/pnpm-workspace.yaml" ]; do
  parent="$(dirname -- "$repo_root")"
  if [ "$parent" = "$repo_root" ]; then
    echo "refusing: workspace root (pnpm-workspace.yaml) not found" >&2
    exit 2
  fi
  repo_root="$parent"
done
cache_root="${MATERIALIZE_PROOF_CACHE_ROOT:-$repo_root/.openclinxr-local/provider-cache}"
# Staged by run-fix-bake.sh:47-52, in that order: hair/facial/visemes/skins
# dirs, the eyes system assets, the scrub-pants tree, the scrub-shirt .mhmat
# + base-colour texture, and the four shoes01 files.
for p in \
  "hair" \
  "facial" \
  "visemes" \
  "skins" \
  "eyes/makehuman-system-assets" \
  "garments/sources/makehuman-community-scrub-pants" \
  "garments/sources/makehuman-community-scrub-shirt/Scrub_Shirt.mhmat" \
  "garments/sources/makehuman-community-scrub-shirt/Scrubs_Main_BaseColor_Utility - sRGB - Texture.png" \
  "garments/sources/makehuman-shoes01/culturalibre_male_boots/male_boots.mhmat" \
  "garments/sources/makehuman-shoes01/culturalibre_male_boots/boot.png" \
  "garments/sources/makehuman-shoes01/toigo_mj_cloth_shoes/mj_shoes.mhmat" \
  "garments/sources/makehuman-shoes01/toigo_mj_cloth_shoes/MJ-shoes3.png" \
; do
  if [ ! -e "$cache_root/$p" ]; then
    printf 'PREFLIGHT_MISSING %s\n' "$p"
    exit 6
  fi
done

inv="$(pnpm exec tsx "$script_dir/print-materialize-invocation.ts" --manifest "$manifest" --out "$out")"
tool="$(printf '%s\n' "$inv" | sed -n '1s/^TOOL //p')"
if [ -z "$tool" ]; then
  echo "refusing: CLI printed no TOOL first line" >&2
  exit 2
fi

# Rebuild the argv array with one element per CLI output line (past line 1).
set --
while IFS= read -r line; do
  set -- "$@" "$line"
done <<EOF
$(printf '%s\n' "$inv" | tail -n +2)
EOF

blender_bin="${MATERIALIZE_PROOF_BLENDER:-blender}"
"$blender_bin" --background --python "$tool" -- "$@"

if [ ! -f "$out" ]; then
  echo "no output GLB: $out" >&2
  exit 4
fi

actual="$(sha256sum "$out" | cut -d' ' -f1)"
printf '%s\n' "$actual" > "$out.sha256"
case "$actual" in
"$expected"*)
  printf 'MATCH %s\n' "$actual"
  ;;
*)
  printf 'MISMATCH %s (want prefix %s)\n' "$actual" "$expected" >&2
  exit 1
  ;;
esac
