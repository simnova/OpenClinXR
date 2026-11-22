#!/usr/bin/env python3
"""Finalize a post-export stage: geometry check, lineage record, measure, re-pins.

Order: (a) the post level's tool is registered (shared rule:
post-export-stage-registry.ts CLI, THE single copy of the invoked-tool rule);
(b) geometry equality glbGeometryDigest(pre)==glbGeometryDigest(post) when the
registry says the stage preserves geometry; (e-precheck) every keep-sha row is
classified BEFORE anything is written (frozen-plan rows skip; live rows FAIL
CLOSED on the empty production pin-writer allowlist, naming file/field/writer
with "re-run that stage"); (c) lineage record through the stage's own record
writer (hair maps: --record-wired-materials-only), never a hand JSON edit;
(d) measure-humanoid-basecolorfactor.py --body for the shipped body chosen by
sha identity against the shipped GLB set; (e) re-pin every live row through
its verbatim writer argv, asserting every pinned field == --post sha.
--dry-run prints the ordered plan and writes nothing; refusals exit non-zero
naming the cause. Test seams open ONLY under --test-registry <path> (fixture
mode): the path must resolve under the tmp fixture root, and every path
finalize reads or would write must resolve under that SAME root. No flag =
production: fixed compact+store paths, FINALIZE_* env overrides ignored, and
--consumers/--repin-one refused. (X1/X2)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
REAL_REPO = os.path.realpath(REPO_ROOT)
REGISTRY_TS = REPO_ROOT / "packages/openclinxr/factory-station-core/src/post-export-stage-registry.ts"
COMPACT_DEFAULT = REPO_ROOT / "packages/openclinxr/factory-station-core/src/post-export-stage-consumers.json"
STORE_ROOT_DEFAULT = Path("/Volumes/files/openclinxr-assets/store")
REAL_STORE = os.path.realpath(STORE_ROOT_DEFAULT)
MAPS_TOOL = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py"
SELF_TOOL = "tools/openclinxr/asset-pipeline/makeclothes/finalize_post_export_stage.py"
MAPS_PY = REPO_ROOT / MAPS_TOOL
MEASURE_PY = HERE / "measure-humanoid-basecolorfactor.py"
GENERATED_DIR = REPO_ROOT / "apps/ui-xr/public/generated-humanoids"

WRITERLESS = {"", "hand", "none"}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
FIELD_GROUP_RE = re.compile(r"^(?P<path>.+?):(?P<line>\d+)\s*\((?P<fields>[^()]*)\)\s*$")
ASSET_RE = re.compile(r'"assetSha256"\s*:\s*"([0-9a-f]{64})"')
CASEID_RE = re.compile(r'"caseId"\s*:\s*"([^"]+)"')


def refuse(at: str, reason: str) -> "NoReturn":
    sys.stderr.write(json.dumps({"refusedAt": at, "reason": reason}) + "\n")
    raise SystemExit(2)


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture_root(path: object) -> str | None:
    """Eligible tmp fixture root for path, else None (X1: never repo/store)."""
    rp = os.path.realpath(os.fspath(path))
    if rp == REAL_REPO or rp.startswith(REAL_REPO + os.sep):
        return None
    if rp == REAL_STORE or rp.startswith(REAL_STORE + os.sep):
        return None
    for cand in (os.path.realpath(tempfile.gettempdir()), os.path.realpath("/private/tmp")):
        if rp == cand or rp.startswith(cand + os.sep):
            return cand
    return None


def call_cli(payload: dict, registry: Path) -> tuple:
    """Call the ONE shared rule (registry.ts CLI); (info, '') or (None, detail). Never raises."""
    try:
        proc = subprocess.run(
            ["pnpm", "exec", "tsx", str(registry), json.dumps(payload)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as exc:
        return None, f"shared invoked-tool rule unreachable ({exc})"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()
        return None, f"shared invoked-tool rule refuses ({detail[0] if detail else 'no detail'})"
    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return None, f"shared invoked-tool rule output unparsable ({exc})"
    if not isinstance(info, dict):
        return None, "shared invoked-tool rule output unparsable"
    return info, ""


def self_argv(flag: object) -> list:
    return ["mise", "exec", "--", "python3", SELF_TOOL, "--repin-one", "--test-registry", str(flag)]


_pin_cache: dict = {}


def resolve_writer(writer: str, registry: Path) -> tuple:
    """Resolve a row writer through the CLI pinWriter mode; (info, '') or (None, detail). Cached."""
    if writer not in _pin_cache:
        _pin_cache[writer] = call_cli({"pinWriter": writer}, registry)
    return _pin_cache[writer]


def row_fields(field: object) -> list:
    """Every pinned field name in a grouped row: ';'-joined groups, comma lists, or bare."""
    names: list = []
    for part in str(field or "").split(";"):
        part = part.strip()
        if not part:
            continue
        m = FIELD_GROUP_RE.match(part)
        if m:
            names.extend(n.strip() for n in m.group("fields").split(",") if n.strip())
            continue
        inner = re.search(r"\(([^()]*)\)", part)
        if inner:
            names.extend(n.strip() for n in inner.group(1).split(",") if n.strip())
            continue
        names.append(part)
    return names


def field_value(doc: object, name: str) -> object:
    node = doc
    for part in name.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def frozen_pinned(file_abs: Path, field: object, pre_sha: str | None = None) -> tuple:
    """(sha, caseId) credited to the specific plan entry holding pre_sha (X7)."""
    if not pre_sha or "assetSha256" not in str(field):
        return None, None
    try:
        lines = file_abs.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None, None
    for i, line in enumerate(lines):
        m = ASSET_RE.search(line)
        if m and m.group(1) == pre_sha:
            case = None
            for prev in lines[max(0, i - 400):i]:
                cm = CASEID_RE.search(prev)
                if cm:
                    case = cm.group(1)
            return pre_sha, case
    return None, None


def consumer_rows(args: argparse.Namespace, root: str | None) -> list:
    """Keep-sha rows. Fixture tables and store overrides only under the flag (X1/X2)."""
    if args.consumers is not None:
        if not root:
            refuse("e", "--consumers fixture tables require --test-registry under the tmp fixture root; refusing")
        if fixture_root(args.consumers) != root:
            refuse("e", f"--consumers outside the fixture root ({args.consumers}); refusing")
        try:
            raw = json.loads(Path(args.consumers).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            refuse("e", f"--consumers unreadable ({args.consumers}: {exc}); refusing")
        rows = raw["consumers"] if isinstance(raw, dict) else raw
        return [r for r in rows if r.get("proposed_pin") == "keep-sha"]
    if root:
        compact_path = Path(os.environ.get("FINALIZE_CONSUMERS_COMPACT", str(COMPACT_DEFAULT)))
        store_root = Path(os.environ.get("FINALIZE_STORE_ROOT", str(STORE_ROOT_DEFAULT)))
        if fixture_root(compact_path) != root or fixture_root(store_root) != root:
            refuse("e", "store inventory outside the fixture root; pass --consumers with a fixture table; refusing")
    else:
        compact_path, store_root = COMPACT_DEFAULT, STORE_ROOT_DEFAULT
    try:
        compact = json.loads(compact_path.read_bytes())
    except (OSError, json.JSONDecodeError) as exc:
        refuse("e", f"consumers compact unreadable ({compact_path}: {exc}); refusing")
    full = compact.get("full") if isinstance(compact, dict) else None
    rel = full.get("store") if isinstance(full, dict) else None
    want = full.get("sha256") if isinstance(full, dict) else None
    if not isinstance(rel, str) or not isinstance(want, str) or not HEX64.fullmatch(want):
        refuse("e", f"consumers compact header names no store path + sha256 ({compact_path}); refusing")
    store_file = store_root / rel
    if root and fixture_root(store_file) != root:
        refuse("e", f"store inventory outside the fixture root ({store_file}); refusing")
    try:
        blob = store_file.read_bytes()
    except OSError:
        refuse("e", f"store inventory missing ({store_file}); pass --consumers with a fixture table")
    if hashlib.sha256(blob).hexdigest() != want:
        refuse("e", f"store inventory sha mismatch ({store_file}); pass --consumers with a fixture table")
    try:
        full_doc = json.loads(blob)
    except json.JSONDecodeError as exc:
        refuse("e", f"store inventory unparsable ({exc}); refusing")
    rows = full_doc["consumers"] if isinstance(full_doc, dict) else []
    return [r for r in rows if r.get("proposed_pin") == "keep-sha"]


def row_file_abs(repo: Path, file_str: str) -> Path:
    p = Path(file_str)
    return p if p.is_absolute() else repo / file_str


def shipped_by_sha(want: str, size: int) -> Path | None:
    try:
        glbs = sorted(GENERATED_DIR.glob("*.glb"))
    except OSError:
        return None
    for g in glbs:
        try:
            if g.stat().st_size != size or sha_file(g) != want:
                continue
        except OSError:
            continue
        return g
    return None


def select_body_path(sidecar: dict, pre_abs: Path, post_abs: Path) -> Path | None:
    """The shipped body carrying the sidecar outputSha256; None when no shipped body does (X4)."""
    lineage = sidecar.get("byteLineage") if isinstance(sidecar, dict) else None
    want = (lineage.get("outputSha256") if isinstance(lineage, dict) else None) or sidecar.get("outputSha256")
    if not isinstance(want, str) or not HEX64.fullmatch(want):
        refuse("d", "sidecar carries no outputSha256 pin; refusing body measure")
    matched = None
    for candidate in (post_abs, pre_abs):
        if sha_file(candidate) == want:
            matched = candidate
            break
    if matched is None:
        refuse("d", f"no --pre/--post GLB matches sidecar outputSha256 ({want[:8]}...); refusing body measure")
    namesake = GENERATED_DIR / matched.name
    same = namesake.exists() and matched.resolve() == namesake.resolve()
    if namesake.exists() and not same:
        refuse("d", f"--post matches sidecar outputSha256 under a shipped basename but is not the shipped file "
                    f"({matched} vs {namesake}); refusing body measure (same-path collision, not the shipped body)")
    hit = shipped_by_sha(want, matched.stat().st_size)
    if hit is not None:
        return hit
    if same:
        return matched
    return None


def repin_one(root: str) -> None:
    """Fixture re-pin entry (X1: only under --test-registry; the file must sit under the same root)."""
    try:
        path = Path(os.environ["FINALIZE_REPIN_FILE"])
        names = [n for n in os.environ["FINALIZE_REPIN_FIELDS"].split(",") if n]
        pre = os.environ["FINALIZE_REPIN_PRE_SHA"]
        post = os.environ["FINALIZE_REPIN_POST_SHA"]
    except KeyError as exc:
        refuse("e", f"--repin-one missing context {exc}; refusing")
    if fixture_root(path) != root:
        refuse("e", f"--repin-one target outside the fixture root ({path}); refusing")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        refuse("e", f"--repin-one cannot read {path} ({exc}); refusing")
    flipped = 0
    for name in names:
        node = doc
        parts = name.split(".")
        ok = True
        for part in parts[:-1]:
            if not isinstance(node, dict) or part not in node:
                ok = False
                break
            node = node[part]
        if ok and isinstance(node, dict) and node.get(parts[-1]) == pre:
            node[parts[-1]] = post
            flipped += 1
    if flipped == 0:
        refuse("e", f"--repin-one found no {pre[:8]}... pin in {path}; refusing")
    path.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"repinned": str(path), "fields": flipped}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pre", type=Path, required=False, default=None)
    parser.add_argument("--post", type=Path, required=False, default=None)
    parser.add_argument("--sidecar", type=Path, required=False, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--consumers", type=Path, default=None)
    parser.add_argument("--repin-one", action="store_true")
    parser.add_argument("--test-registry", type=Path, default=None)
    args = parser.parse_args()

    root = fixture_root(args.test_registry) if args.test_registry else None
    if args.test_registry is not None and not root:
        refuse("a", f"--test-registry outside the tmp fixture root ({args.test_registry}); refusing")
    # Canonicalize: a symlinked tmp prefix (/var -> /private/var) makes
    # `pnpm exec tsx <registry>` exit 0 silently; realpath keeps it working.
    registry = Path(os.path.realpath(args.test_registry)) if args.test_registry else REGISTRY_TS

    # X1: --repin-one never runs with --dry-run and never without the flag.
    if args.repin_one:
        if args.dry_run:
            refuse("e", "--repin-one never runs with --dry-run; refusing")
        if not root:
            refuse("e", "--repin-one is test-only; pass --test-registry under the tmp fixture root; refusing")
        repin_one(root)
        return

    for flag in ("--pre", "--post", "--sidecar"):
        path = getattr(args, flag.lstrip("-"))
        if path is None or not path.exists():
            refuse("a", f"{flag} missing: {path}")
    if args.consumers is not None and not args.consumers.exists():
        refuse("e", f"--consumers missing: {args.consumers}")

    # X1-AMEND: in fixture mode the inventory-facing paths resolve under the same root.
    if root:
        for what, path in (("pre", args.pre), ("post", args.post), ("sidecar", args.sidecar)):
            if fixture_root(path) != root:
                refuse("a", f"{what} outside the fixture root ({path}); refusing")

    pre_sha = sha_file(args.pre)
    post_sha = sha_file(args.post)
    try:
        sidecar = json.loads(args.sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        refuse("a", f"sidecar unreadable ({args.sidecar}: {exc}); refusing")

    lineage = sidecar.get("byteLineage") if isinstance(sidecar, dict) else None
    argv = lineage.get("derivationArgv") if isinstance(lineage, dict) else None
    if not isinstance(argv, list) or not argv:
        refuse("a", "sidecar carries no derivationArgv level; refusing")

    # (a) the post level's tool is registered (shared rule).
    info, err = call_cli({"argv": argv}, registry)
    if info is None:
        refuse("a", f"{err}; refusing")
    tool = info.get("tool")
    if not isinstance(tool, str):
        refuse("a", f"level does not resolve to exactly one registered tool ({tool}); refusing")
    checks_a = {"tool": tool, "stages": info.get("stages"), "registered": True}

    # (b) geometry equality when the registry says the stage preserves it.
    if "geometry" not in info.get("preserves", []):
        refuse("b", f"stage {tool} does not preserve geometry; refusing to finalize")
    digest_info, err = call_cli({"digest": [str(args.pre), str(args.post)]}, registry)
    if digest_info is None:
        refuse("b", f"{err}; refusing")
    digests = digest_info.get("digests", [])
    if (
        not isinstance(digests, list)
        or len(digests) != 2
        or not all(isinstance(d, str) and HEX64.fullmatch(d) for d in digests)
        or digests[0] != digests[1]
    ):
        have = [d if isinstance(d, str) else type(d).__name__ for d in digests] if isinstance(digests, list) else digests
        refuse("b", f"geometry digest gate failed (have={have}); refusing")
    checks_b = {"preservesGeometry": True, "preDigest": digests[0], "postDigest": digests[1], "equal": True}

    # (e-precheck) classify every row BEFORE (c)-(e) run anything. Liveness is
    # value equality with --pre sha. Frozen-plan rows skip; writerless or
    # non-allowlisted live rows FAIL CLOSED here (X5 names the writer verbatim).
    rows = consumer_rows(args, root)
    post_abs = args.post.resolve()
    live: list[dict] = []
    skipped: list[dict] = []
    for row in rows:
        file_str = str(row.get("file", ""))
        field = row.get("field_or_symbol", row.get("field", ""))
        writer = str(row.get("writer", ""))
        names = row_fields(field)
        base = {"file": file_str, "field": names[0] if names else str(field), "writer": writer}
        fpath = row_file_abs(REPO_ROOT, file_str)
        if root and fixture_root(fpath) != root:
            refuse("e", f"row file outside the fixture root ({file_str}); refusing")
        if not str(writer).strip() or str(writer).strip().lower() in WRITERLESS:
            cli_info, cli_err = None, ""
        elif root and writer == " ".join(self_argv(args.test_registry)):
            cli_info, cli_err = {"argv": self_argv(args.test_registry), "glbProducing": False}, ""
        else:
            cli_info, cli_err = resolve_writer(writer, registry)
            if cli_info is not None and cli_info.get("frozen"):
                pin, case = frozen_pinned(fpath, str(field), pre_sha)
                skipped.append({**base, "pinned": pin, "caseId": case, "reason": "frozen-plan"})
                continue
        try:
            doc = json.loads(fpath.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            skipped.append({**base, "pinned": None, "reason": "unreadable consumer file"})
            continue
        if not isinstance(doc, dict) or not names:
            skipped.append({**base, "pinned": None, "reason": "no pinned field to check"})
            continue
        vals = [(n, field_value(doc, n)) for n in names]
        first_val = vals[0][1] if vals else None
        non_live = [(n, v) for n, v in vals if v != pre_sha]
        if non_live:
            detail = ", ".join(
                f"{n}={v[:8]}..." if isinstance(v, str)
                else f"{n}=<{'missing' if v is None else type(v).__name__}>"
                for n, v in non_live[:4]
            )
            skipped.append({**base, "pinned": first_val, "reason": f"not all fields pin --pre sha ({detail})"})
            continue
        if not str(writer).strip() or str(writer).strip().lower() in WRITERLESS:
            refuse("e", f"live keep-sha row without a production writer "
                        f"({file_str} :: {base['field']} writer={writer}); re-run that stage to re-pin them; refusing")
        if cli_info is None:
            refuse("e", f"live keep-sha row has no production pin writer "
                        f"({file_str} :: {base['field']}: {writer}); re-run that stage to re-pin it; refusing")
        if cli_info.get("glbProducing"):
            refuse("e", f"live keep-sha row writer produces GLBs ({file_str} :: {base['field']}: {writer}); refusing")
        live.append({
            **base, "pinned": pre_sha, "fieldNames": names,
            "writerArgv": cli_info.get("argv"),
            "fpath": str(fpath),
        })

    # (c) + (d) planned argv (run below unless --dry-run).
    if tool != MAPS_TOOL:
        refuse("c", f"no record writer registered for {tool}; refusing")
    record_argv = ["mise", "exec", "--", "python3", "-I", str(MAPS_PY),
                   "--glb", str(post_abs), "--provenance", str(args.sidecar.resolve()),
                   "--record-wired-materials-only"]
    body = select_body_path(sidecar, args.pre.resolve(), post_abs)
    if body is None:
        measure = {"skipped": f"{post_abs.name} is not a shipped body; nothing to measure"}
    else:
        if root:
            audit_out = str(Path(os.path.realpath(args.test_registry)).parent / "humanoid-basecolorfactor-audit.json")
            if fixture_root(audit_out) != root:
                refuse("d", f"measure audit output outside the fixture root ({audit_out}); refusing")
            measure = {"argv": ["mise", "exec", "--", "python3", "-I", str(MEASURE_PY), "--audit-out", audit_out, "--body", body.name]}
        else:
            measure = {"argv": ["mise", "exec", "--", "python3", "-I", str(MEASURE_PY), "--body", body.name]}

    if args.dry_run:
        print(json.dumps({
            "dryRun": True, "pre": str(args.pre), "post": str(args.post), "sidecar": str(args.sidecar),
            "checks": {"a": checks_a, "b": checks_b},
            "record": {"argv": record_argv}, "measure": measure,
            "live": live, "skipped": skipped,
        }, indent=1))
        return

    # (c) lineage record through the stage's own writer.
    proc = subprocess.run(record_argv, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        refuse("c", f"record writer failed ({(proc.stderr or proc.stdout).strip().splitlines()[:1]}); refusing")
    # (d) basecolor measure for each touched shipped body.
    measure_ran = False
    if "argv" in measure:
        proc = subprocess.run(measure["argv"], cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            refuse("d", f"basecolor measure failed ({(proc.stderr or proc.stdout).strip().splitlines()[:1]}); refusing")
        measure_ran = True
    # (e) re-pin live rows through their verbatim writer argv.
    for entry in live:
        env = {**os.environ,
               "FINALIZE_REPIN_FILE": entry["fpath"],
               "FINALIZE_REPIN_FIELDS": ",".join(entry["fieldNames"]),
               "FINALIZE_REPIN_PRE_SHA": pre_sha,
               "FINALIZE_REPIN_POST_SHA": post_sha}
        proc = subprocess.run(entry["writerArgv"], cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=600, env=env)
        if proc.returncode != 0:
            refuse("e", f"writer failed for {entry['file']} :: {entry['field']} ({(proc.stderr or proc.stdout).strip().splitlines()[:1]}); refusing")
        try:
            after = json.loads(Path(entry["fpath"]).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            refuse("e", f"writer left {entry['file']} :: {entry['field']} unreadable ({exc}); refusing")
        unpinned = [n for n in entry["fieldNames"] if field_value(after, n) != post_sha]
        if unpinned:
            refuse("e", f"writer left {entry['file']} :: {entry['field']} un-pinned ({', '.join(unpinned)}); refusing")
        entry["exit"] = 0
    print(json.dumps({
        "dryRun": False, "pre": str(args.pre), "post": str(args.post), "sidecar": str(args.sidecar),
        "checks": {"a": checks_a, "b": checks_b},
        "record": {"ran": True, "argv": record_argv},
        "measure": {"ran": measure_ran, **measure},
        "live": live, "skipped": skipped,
    }, indent=1))


if __name__ == "__main__":
    main()
