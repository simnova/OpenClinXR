import json
import unittest
from memory import KnownBudget, ReservationError, json_size


class MemoryTests(unittest.TestCase):
    def test_exact_fit_and_one_over_are_before_retention(self):
        b = KnownBudget(10)
        b.reserve('a', 'archive', 6, True)
        b.reserve('b', 'body', 4)
        with self.assertRaises(ReservationError):
            b.reserve('c', 'response', 1)
        self.assertEqual(b.held, 10)
        self.assertNotIn('c', b.items)
        b.release('b')
        b.seal()
        self.assertEqual(b.audit()['heldBytesAtClose'], 6)
        b.reserve('d', 'final-page', 4)
        b.release('d')
        with self.assertRaises(ReservationError):
            b.reserve('e', 'archive', 0, True)
        self.assertEqual(b.audit()['peakBytes'], 10)

    def test_serialization_copies_and_concurrent_categories_share_one_limit(self):
        b = KnownBudget(100)
        b.reserve('rows', 'archive', 60, True)
        b.reserve('text', 'json-text', 20)
        b.reserve('encoded', 'response-bytes', 20)
        with self.assertRaises(ReservationError):
            b.reserve('concurrent', 'request', 1)
        self.assertEqual(sum(b.categories.values()), b.held)
        b.release('text'); b.release('encoded')
        b.seal()
        self.assertEqual(b.audit()['heldBytesAtClose'], 60)
        self.assertEqual(b.audit()['peakBytes'], 100)

    def test_closed_append_and_invalid_resize_do_not_change_existing_rows(self):
        b = KnownBudget(8)
        b.reserve('row', 'current', 8)
        b.resize('row', 7, 'archive', retained=True)
        b.seal()
        for size in (8, -1, 1.5):
            with self.assertRaises(ValueError):
                b.resize('row', size)
        self.assertEqual(b.held, 7)

    def test_exact_compact_ascii_byte_count_without_full_encode(self):
        for value in ({'text':'\u0000\b\t\n\r\f"\\é😀\x7f', 'n':[None,True,False,0,-1,1.234e-12]}, [], {'z':1e100}):
            expected = len(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('ascii'))
            self.assertEqual(json_size(value), expected)

    def test_health_current_row_and_archive_are_admitted_before_growth(self):
        from health import DecodedHealth
        from fractions import Fraction
        b = KnownBudget(2048)
        config = {"bins": {"maximumRowsPerDecodedDirection": 512}}
        h = DecodedHealth("up", "clock", config, budget=b)
        h.process(128, 1, 48000, 0, Fraction(1, 48000), lambda i, c: .01, "s16", "mono", False)
        h.flush("phase-boundary")
        self.assertLess(b.held, 2048)
        self.assertEqual(h.archived_bytes, json_size(h.record["bins"][0]))
        with self.assertRaises(ReservationError):
            h.process(128, 1, 48000, 128, Fraction(1, 48000), lambda i, c: .01, "s16", "mono", False)
        self.assertEqual(len(h.record["bins"]), 1)
        self.assertEqual(h.record["total"]["frames"], 128)
        self.assertEqual(b.audit()["rejectedReservations"], 1)

    def test_no_nan_or_unsafe_integer(self):
        for value in (float('nan'), float('inf'), 9007199254740992):
            with self.assertRaises(ValueError):
                json_size(value)
