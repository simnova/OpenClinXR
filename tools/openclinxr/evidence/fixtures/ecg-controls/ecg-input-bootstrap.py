"""Portable frozen ECG input bootstrap (proposal copy, defect-fixed).

Reads the 8 authenticated frozen identities from the two canonical tracked
freeze manifests, verifies a scoped fixture archive (tar.gz, stdlib only),
and restores exact target repo paths.

Fixes for parent adversarial controls:
1. Full preflight BEFORE any write: archive members AND every target leaf
   (lstat: symlink/non-regular/different-bytes refuse) AND every existing
   ancestor component (symlink/non-dir/outside-workspace refuse via
   realpath containment). No output dirs, temps, or files before preflight
   passes, so a late 8th-target conflict refuses with zero writes.
2. Ancestor symlinks can no longer escape the workspace: each existing
   ancestor is realpath-resolved and must stay inside the root.
3. Deterministic full gzip+tar container: gzip.GzipFile(mtime=0,
   filename="") plus tar mtime/uid/gid/mode normalization, so re-archiving
   the same inputs yields byte-identical output.
4. Same-filesystem staging (temp dir under root) plus atomic hardlink
   publication (os.link, never overwrites) with post-publish SHA recheck,
   so a conflicting file created after preflight cannot be clobbered and
   no partial bytes ever appear at the final target.
"""
from __future__ import annotations

import datetime
import gzip
import hashlib
import io
import json
import os
import tarfile
import tempfile
from dataclasses import dataclass

MANIFEST_C0_C1 = "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json"
MANIFEST_PACK_A = "tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-pack-a-freeze.json"
FIXTURE_DIR = "tools/openclinxr/evidence/fixtures/ecg-controls"
ARCHIVE_NAME = "ecg-frozen-inputs.tar.gz"
MANIFEST_NAME = "ecg-frozen-inputs.manifest.json"
PREFLIGHT_REPORT_NAME = "ecg-bootstrap-creation-report.json"

ARCHIVE_MTIME = 0

# Policy: binaries >1MiB must live in the asset store, never committed.
# Product ships only the small pinned manifest; the caller (or
# OPENCLINXR_ECG_FIXTURE_ARCHIVE) supplies the absolute local archive path.
# Store location (parent-published, byte-exact archive):
#   store/ci-cleanup/ecg-controls-20261029-2c0961f0/ecg-frozen-inputs.tar.gz
EXPECTED_ARCHIVE_SHA256 = "2c0961f05af157f143a1ffb01397b971e96ec63612593950ea37854376d103a7"
EXPECTED_ARCHIVE_BYTES = 32607757
STORE_RELATIVE_ARCHIVE = "store/ci-cleanup/ecg-controls-20261029-2c0961f0/ecg-frozen-inputs.tar.gz"
ARCHIVE_ENV_VAR = "OPENCLINXR_ECG_FIXTURE_ARCHIVE"


@dataclass(frozen=True)
class FrozenEntry:
    target_repo_path: str
    sha256: str
    size: int


