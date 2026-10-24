"""External parent supervisor for the native Phase2 graph child. Import-safe; no device IO.

Whole original external 45s is fixed (46s expansion rejected). The parent records its
absolute wall deadline and shares it into the child via QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS;
the child derives every internal budget from min(45s, parent remaining minus 1s reserve).
Timeout stays unqualified and preservation stays UNKNOWN; the source graph report remains
the sole actual evidence for root adjudication.
"""
import argparse
import hashlib
import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/Volumes/files/src/openclinxr')
SERIAL = '2G0YC5ZGB5000J'
ORIGIN = 'http://localhost:54245'
NONCE = 'fa298a26-f127-4b8e-a331-2e0599e965f2'
HERE = Path(__file__).resolve().parent
GRAPH_JS = HERE / 'graph.mjs'
WHOLE_MAX_S = 45.0
REPORT_RESERVE_S = 1.0
CHILD_IO_CAP = 65536
DEADLINE_ENV = 'QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS'
GRAPH_OUTPUT = ROOT / '.openclinxr/slices/quest3-stage1-duplex-immersive-baseline/evidence/audio-frame-tags/native-01/graph-actual-01'
CONTROL_OUTPUT = ROOT / '.openclinxr/slices/quest3-stage1-duplex-immersive-baseline/evidence/audio-frame-tags/native-01/graph-control-actual-01'
# Exact installed tsx loader verified by root (no downloads). Both no-execute and execute
# launches use explicit --import of this absolute canonical path; its sha256 is recorded in
# the source-bound launch receipt. Plain node resolves lifecycle.ts alone, but codec.ts /
# classifier.ts transitive types.js resolution needs this loader (else ERR_MODULE_NOT_FOUND).
TSX_LOADER = ROOT / 'node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs'


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def resolve_node():
    path = shutil.which('node')
    require(bool(path), 'Exact node binary unavailable in mise env')
    return os.path.realpath(path)


def tsx_loader():
    loader = os.path.realpath(TSX_LOADER)
    require(os.path.isfile(loader), 'Canonical installed tsx loader missing')
    return loader


def loader_sha256():
    with open(tsx_loader(), 'rb') as stream:
        return hashlib.sha256(stream.read()).hexdigest()


def node_child_argv(node_bin, config_path, execute):
    argv = [node_bin, '--import', tsx_loader(), str(GRAPH_JS),
            '--config', str(Path(config_path).resolve())]
    if execute:
        argv.append('--execute')
    return argv


def _check_bounds(whole_max_s, reserve_s):
    require(isinstance(whole_max_s, (int, float)) and not isinstance(whole_max_s, bool)
            and 0 < whole_max_s <= WHOLE_MAX_S,
            'whole budget must satisfy 0<whole<=45; 46s expansion rejected')
    require(isinstance(reserve_s, (int, float)) and not isinstance(reserve_s, bool)
            and 0 < reserve_s < whole_max_s, 'reserve must satisfy 0<reserve<whole')


