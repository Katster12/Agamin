from __future__ import annotations

import ast
import logging
import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

from .cache import LocalCache


log = logging.getLogger("agamin.providers")
BINANCE_URL = os.getenv("BINANCE_MARKET_DATA_URL", "https://data-api.binance.vision/api/v3/klines")
PAIR = {symbol: f"{symbol}USDT" for symbol in (
    "BTC", "ETH", "BNB", "XRP", "SOL", "DOGE", "TRX", "ADA", "AVAX", "LINK"
)}
TREND_TERMS = {
    "BTC": "Bitcoin", "ETH": "Ethereum", "BNB": "BNB crypto",
    "XRP": "XRP crypto", "SOL": "Solana crypto", "DOGE": "Dogecoin",
    "TRX": "TRON crypto", "ADA": "Cardano crypto",
    "AVAX": "AVAX crypto", "LINK": "Chainlink crypto",
}


def _literal_from_source(path: Path, name: str, default):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(target, ast.Name) and target.id == name for target in targets):
                return ast.literal_eval(node.value)
    return default


class LiveProviders:
    def __init__(self, repo_root: Path, cache: LocalCache):
        self.repo_root = Path(repo_root)
        self.cache = cache
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Agamin-live-pipeline/1.0"})
        pipeline = self.repo_root / "crypto_pipeline.py"
        env_keys = [value.strip() for value in os.getenv("ALPHA_VANTAGE_KEYS", "").split(",") if value.strip()]
        self.alpha_keys = env_keys or _literal_from_source(pipeline, "AV_API_KEYS", [])
        self.proxy_url = os.getenv("TRENDS_PROXY_URL") or _literal_from_source(pipeline, "PROXY_URL", "")
        self._alpha_lock = threading.Lock()
        self._trends_lock = threading.Lock()
        self._last_trends_request = 0.0

    def update_candles(self, symbol: str, lookback_days: int = 36) -> int:
        now_ms = int(time.time() * 1000)
        last_closed = (now_ms // 60_000) * 60_000 - 60_000
        floor = last_closed - lookback_days * 86_400_000
        newest = self.cache.newest_candle(symbol)
        start = max(floor, (newest + 60_000) if newest is not None else floor)
        inserted = 0
        while start <= last_closed:
            response = self.session.get(BINANCE_URL, params={
                "symbol": PAIR[symbol], "interval": "1m", "startTime": start,
                "endTime": last_closed + 59_999, "limit": 1000,
            }, timeout=30)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list):
                raise RuntimeError(f"Binance response for {symbol} is not a list")
            rows = []
            for item in data:
                if int(item[0]) > last_closed:
                    continue
                rows.append((int(item[0]), float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[5])))
            self.cache.save_candles(symbol, rows)
            inserted += len(rows)
            if not data:
                break
            next_start = int(data[-1][0]) + 60_000
            if next_start <= start:
                break
            start = next_start
            if len(data) < 1000:
                break
            time.sleep(0.03)
        return inserted

    def sentiment(self, symbol: str) -> float:
        key = f"sentiment:{symbol}"
        cached = self.cache.provider_get(key)
        if cached is not None:
            return float(cached["value"])
        if not self.alpha_keys:
            return 0.0
        availability_key = "alpha-vantage:news-sentiment:availability"
        availability = self.cache.provider_get(availability_key)
        if availability and not availability.get("available", True):
            self.cache.provider_set(key, {
                "value": 0.0, "fallback": True,
                "reason": availability.get("reason", "unavailable"),
            }, 1800)
            return 0.0

        # Refreshes run concurrently per coin. Serialize this premium endpoint so
        # an account-level failure is detected once instead of once per worker.
        with self._alpha_lock:
            availability = self.cache.provider_get(availability_key)
            if availability and not availability.get("available", True):
                self.cache.provider_set(key, {
                    "value": 0.0, "fallback": True,
                    "reason": availability.get("reason", "unavailable"),
                }, 1800)
                return 0.0

            time_from = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y%m%dT%H%M")
            ticker = f"CRYPTO:{symbol}"
            premium_responses = 0
            for api_key in self.alpha_keys:
                try:
                    response = self.session.get("https://www.alphavantage.co/query", params={
                        "function": "NEWS_SENTIMENT", "tickers": ticker,
                        "time_from": time_from, "limit": 200, "apikey": api_key,
                    }, timeout=30)
                    response.raise_for_status()
                    data = response.json()
                    information = str(data.get("Information", "")).lower()
                    if "premium endpoint" in information:
                        premium_responses += 1
                        continue
                    if "feed" not in data:
                        continue
                    scores = []
                    weights = []
                    for article in data.get("feed", []):
                        for entry in article.get("ticker_sentiment", []):
                            if entry.get("ticker") == ticker:
                                scores.append(float(entry.get("ticker_sentiment_score", 0)))
                                weights.append(max(float(entry.get("relevance_score", 0)), 1e-6))
                    value = float(np.average(scores, weights=weights)) if scores else 0.0
                    self.cache.provider_set(availability_key, {"available": True}, 24 * 3600)
                    self.cache.provider_set(key, {"value": value, "source": "alpha-vantage"}, 4 * 3600)
                    return value
                except Exception as error:
                    log.warning("sentiment provider failed for %s: %s", symbol, error)

            if premium_responses == len(self.alpha_keys):
                log.error(
                    "Alpha Vantage NEWS_SENTIMENT is unavailable: all %d configured keys lack premium entitlement",
                    len(self.alpha_keys),
                )
                self.cache.provider_set(availability_key, {
                    "available": False, "reason": "premium_entitlement_required",
                }, 24 * 3600)
                reason = "premium_entitlement_required"
            else:
                reason = "provider_request_failed"
            self.cache.provider_set(key, {"value": 0.0, "fallback": True, "reason": reason}, 1800)
            return 0.0

    def trend(self, symbol: str) -> float:
        key = f"trend:{symbol}"
        cached = self.cache.provider_get(key)
        if cached is not None:
            return float(cached["value"])
        if os.getenv("AGAMIN_ENABLE_TRENDS", "1") != "1":
            return 0.0
        from pytrends.request import TrendReq

        term = TREND_TERMS.get(symbol, f"{symbol} crypto")
        backends = [("direct", None)]
        if self.proxy_url:
            backends.append(("proxy", self.proxy_url))

        # Avoid the burst of 10 simultaneous two-request pytrends sessions that
        # causes Google to rate-limit both the host and rotating proxy exits.
        with self._trends_lock:
            errors = []
            for source, proxy in backends:
                interval = float(os.getenv("TRENDS_REQUEST_INTERVAL_SECONDS", "1.0"))
                delay = interval - (time.monotonic() - self._last_trends_request)
                if delay > 0:
                    time.sleep(delay)
                try:
                    kwargs = {"hl": "en-US", "tz": 0, "timeout": (10, 30)}
                    if proxy:
                        kwargs["proxies"] = [proxy]
                    client = TrendReq(**kwargs)
                    self._last_trends_request = time.monotonic()
                    client.build_payload([term], timeframe="now 7-d")
                    frame = client.interest_over_time()
                    if frame.empty or term not in frame:
                        value = 0.0
                    else:
                        series = frame[term].astype(float)
                        window = series.tail(168)
                        std = float(window.std(ddof=0))
                        value = 0.0 if std < 1e-8 else float((window.iloc[-1] - window.mean()) / std)
                    if not math.isfinite(value):
                        value = 0.0
                    self.cache.provider_set(key, {"value": value, "source": source, "term": term}, 6 * 3600)
                    return value
                except Exception as error:
                    errors.append(f"{source}:{type(error).__name__}")
                    log.warning("trends %s attempt failed for %s: %s", source, symbol, error)

        self.cache.provider_set(key, {
            "value": 0.0, "fallback": True, "reason": ",".join(errors),
        }, 1800)
        return 0.0