def discover_root(explicit_root: str | None = None) -> str:
    if explicit_root:
        return os.path.abspath(explicit_root)
    here = os.path.abspath(os.path.dirname(__file__))
    cur = here
    while True:
        if os.path.isfile(os.path.join(cur, "package.json")) and os.path.isdir(os.path.join(cur, "tools")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            raise RuntimeError("[ecg-bootstrap] cannot discover repo root from module location")
        cur = parent


def required_entries(root: str) -> list[FrozenEntry]:
    with open(os.path.join(root, MANIFEST_C0_C1), "r", encoding="utf-8") as fh:
        c0 = json.load(fh)
    with open(os.path.join(root, MANIFEST_PACK_A), "r", encoding="utf-8") as fh:
        pa = json.load(fh)
    staging = str(c0["stagingDir"])
    pack_root = str(pa["packRoot"])
    entries = [
        FrozenEntry(f"{staging}/{c0['raw']['file']}", str(c0["raw"]["sha256"]), -1),
        FrozenEntry(f"{staging}/{c0['c0']['file']}", str(c0["c0"]["sha256"]), -1),
        FrozenEntry(f"{staging}/{c0['c1']['file']}", str(c0["c1"]["sha256"]), -1),
        FrozenEntry(f"{staging}/{c0['m1']['file']}", str(c0["m1"]["sha256"]), -1),
    ]
    for name in ("front.png", "side.png", "three_quarter_left.png", "three_quarter_right.png"):
        entries.append(FrozenEntry(f"{pack_root}/ecg-cart/{name}", str(pa["views"][name]), -1))
    return entries


def fixture_paths(root: str) -> tuple[str, str]:
    """Resolve (archive_path, manifest_path).

    Honors OPENCLINXR_ECG_FIXTURE_ARCHIVE absolute path (store routing);
    falls back to the local fixture path for own-capsule tests.
    """
    d = os.path.join(root, FIXTURE_DIR)
    env = os.environ.get(ARCHIVE_ENV_VAR)
    if env:
        if not os.path.isabs(env):
            raise RuntimeError(f"[ecg-bootstrap] refusing non-absolute {ARCHIVE_ENV_VAR}: {env}")
        return env, os.path.join(d, MANIFEST_NAME)
    return os.path.join(d, ARCHIVE_NAME), os.path.join(d, MANIFEST_NAME)


def _verify_explicit_store_archive(archive_path: str) -> None:
    """Reject wrong store archive bytes/full SHA before any target write."""
    actual_bytes = os.path.getsize(archive_path)
    if actual_bytes != EXPECTED_ARCHIVE_BYTES:
        raise RuntimeError(
            "[ecg-bootstrap] refusing store archive with wrong byte size: "
            f"expected {EXPECTED_ARCHIVE_BYTES} got {actual_bytes}"
        )
    actual_sha = _sha256_file(archive_path)
    if actual_sha != EXPECTED_ARCHIVE_SHA256:
        raise RuntimeError(
            "[ecg-bootstrap] refusing store archive with wrong SHA256: "
            f"expected {EXPECTED_ARCHIVE_SHA256} got {actual_sha}"
        )


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _canon_root(root: str) -> str:
    return os.path.realpath(os.path.abspath(root))


def _refuse_unless_inside(root: str, path: str, what: str) -> str:
    abs_root = _canon_root(root)
    target = os.path.abspath(os.path.join(abs_root, path)) if not os.path.isabs(path) else os.path.abspath(path)
    if target != abs_root and not target.startswith(abs_root + os.sep):
        raise RuntimeError(f"[ecg-bootstrap] refusing {what} outside workspace: {path}")
    return target


def _preflight_ancestors(root: str, expected: list[FrozenEntry]) -> None:
    """Validate every existing ancestor BEFORE any leaf read."""
    abs_root = _canon_root(root)
    import stat as _stat
    for e in expected:
        _refuse_unless_inside(abs_root, e.target_repo_path, "target")
        rel_dir = os.path.dirname(e.target_repo_path)
        parts = [] if not rel_dir else rel_dir.split("/")
        acc = abs_root
        for part in parts:
            if part in ("", ".", ".."):
                raise RuntimeError(f"[ecg-bootstrap] refusing unsafe ancestor: {e.target_repo_path}")
            acc = os.path.join(acc, part)
            try:
                st = os.lstat(acc)
            except FileNotFoundError:
                break
            if _stat.S_ISLNK(st.st_mode):
                raise RuntimeError(f"[ecg-bootstrap] refusing symlink ancestor: {acc}")
            if not _stat.S_ISDIR(st.st_mode):
                raise RuntimeError(f"[ecg-bootstrap] refusing non-directory ancestor: {acc}")
            real = os.path.realpath(acc)
            if real != abs_root and not real.startswith(abs_root + os.sep):
                raise RuntimeError(f"[ecg-bootstrap] refusing ancestor escaping workspace: {acc}")


def _preflight_targets(root: str, expected: list[FrozenEntry]) -> None:
    """Refuse conflicting leaves and unsafe ancestors before any write."""
    abs_root = _canon_root(root)
    _preflight_ancestors(abs_root, expected)
    import stat as _stat
    for e in expected:
        target = _refuse_unless_inside(abs_root, e.target_repo_path, "target")
        try:
            st = os.lstat(target)
        except FileNotFoundError:
            continue
        if _stat.S_ISLNK(st.st_mode):
            raise RuntimeError(f"[ecg-bootstrap] refusing symlink at target: {e.target_repo_path}")
        if not _stat.S_ISREG(st.st_mode):
            raise RuntimeError(f"[ecg-bootstrap] refusing non-regular target: {e.target_repo_path}")
        if _sha256_file(target) != e.sha256:
            raise RuntimeError(
                f"[ecg-bootstrap] REFUSE: existing different bytes preserved: {e.target_repo_path}"
            )


def preflight_archive(archive_path: str, expected: list[FrozenEntry], root: str) -> dict:
    """Verify archive members AND all target/ancestor state before any write."""
    if os.path.islink(archive_path) or not os.path.isfile(archive_path):
        raise RuntimeError(f"[ecg-bootstrap] missing fixture archive: {archive_path}")
    by_name = {e.target_repo_path: e for e in expected}
    seen: dict[str, dict] = {}
    with tarfile.open(archive_path, "r:gz") as tf:
        members = tf.getmembers()
        names = [m.name for m in members]
        if sorted(names) != sorted(by_name):
            raise RuntimeError(
                "[ecg-bootstrap] archive member mismatch: "
                f"expected {sorted(by_name)} got {sorted(names)}"
            )
        payloads: dict[str, bytes] = {}
        for m in members:
            exp = by_name[m.name]
            if m.issym() or m.islnk():
                raise RuntimeError(f"[ecg-bootstrap] refusing symlink member: {m.name}")
            if not m.isfile():
                raise RuntimeError(f"[ecg-bootstrap] refusing non-regular member: {m.name}")
            _refuse_unless_inside(root, m.name, "member target")
            if m.size != exp.size and exp.size >= 0:
                raise RuntimeError(f"[ecg-bootstrap] size mismatch for {m.name}")
            data = tf.extractfile(m)
            if data is None:
                raise RuntimeError(f"[ecg-bootstrap] cannot read member: {m.name}")
            raw = data.read()
            if len(raw) != m.size:
                raise RuntimeError(f"[ecg-bootstrap] truncated member: {m.name}")
            actual_sha = hashlib.sha256(raw).hexdigest()
            if actual_sha != exp.sha256:
                raise RuntimeError(f"[ecg-bootstrap] SHA mismatch for {m.name}")
            payloads[m.name] = raw
            seen[m.name] = {"sha256": actual_sha, "bytes": len(raw)}
    _preflight_targets(root, expected)
    seen["_payloads"] = payloads  # type: ignore[assignment]
    return seen


def _atomic_link_publish(staged_path: str, target: str, expected_sha: str) -> None:
    """Atomically publish via hardlink: no partial bytes ever at target.

    staged_path is fully written and SHA-verified before this call. os.link
    never overwrites: a conflicting file created after preflight raises
    FileExistsError and the conflict is preserved untouched.
    """
    os.link(staged_path, target)
    try:
        if _sha256_file(target) != expected_sha:
            try:
                os.unlink(target)
            except OSError:
                pass
            raise RuntimeError(f"[ecg-bootstrap] post-publish SHA mismatch (race?): {target}")
    except BaseException:
        raise


def _verified_warm_reuse(root: str, expected: list[FrozenEntry]) -> list[str] | None:
    """Return reused list iff ALL 8 canonical targets verify in place; else None.

    Warm-reuse path: no explicit archive env and no local default archive.
    Verifies every target is a regular non-symlink file with its full SHA
    plus all ancestor/symlink checks. Any missing/wrong target returns None
    (caller refuses as usual); never partial success.
    """
    import stat as _stat
    abs_root = _canon_root(root)
    _preflight_ancestors(abs_root, expected)
    for e in expected:
        target = _refuse_unless_inside(abs_root, e.target_repo_path, "target")
        try:
            st = os.lstat(target)
        except FileNotFoundError:
            return None
        if _stat.S_ISLNK(st.st_mode) or not _stat.S_ISREG(st.st_mode):
            return None
        if _sha256_file(target) != e.sha256:
            return None
    return [e.target_repo_path for e in expected]


def materialize(root: str | None = None) -> dict:
    """Full preflight first; then publish. No writes before preflight passes."""
    root = _canon_root(discover_root(root))
    expected = required_entries(root)
    explicit = os.environ.get(ARCHIVE_ENV_VAR)
    archive_path, _ = fixture_paths(root)
    if explicit:
        _verify_explicit_store_archive(archive_path)
    elif not (not os.path.islink(archive_path) and os.path.isfile(archive_path)):
        warm = _verified_warm_reuse(root, expected)
        if warm is not None:
            return {"root": root, "restored": [], "reused": warm,
                    "verified": {n: {"sha256": e.sha256, "bytes": e.size} for n, e in ((e.target_repo_path, e) for e in expected)}}
    verified = preflight_archive(archive_path, expected, root)
    payloads: dict[str, bytes] = verified.pop("_payloads")  # type: ignore[assignment]
    restored: list[str] = []
    reused: list[str] = []
    stage_base = os.path.join(root, FIXTURE_DIR, ".stage")
    os.makedirs(stage_base, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="ecg-bootstrap-", dir=stage_base)
    try:
        staged: dict[str, str] = {}
        for e in expected:
            target = os.path.join(root, e.target_repo_path)
            if os.path.isfile(target) and not os.path.islink(target):
                reused.append(e.target_repo_path)
                continue
            stage = os.path.join(tmp, hashlib.sha256(e.target_repo_path.encode()).hexdigest() + ".part")
            with open(stage, "wb") as fh:
                fh.write(payloads[e.target_repo_path])
            if _sha256_file(stage) != e.sha256:
                raise RuntimeError(f"[ecg-bootstrap] staged SHA mismatch: {e.target_repo_path}")
            staged[e.target_repo_path] = stage
        for e in expected:
            if e.target_repo_path in staged:
                target = os.path.join(root, e.target_repo_path)
                if os.path.lexists(target):
                    if os.path.isfile(target) and not os.path.islink(target) and _sha256_file(target) == e.sha256:
                        reused.append(e.target_repo_path)
                        continue
                    raise RuntimeError(
                        f"[ecg-bootstrap] REFUSE: target appeared after preflight: {e.target_repo_path}"
                    )
                os.makedirs(os.path.dirname(target), exist_ok=True)
                try:
                    _atomic_link_publish(staged[e.target_repo_path], target, e.sha256)
                except FileExistsError:
                    raise RuntimeError(
                        f"[ecg-bootstrap] REFUSE: target appeared after preflight: {e.target_repo_path}"
                    )
                restored.append(e.target_repo_path)
    finally:
        try:
            for name in os.listdir(tmp):
                try:
                    os.unlink(os.path.join(tmp, name))
                except OSError:
                    pass
            os.rmdir(tmp)
        except OSError:
            pass
    return {"root": root, "restored": restored, "reused": reused,
            "verified": {k: v for k, v in verified.items()}}


def _deterministic_tar_gz(files: list[tuple[str, bytes]]) -> bytes:
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w") as tf:
        for name, raw in files:
            ti = tarfile.TarInfo(name=name)
            ti.size = len(raw)
            ti.mtime = ARCHIVE_MTIME
            ti.mode = 0o444
            ti.uid = 0
            ti.gid = 0
            ti.uname = ""
            ti.gname = ""
            tf.addfile(ti, io.BytesIO(raw))
    out = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", compresslevel=9, mtime=ARCHIVE_MTIME, fileobj=out) as gz:
        gz.write(tar_buf.getvalue())
    return out.getvalue()


def create_archive(source_root: str, dest_root: str) -> dict:
    """Build the scoped fixture archive with a fully deterministic container."""
    expected = required_entries(source_root)
    pairs: list[tuple[str, bytes]] = []
    manifest_entries = []
    for e in expected:
        src = os.path.join(source_root, e.target_repo_path)
        with open(src, "rb") as fh:
            raw = fh.read()
        if hashlib.sha256(raw).hexdigest() != e.sha256:
            raise RuntimeError(f"[ecg-bootstrap] source SHA mismatch: {e.target_repo_path}")
        pairs.append((e.target_repo_path, raw))
        manifest_entries.append(
            {"targetRepoPath": e.target_repo_path, "sha256": e.sha256, "bytes": len(raw)}
        )
    pairs.sort(key=lambda p: p[0])
    archive_bytes = _deterministic_tar_gz(pairs)
    archive_sha = hashlib.sha256(archive_bytes).hexdigest()
    manifest = {"archive": ARCHIVE_NAME, "archiveSha256": archive_sha, "entries": manifest_entries}
    created_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report = {
        "ownCreation": True,
        "createdUtc": created_utc,
        "deterministicContainerMtime": ARCHIVE_MTIME,
        "archiveBytes": len(archive_bytes),
        "archiveSha256": archive_sha,
        "entries": manifest_entries,
        "note": "Tar mtime=0/uid=0/gid=0 and gzip mtime=0/filename='' are container "
                "reproducibility settings, not evidence time. Actual creation UTC is "
                "recorded truthfully in createdUtc. Member bytes are exact originals.",
    }
    return {"archive_bytes": archive_bytes, "manifest": manifest, "report": report}


def write_archive_outputs(dest_root: str, built: dict) -> dict:
    dest_dir = os.path.join(dest_root, FIXTURE_DIR)
    os.makedirs(dest_dir, exist_ok=True)
    with open(os.path.join(dest_dir, ARCHIVE_NAME), "wb") as fh:
        fh.write(built["archive_bytes"])
    with open(os.path.join(dest_dir, MANIFEST_NAME), "w", encoding="utf-8") as fh:
        json.dump(built["manifest"], fh, indent=2)
        fh.write("\n")
    with open(os.path.join(dest_dir, PREFLIGHT_REPORT_NAME), "w", encoding="utf-8") as fh:
        json.dump(built["report"], fh, indent=2)
        fh.write("\n")
    return built["report"]
