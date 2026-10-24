"""Host-only verification for the native Phase2 audio-frame-tags operator.

Runs ONLY exact host checks; never touches device, network, browser, adb, or HTTP.
Root runs exactly:  python3 -B verify_host.py
Prints one JSON object to stdout (hashes + each command exit + summary) for root to save.
Exit 0 iff every gate passes, else 2. Gates are never weakened to pass.

Checks:
  1. node --check on the 3 owned JS files (pure syntax, no loader needed).
  2. node --import <canonical tsx loader> --test test_graph.mjs (22 pure tests).
  3. python -B test_run_graph.py with this interpreter (dummy children only).
  4. node --import <loader> importing the 3 canonical TS modules and asserting key
     exports exist (imports only define functions; no browser/device side effects).
  5. Frozen Phase1 hashes recomputed against local source-manifest.json.
  6. Operator file inventory sha256 recorded for the source seal (no fabrication).
  7. Negative preflight gate: a clearly synthetic TEMP bad-schema config must make
     graph.mjs exit nonzero before any owned IO, without consuming real outputs.

Full positive graph preflight is deliberately NOT run here: it needs root-issued
bound docs, a live lease, and a fresh output dir, none of which verify may fabricate.
The 22 pure tests plus the real module imports above are the honest host coverage;
no false coverage is claimed.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path('/Volumes/files/src/openclinxr')
TSX_LOADER = ROOT / 'node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs'
TS_MODULES = [
    ROOT / 'packages/openclinxr/xr-capacity/src/audio-frame-tags/lifecycle.ts',
    ROOT / 'packages/openclinxr/xr-capacity/src/audio-frame-tags/codec.ts',
    ROOT / 'packages/openclinxr/xr-capacity/src/audio-frame-tags/classifier.ts',
]
OWNED_JS = ['graph.mjs', 'graph-ownership.mjs', 'test_graph.mjs']
OWNED_PY = ['run_graph.py', 'test_run_graph.py', 'verify_host.py']
TAIL_CHARS = 2000


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def run_cmd(argv, cwd, timeout_s):
    try:
        proc = subprocess.run(argv, cwd=str(cwd), capture_output=True, timeout=timeout_s)
        out = (proc.stdout or b'').decode('utf8', 'replace')
        err = (proc.stderr or b'').decode('utf8', 'replace')
        return {'argv': argv, 'exit': proc.returncode, 'timedOut': False,
                'stdoutTail': out[-TAIL_CHARS:], 'stderrTail': err[-TAIL_CHARS:]}
    except subprocess.TimeoutExpired as error:
        out = ((error.stdout or b'').decode('utf8', 'replace'))[-TAIL_CHARS:]
        err = ((error.stderr or b'').decode('utf8', 'replace'))[-TAIL_CHARS:]
        return {'argv': argv, 'exit': None, 'timedOut': True,
                'stdoutTail': out, 'stderrTail': err}
    except OSError as error:
        return {'argv': argv, 'exit': None, 'timedOut': False,
                'stdoutTail': '', 'stderrTail': 'spawn failed: ' + str(error)}


def main():
    checks = []
    ok = True

    def record(name, result, want_exit=0):
        passed = result['exit'] == want_exit and not result['timedOut']
        checks.append({'name': name, 'pass': passed, **result})
        return passed

    node = shutil.which('node')
    loader = os.path.realpath(TSX_LOADER)
    loader_ok = bool(node) and os.path.isfile(loader)
    checks.append({'name': 'mise node + canonical tsx loader present',
                   'pass': loader_ok, 'node': node, 'loader': loader})
    ok = ok and loader_ok
    loader_hash = sha256_file(loader) if loader_ok else None

    for name in OWNED_JS:
        if not loader_ok:
            checks.append({'name': 'node --check ' + name, 'pass': False,
                           'argv': [], 'exit': None, 'timedOut': False,
                           'stdoutTail': '', 'stderrTail': 'node/loader unavailable'})
            ok = False
            continue
        ok = record('node --check ' + name,
                    run_cmd([node, '--check', str(HERE / name)], HERE, 60)) and ok

    if loader_ok:
        ok = record('node --test test_graph.mjs (tsx loader)',
                    run_cmd([node, '--import', loader, '--test', str(HERE / 'test_graph.mjs')],
                            HERE, 180)) and ok
        ok = record('python -B test_run_graph.py',
                    run_cmd([sys.executable, '-B', str(HERE / 'test_run_graph.py')],
                            HERE, 180)) and ok

        with tempfile.TemporaryDirectory(prefix='quest-verify-HOST-') as tmp:
            probe = Path(tmp) / 'probe-imports-HOST.mjs'
            lines = []
            for index, module in enumerate(TS_MODULES):
                lines.append(
                    "import * as mod%d from '%s';" % (index, module.as_uri()))
            lines.append('const need = ['
                         "['lifecycle.deadlineStep', mod0.deadlineStep],"
                         "['lifecycle.ownedCloseConfirmed', mod0.ownedCloseConfirmed],"
                         "['codec.decodeNodes', mod1.decodeNodes],"
                         "['codec.countMetadataScalars', mod1.countMetadataScalars],"
                         "['codec.NUMERIC_BOUNDS', mod1.NUMERIC_BOUNDS],"
                         "['classifier.classify', mod2.classify]];")
            lines.append('for (const [name, value] of need) {'
                         " if (value === undefined) throw Error('missing export ' + name); }")
            lines.append('if (typeof mod0.deadlineStep !== \'function\''
                         " || typeof mod1.decodeNodes !== 'function'"
                         " || typeof mod2.classify !== 'function')"
                         " throw Error('export type mismatch');")
            lines.append('process.stdout.write(JSON.stringify({importsOk: true,'
                         ' mainAndDriverMetadata: mod1.NUMERIC_BOUNDS.scalarSlots.mainAndDriverMetadata}) + "\\n");')
            probe.write_text('\n'.join(lines) + '\n')
            ok = record('node tsx import of 3 canonical modules (no side effects)',
                        run_cmd([node, '--import', loader, str(probe)], HERE, 60)) and ok

            bad = Path(tmp) / 'bad-config-HOST.json'
            bad.write_text(json.dumps({'schema': 'NOT-AUTHORITY-HOST-FIXTURE',
                                       'note': 'clearly synthetic; must be denied'}))
            neg = run_cmd([node, '--import', loader, str(HERE / 'graph.mjs'),
                           '--config', str(bad)], HERE, 60)
            denied = neg['exit'] not in (None, 0) and 'hostPreflightPassed' not in neg['stdoutTail']
            checks.append({'name': 'negative preflight gate denies synthetic config', 'pass': denied,
                           **neg})
            ok = ok and denied

    phase1 = {}
    try:
        manifest = json.loads((HERE / 'source-manifest.json').read_text())
        for name, expected in manifest['files'].items():
            actual = sha256_file(HERE / name)
            phase1[name] = {'expected': expected, 'actual': actual,
                            'match': actual == expected}
            if actual != expected:
                ok = False
    except OSError as error:
        phase1 = {'error': str(error)}
        ok = False

    operator = {}
    try:
        for name in OWNED_JS + OWNED_PY + ['graph-config-template.HELD.json']:
            operator[name] = sha256_file(HERE / name)
    except OSError as error:
        operator = {'error': str(error)}
        ok = False

    summary = {'passed': sum(1 for c in checks if c.get('pass')),
               'failed': sum(1 for c in checks if not c.get('pass')),
               'phase1Frozen': all(v.get('match') for v in phase1.values()) if phase1 and 'error' not in phase1 else False,
               'note': 'Full positive graph preflight not run (needs root-issued docs/lease/fresh output); '
                       'no false coverage claimed.'}
    output = {'schema': 'quest-native-operator-host-verify.v1',
              'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'node': node, 'loader': loader, 'loaderSha256': loader_hash,
              'hashes': {'phase1': phase1, 'operator': operator},
              'checks': checks, 'summary': summary}
    sys.stdout.write(json.dumps(output, indent=2) + '\n')
    sys.stdout.flush()
    sys.exit(0 if ok and summary['failed'] == 0 else 2)


if __name__ == '__main__':
    main()
