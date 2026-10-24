"""Pre-growth known UTF-8/scalar/payload reservations, not Python/native heap."""
import json
import math


class ReservationError(ValueError):
    pass


class KnownBudget:
    def __init__(self, limit):
        self.limit, self.held, self.peak, self.closed, self.rejected = limit, 0, 0, False, 0
        self.items, self.categories, self.category_peaks, self.at_close = {}, {}, {}, 0

    def reserve(self, key, category, size, retained=False):
        if key in self.items or not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError("invalid reservation key/dimension")
        if (self.closed and retained) or self.held + size > self.limit:
            self.rejected += 1
            raise ReservationError(f"known bytes rejected: {category} {size}, held {self.held}, limit {self.limit}, sealed {self.closed}")
        self.items[key] = (category, size, retained)
        self.held += size
        self.peak = max(self.peak, self.held)
        self.categories[category] = self.categories.get(category, 0) + size
        self.category_peaks[category] = max(self.category_peaks.get(category, 0), self.categories[category])
        return key

    def release(self, key):
        category, size, _ = self.items.pop(key)
        self.held -= size
        self.categories[category] -= size

    def resize(self, key, size, category=None, retained=None):
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError("invalid byte dimension")
        old_category, old_size, old_retained = self.items[key]
        retained = old_retained if retained is None else retained
        if (self.closed and (size > old_size or (retained and not old_retained))) or self.held + size - old_size > self.limit:
            self.rejected += 1
            raise ReservationError("known retained byte growth rejected")
        self.release(key)
        self.reserve(key, category or old_category, size, retained=False)
        self.items[key] = (category or old_category, size, retained)

    def seal(self):
        if not self.closed:
            self.closed = True
            self.at_close = sum(size for _, size, retained in self.items.values() if retained)

    def audit(self):
        return {"limitBytes": self.limit, "peakBytes": self.peak, "heldBytesAtClose": self.at_close,
                "rejectedReservations": self.rejected, "closed": self.closed, "categoryPeaks": dict(self.category_peaks)}


def json_size(value):
    """Exact ensure_ascii compact JSON byte count WITHOUT materializing a full string."""
    if value is None:
        return 4
    if isinstance(value, bool):
        return 4 if value else 5
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or (isinstance(value, int) and abs(value) > 9007199254740991):
            raise ValueError("nonfinite/unsafe JSON scalar")
        return len(json.dumps(value, allow_nan=False))
    if isinstance(value, str):
        n = 2
        for char in value:
            code = ord(char)
            n += 2 if char in ('"', '\\', '\b', '\f', '\n', '\r', '\t') else 6 if code < 32 or 126 < code <= 65535 else 12 if code > 65535 else 1
        return n
    if isinstance(value, (list, tuple)):
        return 2 + max(0, len(value) - 1) + sum(json_size(item) for item in value)
    if isinstance(value, dict):
        return 2 + max(0, len(value) - 1) + sum(json_size(key) + 1 + json_size(item) for key, item in value.items())
    raise ValueError("unsupported JSON value")
