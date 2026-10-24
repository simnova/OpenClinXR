"""Host-only parent supervisor guards; dummy Python children only, never graph/adb."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
import run_graph as subject


def child(code):
    return [sys.executable, '-c', code]


class Guards(unittest.TestCase):
    def test_success_child(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-01'
            report = subject.supervise_child(child('print("{\\"ok\\":true}")'), out,
                                             whole_max_s=10.0, reserve_s=0.2)
            self.assertEqual(report['exit'], 0)
            self.assertFalse(report['timedOut'])
            self.assertIn('restorationClaim', report)
            self.assertTrue((out / 'control-report.json').exists())

    def test_nonzero_child(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            report = subject.supervise_child(child('import sys; sys.exit(2)'),
                                             Path(tmp) / 'control-02',
                                             whole_max_s=10.0, reserve_s=0.2)
            self.assertEqual(report['exit'], 2)
            self.assertFalse(report['timedOut'])
            self.assertIn('UNKNOWN', report['restorationClaim'])

    def test_hang_child_stopped_by_deadline_without_restoration_claim(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            report = subject.supervise_child(child('import time; time.sleep(30)'),
                                             Path(tmp) / 'control-03',
                                             whole_max_s=1.0, reserve_s=0.2)
            self.assertTrue(report['timedOut'])
            self.assertIn('no target/maps/port restoration is claimed', report['restorationClaim'])

    def test_parent_output_one_shot(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-04'
            subject.supervise_child(child('print(1)'), out, whole_max_s=10.0, reserve_s=0.2)
            with self.assertRaises(FileExistsError):
                subject.supervise_child(child('print(1)'), out, whole_max_s=10.0, reserve_s=0.2)

    def test_preflight_rejects_bad_config_before_spawn(self):
        with self.assertRaises(ValueError):
            subject.preflight({'schema': 'NOT-AUTHORITY'})

    def test_verbose_child_capped_never_fully_buffered(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-verbose'
            report = subject.supervise_child(
                child('import sys; sys.stdout.write("V" * 300000)'),
                out, whole_max_s=10.0, reserve_s=0.2, cap=65536)
            self.assertEqual(report['exit'], 0)
            self.assertTrue(report['stdoutTruncated'])
            self.assertTrue(report['captureOverflow'])
            self.assertLessEqual(len(report['truncatedStdout'].encode('utf8')), 65536)
            self.assertFalse(report['success'])

    def test_hanging_descendant_pipe_never_blocks_parent(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-descendant'
            started = time.monotonic()
            report = subject.supervise_child(
                child('import subprocess,sys;'
                      'subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]);'
                      'print("child-done")'),
                out, whole_max_s=2.0, reserve_s=0.5)
            self.assertLess(time.monotonic() - started, 2.0 + 1.5)
            self.assertTrue((out / 'control-report.json').exists())
            self.assertTrue((out / 'final-clock.json').exists())

    def test_spawn_failure_persists_failed_receipt(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-spawnfail'
            report = subject.supervise_child(['/nonexistent/quest-binary-xyz'], out,
                                             whole_max_s=10.0, reserve_s=0.2)
            self.assertIsNotNone(report['spawnFailed'])
            self.assertIsNone(report['exit'])
            self.assertFalse(report['childConfirmedExited'])
            self.assertFalse(report['success'])
            self.assertTrue((out / 'control-report.json').exists())
            self.assertTrue((out / 'final-clock.json').exists())

    def test_final_clock_and_receipt_record_inclusive_elapsed(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-clock'
            report = subject.supervise_child(child('print(1)'), out,
                                             whole_max_s=10.0, reserve_s=0.2)
            clock = json.loads((out / 'final-clock.json').read_text())
            self.assertTrue(report['success'])
            self.assertTrue(clock['successAtReportFsync'])
            self.assertTrue(clock['exitedWithinOriginal45'])
            self.assertIn('finalAuthority', clock)
            self.assertGreaterEqual(clock['elapsedSIncludingReportFsync'], 0)
            self.assertLessEqual(clock['elapsedSIncludingReportFsync'], 10.0)
            self.assertGreaterEqual(report['elapsedS'], clock['elapsedSIncludingReportFsync'])

    def test_child_inherits_bounded_parent_deadline(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            out = Path(tmp) / 'control-deadline'
            before_ms = int(time.time() * 1000)
            report = subject.supervise_child(
                child('import os; print(os.environ.get("QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS",""))'),
                out, whole_max_s=10.0, reserve_s=0.2)
            inherited_ms = int(report['truncatedStdout'].strip())
            self.assertGreaterEqual(inherited_ms - before_ms, 9990)
            self.assertLessEqual(inherited_ms - before_ms, 11000)
            self.assertEqual(report['parentDeadlineUnixMs'], inherited_ms)

    def test_whole_45s_fixed_rejects_46s_expansion(self):
        self.assertEqual(subject.WHOLE_MAX_S, 45.0)
        self.assertEqual(subject.REPORT_RESERVE_S, 1.0)
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            with self.assertRaises(ValueError):
                subject.supervise_child(child('print(1)'), Path(tmp) / 'control-46',
                                        whole_max_s=46.0, reserve_s=1.0)

    def test_short_test_budgets_permitted_within_original_45(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            report = subject.supervise_child(child('print(1)'), Path(tmp) / 'control-short',
                                             whole_max_s=10.0, reserve_s=0.2)
            self.assertTrue(report['success'])
            self.assertEqual(report['wholeMaxS'], 10.0)

    def test_degenerate_budgets_rejected(self):
        with tempfile.TemporaryDirectory(prefix='quest-parent-HOST-') as tmp:
            for whole, reserve in [(0, 0.2), (-1.0, 0.2), (10.0, 0), (10.0, 10.0), (10.0, 20.0)]:
                with self.assertRaises(ValueError):
                    subject.supervise_child(child('print(1)'), Path(tmp) / 'control-degenerate',
                                            whole_max_s=whole, reserve_s=reserve)

    def test_node_argv_uses_explicit_canonical_tsx_loader(self):
        argv = subject.node_child_argv('/fake/node', '/tmp/cfg.json', False)
        self.assertEqual(argv[:2], ['/fake/node', '--import'])
        self.assertTrue(argv[2].endswith('tsx/dist/loader.mjs'))
        self.assertTrue(os.path.isabs(argv[2]))
        self.assertEqual(argv[3:], [str(subject.GRAPH_JS), '--config',
                                   str(Path('/tmp/cfg.json').resolve())])
        argv_exec = subject.node_child_argv('/fake/node', '/tmp/cfg.json', True)
        self.assertEqual(argv_exec[-1], '--execute')
        self.assertEqual(argv_exec[3:-1], [str(subject.GRAPH_JS), '--config',
                                           str(Path('/tmp/cfg.json').resolve())])
        self.assertRegex(subject.loader_sha256(), r'^[0-9a-f]{64}$')


if __name__ == '__main__':
    unittest.main(verbosity=2)
