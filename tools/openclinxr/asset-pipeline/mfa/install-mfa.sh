#!/bin/bash
# Install Montreal Forced Aligner reproducibly and OUTSIDE the repo.
# micromamba (official static binary) -> env at ~/.openclinxr-tools/mfa
# with conda-forge montreal-forced-aligner, plus the pretrained
# english_us_arpa acoustic model + dictionary.
# Idempotent: re-running a completed install is a no-op (versions verified).
# Pinned 2026-10-06 (mfa-align slice): micromamba 2.9.0, MFA 3.4.2.
set -euo pipefail

MICROMAMBA_VERSION="${MICROMAMBA_VERSION:-2.9.0}"
MFA_VERSION="${MFA_VERSION:-3.4.2}"
MFA_PREFIX="${MFA_PREFIX:-$HOME/.openclinxr-tools/mfa}"
ACOUSTIC_MODEL="${ACOUSTIC_MODEL:-english_us_arpa}"
DICTIONARY="${DICTIONARY:-english_us_arpa}"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "${OS}-${ARCH}" in
  Darwin-arm64) MAMBA_PLATFORM="osx-arm64" ;;
  Darwin-x86_64) MAMBA_PLATFORM="osx-64" ;;
  Linux-x86_64) MAMBA_PLATFORM="linux-64" ;;
  Linux-aarch64) MAMBA_PLATFORM="linux-aarch64" ;;
  *) echo "install-mfa: unsupported platform ${OS}-${ARCH}" >&2; exit 1 ;;
esac

BIN_DIR="$HOME/.openclinxr-tools/bin"
mkdir -p "$BIN_DIR"
MAMBA="$BIN_DIR/micromamba"
export MAMBA_ROOT_PREFIX="$MFA_PREFIX"

if [ -x "$MAMBA" ] && [ "$("$MAMBA" --version 2>/dev/null)" = "$MICROMAMBA_VERSION" ]; then
  echo "install-mfa: micromamba $MICROMAMBA_VERSION present"
else
  echo "install-mfa: fetching micromamba $MICROMAMBA_VERSION ($MAMBA_PLATFORM)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://micro.mamba.pm/api/micromamba/${MAMBA_PLATFORM}/${MICROMAMBA_VERSION}" -o "$TMP/micromamba.tar.bz2"
  tar -xjf "$TMP/micromamba.tar.bz2" -C "$TMP"
  mv "$TMP/bin/micromamba" "$MAMBA"
  chmod +x "$MAMBA"
  rm -rf "$TMP"
  trap - EXIT
fi

INSTALLED_MFA="$("$MAMBA" run -p "$MFA_PREFIX" mfa version 2>/dev/null || true)"
if [ "$INSTALLED_MFA" = "$MFA_VERSION" ]; then
  echo "install-mfa: montreal-forced-aligner $MFA_VERSION present at $MFA_PREFIX"
else
  echo "install-mfa: creating env at $MFA_PREFIX (montreal-forced-aligner=$MFA_VERSION)"
  "$MAMBA" create -y -p "$MFA_PREFIX" -c conda-forge "montreal-forced-aligner=$MFA_VERSION"
fi

if [ -f "$HOME/Documents/MFA/pretrained_models/acoustic/${ACOUSTIC_MODEL}.zip" ]; then
  echo "install-mfa: acoustic model $ACOUSTIC_MODEL present"
else
  echo "install-mfa: downloading acoustic model $ACOUSTIC_MODEL"
  "$MAMBA" run -p "$MFA_PREFIX" mfa model download acoustic "$ACOUSTIC_MODEL"
fi
if [ -f "$HOME/Documents/MFA/pretrained_models/dictionary/${DICTIONARY}.dict" ]; then
  echo "install-mfa: dictionary $DICTIONARY present"
else
  echo "install-mfa: downloading dictionary $DICTIONARY"
  "$MAMBA" run -p "$MFA_PREFIX" mfa model download dictionary "$DICTIONARY"
fi

echo "install-mfa: done (mfa $("$MAMBA" run -p "$MFA_PREFIX" mfa version 2>/dev/null))"
