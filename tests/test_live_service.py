from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ml_service.cache import LocalCache
from ml_service.models import ModelRuntime
from ml_service.pipeline import ALIASES
from ml_service.providers import LiveProviders, TREND_TERMS


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

    def test_crypto_trend_terms_are_unambiguous(self):
        self.assertEqual("Bitcoin", TREND_TERMS["BTC"])
        self.assertEqual("TRON crypto", TREND_TERMS["TRX"])
        self.assertEqual("AVAX crypto", TREND_TERMS["AVAX"])

    def test_alpha_premium_failure_is_circuit_broken(self):
        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return {"Information": "This is a premium endpoint."}

        class Session:
            def __init__(self):
                self.calls = 0

            def get(self, *args, **kwargs):
                self.calls += 1
                return Response()

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "crypto_pipeline.py").write_text("AV_API_KEYS = []\nPROXY_URL = ''\n")
            provider = LiveProviders(root, LocalCache(root / "cache.sqlite3"))
            provider.alpha_keys = ["key-one", "key-two"]
            provider.session = Session()
            self.assertEqual(0.0, provider.sentiment("BTC"))
            self.assertEqual(0.0, provider.sentiment("ETH"))
            self.assertEqual(2, provider.session.calls)


if __name__ == "__main__":
    unittest.main()
