from __future__ import annotations

import ast
import logging
import math
import os
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
        time_from = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y%m%dT%H%M")
        ticker = f"CRYPTO:{symbol}"
        for api_key in self.alpha_keys:
            try:
                response = self.session.get("https://www.alphavantage.co/query", params={
                    "function": "NEWS_SENTIMENT", "tickers": ticker,
                    "time_from": time_from, "limit": 200, "apikey": api_key,
                }, timeout=30)
                response.raise_for_status()
                data = response.json()
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
                self.cache.provider_set(key, {"value": value}, 4 * 3600)
                return value
            except Exception as error:
                log.warning("sentiment provider failed for %s: %s", symbol, error)
        self.cache.provider_set(key, {"value": 0.0, "fallback": True}, 1800)
        return 0.0

    def trend(self, symbol: str) -> float:
        key = f"trend:{symbol}"
        cached = self.cache.provider_get(key)
        if cached is not None:
            return float(cached["value"])
        if os.getenv("AGAMIN_ENABLE_TRENDS", "1") != "1":
            return 0.0
        try:
            from pytrends.request import TrendReq

            kwargs = {"hl": "en-US", "tz": 0, "timeout": (10, 30)}
            if self.proxy_url:
                kwargs["proxies"] = [self.proxy_url]
            client = TrendReq(**kwargs)
            client.build_payload([symbol], timeframe="now 7-d")
            series = client.interest_over_time()[symbol].astype(float)
            if series.empty:
                value = 0.0
            else:
                window = series.tail(168)
                std = float(window.std(ddof=0))
                value = 0.0 if std < 1e-8 else float((window.iloc[-1] - window.mean()) / std)
            if not math.isfinite(value):
                value = 0.0
            self.cache.provider_set(key, {"value": value}, 6 * 3600)
            return value
        except Exception as error:
            log.warning("trends provider failed for %s: %s", symbol, error)
            self.cache.provider_set(key, {"value": 0.0, "fallback": True}, 1800)
            return 0.0
