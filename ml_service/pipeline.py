from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .cache import LocalCache
from .models import HORIZONS, ModelRuntime
from .providers import LiveProviders


log = logging.getLogger("agamin.pipeline")
LOOKBACK_MS = 36 * 86_400_000
ALIASES = {
    "bitcoin": "BTC", "ethereum": "ETH", "binancecoin": "BNB", "ripple": "XRP",
    "solana": "SOL", "dogecoin": "DOGE", "tron": "TRX", "cardano": "ADA",
    "avalanche-2": "AVAX", "avalanche": "AVAX", "chainlink": "LINK",
}


class LivePipeline:
    def __init__(self, repo_root: Path, state_dir: Path, workers: int | None = None):
        self.repo_root = Path(repo_root).resolve()
        self.state_dir = Path(state_dir).resolve()
        self.cache = LocalCache(self.state_dir / "agamin-live.sqlite3")
        self.providers = LiveProviders(self.repo_root, self.cache)
        self.runtime = ModelRuntime(self.repo_root)
        self.workers = workers or min(8, max(2, os.cpu_count() or 2))
        self.refresh_seconds = int(os.getenv("AGAMIN_REFRESH_SECONDS", "300"))
        self.started_at = int(time.time())
        self.last_refresh_at: int | None = None
        self.last_success_at: int | None = None
        self.last_error: str | None = None
        self.refreshing = False
        self._stop = threading.Event()
        self._refresh_lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="agamin-refresh", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.refresh_all()
            except Exception as error:
                self.last_error = str(error)
                log.exception("full refresh failed")
            self._stop.wait(self.refresh_seconds)

    def refresh_all(self) -> dict:
        if not self._refresh_lock.acquire(blocking=False):
            return {"status": "already-refreshing"}
        self.refreshing = True
        self.last_refresh_at = int(time.time())
        outcomes = {}
        try:
            with ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="coin") as pool:
                futures = {pool.submit(self.refresh_coin, symbol): symbol for symbol in self.runtime.symbols}
                for future in as_completed(futures):
                    symbol = futures[future]
                    try:
                        outcomes[symbol] = future.result()
                    except Exception as error:
                        outcomes[symbol] = {"error": str(error)}
                        log.exception("refresh failed for %s", symbol)
            failures = {key: value for key, value in outcomes.items() if "error" in value}
            if failures:
                self.last_error = f"{len(failures)} coin refresh(es) failed"
            else:
                self.last_error = None
                self.last_success_at = int(time.time())
            self.cache.prune_candles(int(time.time() * 1000) - 40 * 86_400_000)
            return outcomes
        finally:
            self.refreshing = False
            self._refresh_lock.release()

    def refresh_coin(self, symbol: str, force: bool = False) -> dict:
        inserted = self.providers.update_candles(symbol)
        now_ms = int(time.time() * 1000)
        sentiment = self.providers.sentiment(symbol)
        trend = self.providers.trend(symbol)
        signal_bucket = (now_ms // 1_800_000) * 1_800_000
        self.cache.save_signal(symbol, signal_bucket, trend, sentiment)
        needed = [
            horizon for horizon in HORIZONS
            if force or self.cache.get_prediction(symbol, horizon) is None
        ]
        if not needed:
            return {"inserted_candles": inserted, "predicted": [], "cache_reused": True}
        candles = self.cache.load_candles(symbol, now_ms - LOOKBACK_MS)
        signals = self.cache.load_signals(symbol, now_ms - LOOKBACK_MS)
        predicted = []
        for horizon in needed:
            config = HORIZONS[horizon]
            payload = self.runtime.predict(symbol, horizon, candles, signals)
            self.cache.save_prediction(symbol, horizon, payload, config["ttl"])
            predicted.append(horizon)
        return {"inserted_candles": inserted, "predicted": predicted, "candles_available": len(candles)}

    def predict(self, symbol: str, horizons: list[str] | None = None) -> dict:
        raw_symbol = str(symbol or "").strip()
        symbol = ALIASES.get(raw_symbol.lower(), raw_symbol.upper())
        if symbol not in self.runtime.symbols:
            raise ValueError(f"unsupported coin '{symbol}'")
        requested = horizons or list(HORIZONS)
        invalid = [horizon for horizon in requested if horizon not in HORIZONS]
        if invalid:
            raise ValueError(f"unsupported horizon(s): {', '.join(invalid)}")
        missing = [horizon for horizon in requested if self.cache.get_prediction(symbol, horizon) is None]
        if missing:
            self.refresh_coin(symbol)
        predictions = []
        for horizon in requested:
            value = self.cache.get_prediction(symbol, horizon, allow_stale=True)
            if value is None:
                raise RuntimeError(f"prediction unavailable for {symbol}/{horizon}")
            predictions.append(value)
        primary = predictions[0]
        return {
            "success": True,
            "coin": symbol,
            "prediction": primary["direction"],
            "price_target": primary["price_target"],
            "confidence": None,
            "predictions": predictions,
            "cached": all(value["cache_status"] == "hit" for value in predictions),
            "research_only": True,
            "warning": "The supplied models missed their research targets and are not suitable for trading.",
        }

    def health(self) -> dict:
        predictions = self.cache.all_predictions()
        ready = len(predictions) == len(self.runtime.models)
        return {
            "status": "ok" if ready and self.last_error is None else "warming" if self.refreshing else "degraded",
            "ready": ready,
            "refreshing": self.refreshing,
            "models_loaded": len(self.runtime.models),
            "cached_predictions": len(predictions),
            "workers": self.workers,
            "started_at": self.started_at,
            "last_refresh_at": self.last_refresh_at,
            "last_success_at": self.last_success_at,
            "last_error": self.last_error,
            "cache": self.cache.stats(),
        }
