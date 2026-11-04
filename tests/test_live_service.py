from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ml_service.cache import LocalCache
from ml_service.models import ModelRuntime
from ml_service.pipeline import ALIASES


ROOT = Path(__file__).resolve().parents[1]


class LiveServiceTests(unittest.TestCase):
    def test_all_model_bundles_load(self):
        runtime = ModelRuntime(ROOT)
        self.assertEqual(30, len(runtime.models))
        self.assertEqual(10, len(runtime.symbols))
        self.assertEqual(["30min", "12h", "24h"], runtime.models_for_symbol("BTC"))

    def test_sqlite_prediction_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = LocalCache(Path(folder) / "cache.sqlite3")
            cache.save_prediction("BTC", "30min", {"value": 1}, 60)
            self.assertEqual(1, cache.get_prediction("BTC", "30min")["value"])
            self.assertEqual("BTC", ALIASES["bitcoin"])


if __name__ == "__main__":
    unittest.main()
