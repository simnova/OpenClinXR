#!/bin/sh
# Apply the versioned Infinigen source patches in this directory to the tool
# install at ~/.openclinxr-tools/infinigen/source (target sha, see README).
# Usage: sh apply-patches.sh [--check-only]
set -e
SRC="${INFINIGEN_SOURCE:-$HOME/.openclinxr-tools/infinigen/source}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# NOTE: one git-apply per patch file, in order. A single invocation with
# both files concatenates their hunks by position, which misorders 0003's
# Plaster-branch hunk (it builds on 0001's Brick/Concrete guard) before
# 0001's own hunk and fails. Sequential applies accumulate offsets
# correctly; 0003 is authored against the post-0001 image (see README).
if [ "$1" = "--check-only" ]; then
  git -C "$SRC" apply --check --verbose "$HERE"/0001-*.patch
  # Dry-run 0003 against a scratch post-0001 image so the check exercises
  # the same order as the real apply below without touching the install.
  SCRATCH="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH"' EXIT INT TERM
  mkdir -p "$SCRATCH/infinigen/core/constraints/example_solver/room"
  cp "$SRC/infinigen/core/constraints/example_solver/room/decorate.py" \
    "$SCRATCH/infinigen/core/constraints/example_solver/room/decorate.py"
  git -C "$SCRATCH" apply --verbose "$HERE"/0001-*.patch
  git -C "$SCRATCH" apply --check --verbose "$HERE"/0003-*.patch
else
  git -C "$SRC" apply --verbose "$HERE"/0001-*.patch
  git -C "$SRC" apply --verbose "$HERE"/0003-*.patch
fi
