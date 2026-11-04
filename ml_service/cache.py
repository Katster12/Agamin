from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS candles (
    symbol TEXT NOT NULL,
    open_time INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (symbol, open_time)
);
CREATE TABLE IF NOT EXISTS signals (
    symbol TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    trend REAL NOT NULL DEFAULT 0,
    sentiment REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol, observed_at)
);
CREATE TABLE IF NOT EXISTS predictions (
    symbol TEXT NOT NULL,
    horizon TEXT NOT NULL,
    payload TEXT NOT NULL,
    computed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, horizon)
);
CREATE TABLE IF NOT EXISTS provider_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles(symbol, open_time);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_time ON signals(symbol, observed_at);
"""


class LocalCache:
    def __init__(self, path: Path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.RLock()
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def newest_candle(self, symbol: str) -> int | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT MAX(open_time) value FROM candles WHERE symbol=?", (symbol,)
            ).fetchone()
        return row["value"] if row and row["value"] is not None else None

    def save_candles(self, symbol: str, rows: list[tuple]) -> None:
        if not rows:
            return
        payload = [(symbol, *row) for row in rows]
        with self._write_lock, self.connect() as connection:
            connection.executemany(
                """INSERT OR REPLACE INTO candles
                (symbol,open_time,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)""",
                payload,
            )

    def load_candles(self, symbol: str, since_ms: int) -> list[sqlite3.Row]:
        with self.connect() as connection:
            return connection.execute(
                """SELECT open_time,open,high,low,close,volume FROM candles
                WHERE symbol=? AND open_time>=? ORDER BY open_time""",
                (symbol, since_ms),
            ).fetchall()

    def prune_candles(self, before_ms: int) -> None:
        with self._write_lock, self.connect() as connection:
            connection.execute("DELETE FROM candles WHERE open_time<?", (before_ms,))

    def save_signal(self, symbol: str, observed_at: int, trend: float, sentiment: float) -> None:
        with self._write_lock, self.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO signals(symbol,observed_at,trend,sentiment) VALUES (?,?,?,?)",
                (symbol, observed_at, trend, sentiment),
            )

    def load_signals(self, symbol: str, since_ms: int) -> list[sqlite3.Row]:
        with self.connect() as connection:
            return connection.execute(
                """SELECT observed_at,trend,sentiment FROM signals
                WHERE symbol=? AND observed_at>=? ORDER BY observed_at""",
                (symbol, since_ms),
            ).fetchall()

    def save_prediction(self, symbol: str, horizon: str, payload: dict, ttl_seconds: int) -> None:
        now = int(time.time())
        with self._write_lock, self.connect() as connection:
            connection.execute(
                """INSERT OR REPLACE INTO predictions
                (symbol,horizon,payload,computed_at,expires_at) VALUES (?,?,?,?,?)""",
                (symbol, horizon, json.dumps(payload, allow_nan=False), now, now + ttl_seconds),
            )

    def get_prediction(self, symbol: str, horizon: str, allow_stale: bool = False) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload,expires_at FROM predictions WHERE symbol=? AND horizon=?",
                (symbol, horizon),
            ).fetchone()
        if not row or (not allow_stale and row["expires_at"] < int(time.time())):
            return None
        value = json.loads(row["payload"])
        value["cache_status"] = "stale" if row["expires_at"] < int(time.time()) else "hit"
        return value

    def all_predictions(self, allow_stale: bool = True) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute("SELECT payload,expires_at FROM predictions ORDER BY symbol,horizon").fetchall()
        now = int(time.time())
        values = []
        for row in rows:
            if not allow_stale and row["expires_at"] < now:
                continue
            value = json.loads(row["payload"])
            value["cache_status"] = "stale" if row["expires_at"] < now else "hit"
            values.append(value)
        return values

    def provider_get(self, key: str) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload,expires_at FROM provider_cache WHERE cache_key=?", (key,)
            ).fetchone()
        if not row or row["expires_at"] < int(time.time()):
            return None
        return json.loads(row["payload"])

    def provider_set(self, key: str, payload: dict, ttl_seconds: int) -> None:
        with self._write_lock, self.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO provider_cache(cache_key,payload,expires_at) VALUES (?,?,?)",
                (key, json.dumps(payload, allow_nan=False), int(time.time()) + ttl_seconds),
            )

    def stats(self) -> dict:
        with self.connect() as connection:
            candles = connection.execute("SELECT COUNT(*) value FROM candles").fetchone()["value"]
            signals = connection.execute("SELECT COUNT(*) value FROM signals").fetchone()["value"]
            predictions = connection.execute("SELECT COUNT(*) value FROM predictions").fetchone()["value"]
        return {"candles": candles, "signals": signals, "predictions": predictions, "path": str(self.path)}
