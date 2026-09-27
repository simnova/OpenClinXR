#!/bin/sh
# Apply the versioned Infinigen source patches in this directory to the tool
# install at ~/.openclinxr-tools/infinigen/source (target sha, see README).
# Usage: sh apply-patches.sh [--check-only]
set -e
SRC="${INFINIGEN_SOURCE:-$HOME/.openclinxr-tools/infinigen/source}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$1" = "--check-only" ]; then
  git -C "$SRC" apply --check --verbose "$HERE"/0001-*.patch "$HERE"/0003-*.patch
else
  git -C "$SRC" apply --verbose "$HERE"/0001-*.patch "$HERE"/0003-*.patch
fi