def fsync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_write(path, value):
    path = Path(path)
    with open(path, 'x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    fsync_dir(path.parent)


def preflight(config):
    require(config.get('schema') == 'quest-audio-tags-native-graph-config.v1', 'Graph config schema')
    require(config.get('serial') == SERIAL and config.get('origin') == ORIGIN, 'Exact serial/origin')
    require(config.get('nonce') == NONCE, 'Single future graph nonce')
    for key in ['rootGo', 'independentRelease', 'plan', 'operatorManifest',
                'sourceManifest', 'observedProfile', 'rawProfile', 'humanReadiness']:
        ref = config.get(key)
        require(isinstance(ref, dict) and isinstance(ref.get('path'), str)
                and isinstance(ref.get('sha256'), str), 'Bound ref: ' + key)
    require(Path(config['output']) == GRAPH_OUTPUT, 'Graph child output must be graph-actual-01')
    if config.get('parentOutput') is not None:
        require(Path(config['parentOutput']) == CONTROL_OUTPUT, 'Parent control output must be graph-control-actual-01')
    return CONTROL_OUTPUT if config.get('parentOutput') is None else Path(config['parentOutput'])


def _drain_bounded(proc, out, err, counters, cap, stop_monotonic):
    """Drain both pipes without ever retaining unlimited output. Surplus past cap per pipe is
    counted and discarded while draining so a verbose child cannot block on a full pipe."""
    sel = selectors.DefaultSelector()
    streams = {}
    for stream in (proc.stdout, proc.stderr):
        if stream is not None:
            os.set_blocking(stream.fileno(), False)
            sel.register(stream, selectors.EVENT_READ)
            streams[stream.fileno()] = stream
    try:
        while streams:
            remaining = stop_monotonic - time.monotonic()
            if remaining <= 0:
                return False
            for key, _ in sel.select(timeout=min(remaining, 0.05)):
                stream = key.fileobj
                try:
                    chunk = os.read(stream.fileno(), 65536)
                except (BlockingIOError, OSError):
                    continue
                if not chunk:
                    try:
                        sel.unregister(stream)
                    except (KeyError, ValueError):
                        pass
                    streams.pop(stream.fileno(), None)
                    continue
                if stream is proc.stdout:
                    counters['out_total'] += len(chunk)
                    room = cap - len(out)
                    if room > 0:
                        out.extend(chunk[:room])
                else:
                    counters['err_total'] += len(chunk)
                    room = cap - len(err)
                    if room > 0:
                        err.extend(chunk[:room])
            if proc.poll() is not None and not streams:
                break
    finally:
        try:
            sel.close()
        except (OSError, ValueError):
            pass
    return True


def _close_pipes(proc):
    for stream in (proc.stdout, proc.stderr):
        if stream is not None:
            try:
                stream.close()
            except (OSError, ValueError):
                pass


def bounded_run(child_argv, whole_max_s, reserve_s, cap=CHILD_IO_CAP, extra_env=None):
    """Spawn child_argv in its own process group with bounded per-pipe capture. Testable with
    dummy Python children only; never invokes graph/adb itself. No retry, no rescue."""
    _check_bounds(whole_max_s, reserve_s)
    started_mono = time.monotonic()
    start_wall_ms = int(time.time() * 1000)
    deadline_wall_ms = start_wall_ms + int(whole_max_s * 1000)
    stop_mono = started_mono + whole_max_s - reserve_s
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    out, err = bytearray(), bytearray()
    counters = {'out_total': 0, 'err_total': 0}
    try:
        proc = subprocess.Popen(child_argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                start_new_session=True, env=env)
    except OSError as error:
        return {'proc': None, 'out': out, 'err': err, 'counters': counters,
                'timed_out': False, 'spawn_failed': str(error),
                'child_confirmed_exited': False, 'started_mono': started_mono,
                'start_wall_ms': start_wall_ms, 'deadline_wall_ms': deadline_wall_ms}
    drained = _drain_bounded(proc, out, err, counters, cap, stop_mono)
    timed_out = not drained
    if timed_out:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            pass
        reserve_stop = time.monotonic() + max(0.05, reserve_s)
        _drain_bounded(proc, out, err, counters, cap, reserve_stop)
    _close_pipes(proc)
    child_confirmed_exited = proc.poll() is not None
    return {'proc': proc, 'out': out, 'err': err, 'counters': counters,
            'timed_out': timed_out, 'spawn_failed': None,
            'child_confirmed_exited': child_confirmed_exited,
            'started_mono': started_mono, 'start_wall_ms': start_wall_ms,
            'deadline_wall_ms': deadline_wall_ms}


def supervise_child(child_argv, parent_out, whole_max_s=WHOLE_MAX_S, reserve_s=REPORT_RESERVE_S,
                    cap=CHILD_IO_CAP, launch_receipt=None):
    """One-shot supervised execute: mkdir before spawn, share absolute deadline into the child,
    bound all capture, fsync durable report plus final-clock file. Timeout stays unqualified,
    preservation stays UNKNOWN. Test budgets satisfy 0<whole<=45; production run() passes the
    fixed 45s default."""
    _check_bounds(whole_max_s, reserve_s)
    parent_out = Path(parent_out)
    parent_out.mkdir(parents=True, exist_ok=False)  # one-shot before spawn
    started_mono = time.monotonic()
    deadline_wall_ms = int(time.time() * 1000) + int(whole_max_s * 1000)
    env = {DEADLINE_ENV: str(deadline_wall_ms)}
    run = bounded_run(child_argv, whole_max_s, reserve_s, cap, extra_env=env)
    out, err, counters = run['out'], run['err'], run['counters']
    out_overflow = counters['out_total'] > cap
    err_overflow = counters['err_total'] > cap
    proc = run['proc']
    exit_code = proc.returncode if proc is not None else None
    report = {
        'schema': 'quest-native-graph-parent-control.v1',
        'serial': SERIAL,
        'childArgvHead': [child_argv[0], Path(child_argv[1]).name] if len(child_argv) > 1 else [child_argv[0]],
        'parentDeadlineUnixMs': deadline_wall_ms,
        'exit': exit_code,
        'timedOut': run['timed_out'],
        'spawnFailed': run['spawn_failed'],
        'childConfirmedExited': run['child_confirmed_exited'],
        'wholeMaxS': whole_max_s,
        'captureOverflow': out_overflow or err_overflow,
        'stdoutTruncated': out_overflow,
        'stderrTruncated': err_overflow,
        'truncatedStdout': bytes(out).decode('utf8', 'replace'),
        'truncatedStderr': bytes(err).decode('utf8', 'replace'),
        'restorationClaim': 'UNKNOWN: on timeout no target/maps/port restoration is claimed; '
                            'source graph report remains sole actual evidence for root adjudication',
    }
    if launch_receipt:
        report.update(launch_receipt)
    durable_write(parent_out / 'control-report.json', report)
    elapsed_after_report_fsync = time.monotonic() - started_mono
    prelim_success = (exit_code == 0 and not run['timed_out'] and run['spawn_failed'] is None
                      and run['child_confirmed_exited']
                      and elapsed_after_report_fsync <= whole_max_s
                      and not (out_overflow or err_overflow))
    # The final-clock file records the qualifier measured after the control-report fsync only.
    # Completion of THIS file's own fsync is NOT claimed from that earlier clock: it is measured
    # below, after the fsync returns, and the root external parent call clock observes the actual
    # whole interval as final authority.
    durable_write(parent_out / 'final-clock.json', {
        'schema': 'quest-native-graph-parent-final-clock.v1',
        'elapsedSIncludingReportFsync': elapsed_after_report_fsync,
        'wholeMaxS': whole_max_s,
        'exitedWithinOriginal45': elapsed_after_report_fsync <= whole_max_s,
        'successAtReportFsync': prelim_success,
        'finalAuthority': 'root external parent call clock observes the actual whole interval; '
                          'completion of this final-clock fsync is attested only by the '
                          'post-fsync elapsed in the returned receipt/stdout, never from the '
                          'earlier clock',
    })
    elapsed_after_final_fsync = time.monotonic() - started_mono
    success = (exit_code == 0 and not run['timed_out'] and run['spawn_failed'] is None
               and run['child_confirmed_exited'] and elapsed_after_final_fsync <= whole_max_s
               and not (out_overflow or err_overflow))
    report['elapsedS'] = elapsed_after_final_fsync
    report['success'] = success
    return report


def host_preflight(node_bin, config_path, timeout_s=20.0, cap=CHILD_IO_CAP):
    """No-execute host preflight: runs node graph --config WITHOUT --execute under a bound,
    with the same explicit tsx loader as execute. Never consumes the actual control output;
    capture is in-memory and capped."""
    child = node_child_argv(node_bin, config_path, False)
    run = bounded_run(child, timeout_s, min(1.0, timeout_s / 2), cap)
    return {'exit': run['proc'].returncode if run['proc'] is not None else None,
            'timedOut': run['timed_out'],
            'spawnFailed': run['spawn_failed'],
            'stdout': bytes(run['out']).decode('utf8', 'replace'),
            'stdoutTruncated': run['counters']['out_total'] > cap,
            'tsxLoader': child[2],
            'hostOnly': True}


def run(config_path, execute):
    config = json.loads(Path(config_path).read_text())
    parent_out = preflight(config)
    node_bin = resolve_node()
    if not execute:
        return host_preflight(node_bin, config_path)
    child = node_child_argv(node_bin, config_path, True)
    receipt = {'nodeBin': node_bin, 'tsxLoader': child[2], 'loaderSha256': loader_sha256(),
               'childArgv': child}
    return supervise_child(child, parent_out, launch_receipt=receipt)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    report = run(args.config, args.execute)
    if 'success' in report:
        print(json.dumps({'success': report['success'], 'exit': report.get('exit'),
                          'timedOut': report.get('timedOut'),
                          'elapsedS': report.get('elapsedS')}))
        sys.exit(0 if report['success'] else 2)
    print(json.dumps({'exit': report.get('exit'), 'timedOut': report.get('timedOut'),
                      'hostOnly': True}))
    sys.exit(0 if report.get('exit') == 0 else 2)


if __name__ == '__main__':
    main()
