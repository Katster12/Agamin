from __future__ import annotations

import csv
import json
import logging
import random
import re
import sys
import time
import zipfile
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

import boto3
import numpy as np
import pandas as pd
import requests
import tqdm
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from pytrends.request import TrendReq

from logging.handlers import RotatingFileHandler

_fmt     = logging.Formatter("%(asctime)s [%(levelname)-8s] %(name)s — %(message)s")
_console = logging.StreamHandler(sys.stdout)
_console.setFormatter(_fmt)
_file    = RotatingFileHandler(
    "pipeline.log", maxBytes=20 * 1024 * 1024, backupCount=5, mode="a"
)
_file.setFormatter(_fmt)
logging.basicConfig(level=logging.INFO, handlers=[_console, _file])
log = logging.getLogger("crypto_pipeline")

SYMBOL_MAP: dict[str, str] = {
    "BTC":  "BTCUSDT",
    "ETH":  "ETHUSDT",
    "BNB":  "BNBUSDT",
    "XRP":  "XRPUSDT",
    "SOL":  "SOLUSDT",
    "DOGE": "DOGEUSDT",
    "TRX":  "TRXUSDT",
    "ADA":  "ADAUSDT",
    "AVAX": "AVAXUSDT",
    "LINK": "LINKUSDT",
}

TREND_KEYWORDS: dict[str, str] = {
    "BTC":  "Bitcoin",
    "ETH":  "Ethereum",
    "BNB":  "BNB",
    "XRP":  "XRP",
    "SOL":  "Solana",
    "DOGE": "Dogecoin",
    "TRX":  "TRON",
    "ADA":  "Cardano",
    "AVAX": "Avalanche",
    "LINK": "Chainlink",
}

AV_API_KEYS: list[str] = [
    "D0W2UA9FZ3UQ2CU6",
    "PZF9Z1CGAOZ1JFH6",
    "GI06QXYMPDXOULKK",
    "2CBFX9SDD9BY6LWS",
    "2PB60EQCOEKYU5BW",
    "BZ3QWMKFBOPI8UGY",
    "QFL649DZGARGBLX2",
    "VLHFXQ85QUN23LXX",
    "A6EZWPQWM1IBIE0V",
]

AV_TICKER_MAP: dict[str, str] = {
    "BTC":  "CRYPTO:BTC",
    "ETH":  "CRYPTO:ETH",
    "BNB":  "CRYPTO:BNB",
    "XRP":  "CRYPTO:XRP",
    "SOL":  "CRYPTO:SOL",
    "DOGE": "CRYPTO:DOGE",
    "TRX":  "CRYPTO:TRX",
    "ADA":  "CRYPTO:ADA",
    "AVAX": "CRYPTO:AVAX",
    "LINK": "CRYPTO:LINK",
}

AV_BASE_URL   = "https://www.alphavantage.co/query"
BTC_PENALTY   = 0.7

_av_key_idx: int = 0

PIPELINE_START = date(2025, 5,  1)
PIPELINE_END   = date(2026, 3, 28)

BINANCE_BASE = "https://data.binance.vision/data/spot/monthly/klines"

S3_BUCKET = "vantage-crypto-sentiment-raw-data-bda1"
S3_PREFIX = "source=binance"

CACHE_DIR      = Path("cache")
ZIP_DIR        = CACHE_DIR / "zips"
TRENDS_DIR     = CACHE_DIR / "trends"
SENTIMENT_DIR  = CACHE_DIR / "sentiment"
CHECKPOINT_DIR = CACHE_DIR / "checkpoints"
OUTPUT_DIR     = CACHE_DIR / "output"

for _d in (ZIP_DIR, TRENDS_DIR, SENTIMENT_DIR, CHECKPOINT_DIR, OUTPUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

ROLLING_WINDOW = 1440

UTC = timezone.utc
IST = timezone(timedelta(hours=5, minutes=30))

PROXY_URL = "http://emjebxxp-rotate:hkhx83jzns8p@p.webshare.io:80"
PROXIES   = {"http": PROXY_URL, "https": PROXY_URL}

MAX_WORKERS = min(4, len(SYMBOL_MAP))

COL_OPEN_TIME = 0
COL_OPEN      = 1
COL_HIGH      = 2
COL_LOW       = 3
COL_CLOSE     = 4
COL_VOLUME    = 5

ZSCORE_WINDOW      = 168
ZSCORE_MIN_PERIODS = 1
ZSCORE_EPSILON     = 1e-8

BUCKET_30MIN_MS = 1_800_000
BUCKET_4H_MS    = 14_400_000

TRENDS_BACKOFF_BASE = 10
TRENDS_BACKOFF_MAX  = 300

_ATR15_WIN  = 15
_ATR60_WIN  = 60
_BBW15_WIN  = 300
_BBW60_WIN  = 1200

_4H_WINDOW_ARTICLES = 5


def retry(
    fn,
    *args,
    attempts: int = 3,
    base_delay: float = 2.0,
    jitter: float = 1.0,
    exceptions: tuple = (Exception,),
    **kwargs,
):
    for attempt in range(1, attempts + 1):
        try:
            return fn(*args, **kwargs)
        except exceptions as exc:
            if attempt == attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, jitter)
            log.warning(
                "Attempt %d/%d failed — %s: %s. Retrying in %.1fs …",
                attempt, attempts, type(exc).__name__, exc, delay,
            )
            time.sleep(delay)


def month_range(start: date, end: date) -> list[tuple[int, int]]:
    result, cur = [], start.replace(day=1)
    stop = end.replace(day=1)
    while cur <= stop:
        result.append((cur.year, cur.month))
        nm = cur.month % 12 + 1
        ny = cur.year + (1 if cur.month == 12 else 0)
        cur = cur.replace(year=ny, month=nm)
    return result


def day_range(start: date, end: date) -> list[date]:
    out, cur = [], start
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def _fmt_ist(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=IST).strftime("%Y-%m-%d %H:%M:%S")


def _day_key(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=UTC).strftime("%Y-%m-%d")


def _ckpt_path(symbol: str, source: str) -> Path:
    return CHECKPOINT_DIR / f"{symbol}_{source}.json"


def load_checkpoint(symbol: str, source: str) -> dict:
    path = _ckpt_path(symbol, source)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            log.info("[%s][%s] Checkpoint loaded: %s", symbol, source, data)
            return data
        except (json.JSONDecodeError, KeyError):
            log.warning("[%s][%s] Corrupt checkpoint — starting fresh.", symbol, source)
    return {}


def save_checkpoint(symbol: str, source: str, data: dict) -> None:
    path = _ckpt_path(symbol, source)
    tmp  = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str))
    tmp.replace(path)
    log.debug("[%s][%s] Checkpoint saved: %s", symbol, source, data)


def _zip_url(ticker: str, year: int, month: int) -> str:
    fn = f"{ticker}-1m-{year}-{month:02d}.zip"
    return f"{BINANCE_BASE}/{ticker}/1m/{fn}"


def _zip_local(ticker: str, year: int, month: int) -> Path:
    return ZIP_DIR / f"{ticker}-1m-{year}-{month:02d}.zip"


def download_data(symbol: str) -> list[Path]:
    ticker = SYMBOL_MAP[symbol]
    months = month_range(PIPELINE_START, PIPELINE_END)
    paths: list[Path] = []

    for year, month in tqdm.tqdm(months, desc=f"[{symbol}] ZIPs", unit="zip"):
        local = _zip_local(ticker, year, month)
        paths.append(local)
        if local.exists():
            log.debug("[%s] Already cached: %s", symbol, local.name)
            continue

        url = _zip_url(ticker, year, month)
        log.info("[%s] Downloading %s", symbol, url)

        def _fetch(u=url):
            r = requests.get(u, timeout=60, stream=True)
            r.raise_for_status()
            return r

        try:
            resp = retry(_fetch, attempts=3, base_delay=3.0,
                         exceptions=(requests.RequestException,))
        except requests.RequestException as exc:
            log.error("[%s] Download failed for %s (%s) — skipping.", symbol, url, exc)
            paths.pop()
            continue

        tmp = local.with_suffix(".part")
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
        tmp.replace(local)
        log.info("[%s] Saved %s  (%.1f MB)", symbol, local.name,
                 local.stat().st_size / 1e6)

    return paths


def extract_zip(zip_path: Path) -> Path | None:
    if not zip_path.exists():
        return None
    csv_path = zip_path.with_suffix(".csv")
    if csv_path.exists():
        return csv_path
    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = [n for n in zf.namelist() if n.endswith(".csv")]
            if not names:
                log.error("No CSV inside %s", zip_path)
                return None
            with zf.open(names[0]) as src, open(csv_path, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
        return csv_path
    except zipfile.BadZipFile:
        log.error("Bad ZIP: %s", zip_path)
        return None


def _iter_klines(csv_path: Path) -> Iterator[tuple]:
    TS_MIN_MS = 1_577_836_800_000
    TS_MAX_MS = 1_893_456_000_000

    with open(csv_path, newline="") as fh:
        reader = csv.reader(fh)
        for row in reader:
            if not row or not row[0].isdigit():
                continue
            ts_raw = int(row[COL_OPEN_TIME])
            ts_len = len(str(ts_raw))
            if ts_len == 13:
                ts_ms = ts_raw
            elif ts_len == 16:
                ts_ms = ts_raw // 1000
            else:
                log.warning("[klines] Unrecognised timestamp length %d: %s", ts_len, ts_raw)
                continue
            if not (TS_MIN_MS <= ts_ms <= TS_MAX_MS):
                log.warning("[klines] Out-of-range timestamp: raw=%s ms=%s", ts_raw, ts_ms)
                continue
            yield (
                ts_ms,
                float(row[COL_OPEN]),
                float(row[COL_HIGH]),
                float(row[COL_LOW]),
                float(row[COL_CLOSE]),
                float(row[COL_VOLUME]),
            )


class RollingOHLCV:

    def __init__(self, window: int = ROLLING_WINDOW):
        self.window    = window
        self._opens:   deque[float] = deque()
        self._highs:   deque[float] = deque()
        self._lows:    deque[float] = deque()
        self._volumes: deque[float] = deque()
        self._high_val = float("-inf")
        self._low_val  = float("inf")
        self._vol_sum  = 0.0

    def push(self, o: float, h: float, l: float, v: float) -> None:
        self._opens.append(o)
        self._highs.append(h)
        self._lows.append(l)
        self._volumes.append(v)
        self._vol_sum += v

        if len(self._opens) > self.window:
            self._opens.popleft()
            old_h = self._highs.popleft()
            old_l = self._lows.popleft()
            old_v = self._volumes.popleft()
            self._vol_sum -= old_v
            if old_h >= self._high_val or old_l <= self._low_val:
                self._high_val = max(self._highs) if self._highs else float("-inf")
                self._low_val  = min(self._lows)  if self._lows  else float("inf")
            return

        if h > self._high_val:
            self._high_val = h
        if l < self._low_val:
            self._low_val = l

    @property
    def open(self)   -> float: return self._opens[0]  if self._opens  else 0.0
    @property
    def high(self)   -> float: return self._high_val  if self._highs  else 0.0
    @property
    def low(self)    -> float: return self._low_val   if self._lows   else 0.0
    @property
    def volume(self) -> float: return self._vol_sum


def compute_rolling_metrics(rows: list[tuple]) -> list[dict]:
    roller, result = RollingOHLCV(), []
    for ts_ms, o, h, l, c, v in rows:
        roller.push(o, h, l, v)
        result.append({
            "ts_ms": ts_ms,
            "c": c,
            "o": roller.open,
            "h": roller.high,
            "l": roller.low,
            "v": roller.volume,
        })
    return result


def _sentiment_csv_path(symbol: str) -> Path:
    return SENTIMENT_DIR / f"{symbol}_sentiment.csv"


def _is_av_rate_limited(data: dict) -> bool:
    return "Information" in data or "Note" in data


def _av_current_key() -> str:
    global _av_key_idx
    return AV_API_KEYS[_av_key_idx % len(AV_API_KEYS)]


def _av_rotate_key(symbol: str) -> None:
    global _av_key_idx
    _av_key_idx = (_av_key_idx + 1) % len(AV_API_KEYS)
    log.info("[%s] Rotated to AV key slot %d", symbol, _av_key_idx + 1)


def _av_api_call(
    av_ticker:  str,
    time_from:  str,
    time_to:    str,
    api_key:    str,
) -> dict:
    params = {
        "function":   "NEWS_SENTIMENT",
        "tickers":    av_ticker,
        "time_from":  time_from,
        "time_to":    time_to,
        "sort":       "EARLIEST",
        "limit":      "1000",
        "apikey":     api_key,
    }
    resp = requests.get(AV_BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _av_fetch_page_with_rotation(
    symbol:    str,
    av_ticker: str,
    time_from: str,
    time_to:   str,
) -> dict | None:
    tried    = 0
    num_keys = len(AV_API_KEYS)
    while tried < num_keys * 2:
        key = _av_current_key()
        try:
            data = _av_api_call(av_ticker, time_from, time_to, key)
            if _is_av_rate_limited(data):
                log.info(
                    "[%s] AV rate limit on key slot %d — rotating.",
                    symbol, (_av_key_idx % num_keys) + 1,
                )
                _av_rotate_key(symbol)
                tried += 1
                wait = 20 if tried < num_keys else 75
                time.sleep(wait)
                continue
            return data
        except requests.RequestException as exc:
            log.error("[%s] AV request error: %s — retrying in 10s.", symbol, exc)
            time.sleep(10)
            tried += 1

    log.error("[%s] All AV API key slots exhausted for ticker %s.", symbol, av_ticker)
    return None


def _aggregate_av_feed(feed: list[dict], av_ticker: str) -> pd.DataFrame:
    """
    Aggregate AV news feed to a 4-hr window DataFrame with single column va.

    For each 4-hr window (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC):
      - Collect all articles that have a ticker_sentiment entry for av_ticker
      - Sort articles ascending by publication time (earliest first)
      - Take the first _4H_WINDOW_ARTICLES (5) articles in the window
      - Compute relevance-weighted mean of ticker_sentiment_score → va
      - If only 1–4 articles exist, average those; if 0, window is absent
    """
    article_data: list[dict] = []
    for article in feed:
        ts_str = article.get("time_published", "")
        try:
            ts = datetime.strptime(ts_str, "%Y%m%dT%H%M%S").replace(tzinfo=UTC)
        except ValueError:
            continue
        score_val, rel_val = None, None
        for entry in article.get("ticker_sentiment", []):
            if entry.get("ticker") != av_ticker:
                continue
            try:
                score_val = float(entry["ticker_sentiment_score"])
                rel_val   = float(entry["relevance_score"])
            except (KeyError, ValueError):
                continue
            break
        if score_val is None:
            continue
        window_hour = (ts.hour // 4) * 4
        window_ts   = ts.replace(hour=window_hour, minute=0, second=0, microsecond=0)
        article_data.append({
            "window": window_ts,
            "ts":     ts,
            "score":  score_val,
            "rel":    rel_val,
        })

    if not article_data:
        return pd.DataFrame()

    df = pd.DataFrame(article_data)

    def _window_agg(g: pd.DataFrame) -> pd.Series:
        g_sorted  = g.sort_values("ts").head(_4H_WINDOW_ARTICLES)
        rel_sum   = g_sorted["rel"].sum()
        if rel_sum < 1e-8:
            va = float(g_sorted["score"].mean())
        else:
            va = float(
                (g_sorted["score"] * g_sorted["rel"]).sum() / (rel_sum + 1e-8)
            )
        return pd.Series({"va": va})

    result = df.groupby("window").apply(_window_agg)
    result.index.name = "timestamp"
    return result


def fetch_alphavantage_sentiment(symbol: str) -> pd.DataFrame | None:
    """
    Fetch NEWS_SENTIMENT from Alpha Vantage for *symbol* over the pipeline period.

    Pages through results (max 1000 per call) advancing time_from on each page.
    Caches to CSV; returns 4-hr window DataFrame with column va indexed by UTC
    timestamp. Returns None if no data found for this ticker.
    """
    csv_path = _sentiment_csv_path(symbol)
    ckpt     = load_checkpoint(symbol, "sentiment")

    if csv_path.exists() and ckpt.get("complete"):
        log.info("[%s] Loading cached AV sentiment from %s", symbol, csv_path)
        try:
            df = pd.read_csv(csv_path, parse_dates=["timestamp"])
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df.set_index("timestamp", inplace=True)
            if "va" not in df.columns:
                raise ValueError("Cache missing 'va' column")
            return df
        except (pd.errors.ParserError, ValueError, KeyError) as exc:
            log.warning("[%s] Sentiment cache invalid (%s) — re-fetching.", symbol, exc)

    av_ticker = AV_TICKER_MAP.get(symbol, f"CRYPTO:{symbol}")
    log.info("[%s] Fetching AV sentiment for ticker '%s'", symbol, av_ticker)

    time_from = PIPELINE_START.strftime("%Y%m%dT0000")
    time_to   = PIPELINE_END.strftime("%Y%m%dT2359")
    end_dt    = datetime(
        PIPELINE_END.year, PIPELINE_END.month, PIPELINE_END.day, 23, 59, tzinfo=UTC
    )

    all_feed: list[dict] = []
    page = 0

    while True:
        data = _av_fetch_page_with_rotation(symbol, av_ticker, time_from, time_to)
        if data is None:
            break

        feed = data.get("feed", [])
        if not feed:
            break

        all_feed.extend(feed)
        page += 1
        items_returned = int(data.get("items", 0))
        log.info(
            "[%s] AV page %d — %d articles (total so far: %d)",
            symbol, page, items_returned, len(all_feed),
        )

        if items_returned < 1000:
            break

        last_ts_str = feed[-1].get("time_published", "")
        try:
            last_dt = datetime.strptime(last_ts_str, "%Y%m%dT%H%M%S").replace(tzinfo=UTC)
        except ValueError:
            break

        next_dt = last_dt + timedelta(minutes=1)
        if next_dt > end_dt:
            break

        time_from = next_dt.strftime("%Y%m%dT%H%M")
        time.sleep(13)

    if not all_feed:
        log.info("[%s] No AV articles found for ticker %s.", symbol, av_ticker)
        save_checkpoint(symbol, "sentiment", {"complete": False, "rows": 0})
        return None

    df = _aggregate_av_feed(all_feed, av_ticker)

    if df.empty:
        log.info(
            "[%s] AV articles fetched but ticker %s absent in sentiment fields.",
            symbol, av_ticker,
        )
        save_checkpoint(symbol, "sentiment", {"complete": False, "rows": 0})
        return None

    df.sort_index(inplace=True)

    df_out = df.reset_index()
    df_out.columns = ["timestamp", "va"]
    df_out["timestamp"] = df_out["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    df_out.to_csv(csv_path, index=False)
    save_checkpoint(symbol, "sentiment", {"complete": True, "rows": len(df)})
    log.info("[%s] AV sentiment saved → %s  (%d rows)", symbol, csv_path, len(df))
    return df


def _compute_atr_bbw(raw_rows: list[tuple]) -> dict[int, tuple[float, float, float, float]]:
    """
    Compute per-candle ATR and BBW metrics from sorted 1-minute klines.

    ATR_15  = rolling mean of True-Range over _ATR15_WIN  candles
    ATR_60  = rolling mean of True-Range over _ATR60_WIN  candles
    BBW_15  = 4×std / mean  over _BBW15_WIN candles
    BBW_60  = 4×std / mean  over _BBW60_WIN candles

    Normalised ATR = ATR / close price.

    Returns dict  ts_ms → (norm_atr15, norm_atr60, bbw15, bbw60).
    """
    if not raw_rows:
        return {}

    h_arr = np.array([r[2] for r in raw_rows], dtype=np.float64)
    l_arr = np.array([r[3] for r in raw_rows], dtype=np.float64)
    c_arr = np.array([r[4] for r in raw_rows], dtype=np.float64)

    prev_c = np.concatenate([[c_arr[0]], c_arr[:-1]])
    tr = np.maximum(
        h_arr - l_arr,
        np.maximum(np.abs(h_arr - prev_c), np.abs(l_arr - prev_c)),
    )

    tr_s = pd.Series(tr)
    c_s  = pd.Series(c_arr)

    atr15_s = tr_s.rolling(_ATR15_WIN, min_periods=1).mean()
    atr60_s = tr_s.rolling(_ATR60_WIN, min_periods=1).mean()

    safe_c     = c_s.replace(0.0, np.nan)
    norm_atr15 = (atr15_s / safe_c).fillna(0.0)
    norm_atr60 = (atr60_s / safe_c).fillna(0.0)

    roll15 = c_s.rolling(_BBW15_WIN, min_periods=2)
    std15  = roll15.std(ddof=0).fillna(0.0)
    mean15 = roll15.mean().fillna(c_s)
    bbw15  = (4.0 * std15 / mean15.replace(0.0, np.nan)).fillna(0.0)

    roll60 = c_s.rolling(_BBW60_WIN, min_periods=2)
    std60  = roll60.std(ddof=0).fillna(0.0)
    mean60 = roll60.mean().fillna(c_s)
    bbw60  = (4.0 * std60 / mean60.replace(0.0, np.nan)).fillna(0.0)

    result: dict[int, tuple[float, float, float, float]] = {}
    for i, row in enumerate(raw_rows):
        ts_ms = int(row[0])
        result[ts_ms] = (
            float(norm_atr15.iloc[i]),
            float(norm_atr60.iloc[i]),
            float(bbw15.iloc[i]),
            float(bbw60.iloc[i]),
        )
    return result


def _build_4h_maps(sentiment: pd.DataFrame | None) -> dict[int, float]:
    """Convert a sentiment DataFrame to {4hr_window_ms: va} lookup dict."""
    va_map: dict[int, float] = {}
    if sentiment is None or sentiment.empty:
        return va_map

    sent = sentiment.copy()
    if sent.index.tz is None:
        sent.index = sent.index.tz_localize("UTC")

    for ts, row in sent.iterrows():
        ms = int(ts.timestamp() * 1000)
        if pd.notna(row.get("va")):
            va_map[ms] = float(row["va"])

    return va_map


def merge_sentiment(
    records:       list[dict],
    sentiment:     pd.DataFrame | None,
    btc_sentiment: pd.DataFrame | None = None,
    atr_bbw_map:   dict[int, tuple[float, float, float, float]] | None = None,
) -> list[dict]:
    """
    Join 4-hr window sentiment onto each 1-minute price record as single field va.

    Fallback chain (applied per record):
      1. Coin-specific AV score for that 4-hr UTC window
      2. BTC AV score × BTC_PENALTY for that 4-hr UTC window
      3. Synthetic:  va = sign(ΔC) × norm_ATR_15min
    """
    va_map     = _build_4h_maps(sentiment)
    btc_va_map = _build_4h_maps(btc_sentiment)

    prev_c: float | None = None
    for r in records:
        h4 = (r["ts_ms"] // BUCKET_4H_MS) * BUCKET_4H_MS

        va = va_map.get(h4)
        if va is not None:
            r["va"] = va
            prev_c  = r["c"]
            continue

        btc_va = btc_va_map.get(h4)
        if btc_va is not None:
            r["va"] = btc_va * BTC_PENALTY
            prev_c  = r["c"]
            continue

        curr_c = r["c"]
        if atr_bbw_map:
            metrics    = atr_bbw_map.get(r["ts_ms"], (0.0, 0.0, 0.0, 0.0))
            norm_atr15 = metrics[0]
        else:
            norm_atr15 = 0.0

        if prev_c is not None and curr_c != prev_c:
            direction = 1.0 if curr_c > prev_c else -1.0
        else:
            direction = 0.0

        r["va"] = direction * norm_atr15
        prev_c  = curr_c

    return records


def _build_pytrends() -> TrendReq:
    return TrendReq(
        hl="en-US",
        tz=360,
        timeout=(15, 15),
        requests_args={"proxies": PROXIES},
    )


def generate_2day_windows(start: date, end: date) -> list[tuple[date, date]]:
    days = day_range(start, end)
    return [(days[i], days[i + 1]) for i in range(len(days) - 1)]


def _fetch_pytrends_window(
    keyword:   str,
    win_start: date,
    win_end:   date,
    symbol:    str,
) -> pd.Series:
    tf      = f"{win_start:%Y-%m-%d} {win_end:%Y-%m-%d}"
    attempt = 0

    while True:
        attempt += 1
        pt = _build_pytrends()
        try:
            pt.build_payload([keyword], timeframe=tf)
            df = pt.interest_over_time()

            if df.empty or keyword not in df.columns:
                raise ValueError(f"Empty dataframe or keyword '{keyword}' missing")

            s = df[keyword].copy()
            s.index = pd.to_datetime(s.index, utc=True)

            if s.empty:
                raise ValueError("Series is empty after extraction")

            log.info(
                "[%s] Trends window %s — OK on attempt %d  (%d points)",
                symbol, tf, attempt, len(s),
            )
            return s

        except Exception as exc:
            backoff = min(
                TRENDS_BACKOFF_MAX,
                TRENDS_BACKOFF_BASE * (2 ** (attempt - 1)),
            )
            jitter  = random.uniform(5, 20)
            wait    = backoff + jitter

            log.warning(
                "[%s] Trends window %s — attempt %d failed: %s. "
                "Rebuilding session and retrying in %.0fs …",
                symbol, tf, attempt, exc, wait,
            )
            time.sleep(wait)


def stitch_trends(windows_data: list[pd.Series]) -> pd.Series:
    if not windows_data:
        return pd.Series(dtype=float)
    stitched = windows_data[0].copy().astype(float)
    for curr_raw in windows_data[1:]:
        curr = curr_raw.copy().astype(float)
        overlap = stitched.index.intersection(curr.index)
        if len(overlap) == 0:
            stitched = pd.concat([stitched, curr[~curr.index.isin(stitched.index)]])
            continue
        med_c = curr.loc[overlap].median()
        med_p = stitched.loc[overlap].median()
        scale = (med_p / med_c) if med_c != 0 else 1.0
        curr *= scale
        stitched = pd.concat([stitched, curr.loc[curr.index.difference(stitched.index)]])
    stitched.sort_index(inplace=True)
    return stitched


def _apply_zscore(hourly: pd.Series) -> pd.Series:
    roll  = hourly.rolling(window=ZSCORE_WINDOW, min_periods=ZSCORE_MIN_PERIODS)
    mean_ = roll.mean()
    std_  = roll.std(ddof=0)
    z     = (hourly - mean_) / (std_ + ZSCORE_EPSILON)

    log.info(
        "[trends] Z-score — points=%d  zeros=%d  range=[%.3f, %.3f]  "
        "mean=%.4f  std=%.4f",
        len(z), (z == 0.0).sum(), z.min(), z.max(), z.mean(), z.std(),
    )
    return z


def _resample_30min(hourly_z: pd.Series) -> pd.Series:
    if hourly_z.empty:
        return pd.Series(dtype=float)

    start  = hourly_z.index.min().floor("h")
    end    = hourly_z.index.max().ceil("h")
    idx_30 = pd.date_range(start=start, end=end, freq="30min", tz="UTC")

    s30 = hourly_z.reindex(idx_30).ffill()
    log.info(
        "[trends] 30-min series — points=%d  nulls=%d",
        len(s30), s30.isna().sum(),
    )
    return s30


def _save_trends_csv(symbol: str, hourly_raw: pd.Series, z30: pd.Series) -> None:
    csv_raw = TRENDS_DIR / f"{symbol}_trends.csv"
    df_raw  = hourly_raw.reset_index()
    df_raw.columns = ["timestamp", "trend"]
    df_raw["coin"]      = symbol
    df_raw["timestamp"] = df_raw["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    df_raw.to_csv(csv_raw, index=False)

    csv_z30 = TRENDS_DIR / f"{symbol}_trends_z30.csv"
    df_z30  = z30.reset_index()
    df_z30.columns = ["timestamp", "t_z"]
    df_z30["coin"]      = symbol
    df_z30["timestamp"] = df_z30["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    df_z30.to_csv(csv_z30, index=False)

    log.info(
        "[%s] Trends saved — raw=%d rows → %s | z30=%d rows → %s",
        symbol, len(df_raw), csv_raw, len(df_z30), csv_z30,
    )


def fetch_trends_hourly(symbol: str) -> pd.Series:
    keyword = TREND_KEYWORDS[symbol]
    ckpt    = load_checkpoint(symbol, "trends")

    last_done_str = ckpt.get("last_completed_date")
    last_done     = date.fromisoformat(last_done_str) if last_done_str else None

    windows = generate_2day_windows(PIPELINE_START, PIPELINE_END)

    csv_raw = TRENDS_DIR / f"{symbol}_trends.csv"
    if csv_raw.exists():
        existing = pd.read_csv(csv_raw, parse_dates=["timestamp"])
        existing["timestamp"] = pd.to_datetime(existing["timestamp"], utc=True)
        existing.set_index("timestamp", inplace=True)
        collected: list[pd.Series] = [existing["trend"]]
        log.info("[%s] Loaded %d existing raw trend rows", symbol, len(existing))
    else:
        collected: list[pd.Series] = []

    if last_done:
        windows = [(ws, we) for ws, we in windows if we > last_done]
        if windows:
            log.info("[%s] Trends resuming from window %s", symbol, windows[0][0])
        else:
            log.info("[%s] Trends fully cached — skipping fetch.", symbol)

    for i, (ws, we) in enumerate(
        tqdm.tqdm(windows, desc=f"[{symbol}] Trends", unit="win")
    ):
        series = _fetch_pytrends_window(keyword, ws, we, symbol)
        collected.append(series)
        save_checkpoint(symbol, "trends", {
            "last_completed_date": we.isoformat(),
            "windows_done": i + 1,
        })

        time.sleep(random.uniform(3, 7))

        if (i + 1) % 30 == 0:
            tmp_stitched = stitch_trends(collected)
            df_tmp = tmp_stitched.reset_index()
            df_tmp.columns = ["timestamp", "trend"]
            df_tmp["coin"] = symbol
            df_tmp["timestamp"] = df_tmp["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
            df_tmp.to_csv(csv_raw, index=False)
            log.info("[%s] Intermediate raw trends save (%d rows)", symbol, len(df_tmp))

    if not collected:
        log.warning("[%s] No trend data collected at all.", symbol)
        return pd.Series(dtype=float)

    hourly_raw = stitch_trends(collected)
    hourly_z   = _apply_zscore(hourly_raw)
    z30        = _resample_30min(hourly_z)

    _save_trends_csv(symbol, hourly_raw, z30)
    return z30


def load_trends_csv(symbol: str) -> pd.Series:
    csv_z30 = TRENDS_DIR / f"{symbol}_trends_z30.csv"
    if csv_z30.exists():
        df = pd.read_csv(csv_z30, parse_dates=["timestamp"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df.set_index("timestamp", inplace=True)
        log.info("[%s] Loaded z30 trends from %s (%d rows)", symbol, csv_z30, len(df))
        return df["t_z"]

    csv_raw = TRENDS_DIR / f"{symbol}_trends.csv"
    if csv_raw.exists():
        log.warning("[%s] z30 CSV missing — recomputing from raw %s", symbol, csv_raw)
        df = pd.read_csv(csv_raw, parse_dates=["timestamp"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df.set_index("timestamp", inplace=True)
        hourly_raw = df["trend"]
        hourly_z   = _apply_zscore(hourly_raw)
        z30        = _resample_30min(hourly_z)
        _save_trends_csv(symbol, hourly_raw, z30)
        return z30

    log.warning("[%s] No trends CSV found — 't' field will be null.", symbol)
    return pd.Series(dtype=float)


def merge_trends(records: list[dict], trends: pd.Series) -> list[dict]:
    if trends is None or trends.empty:
        for r in records:
            r["t"] = None
        return records

    t_utc = trends.copy()
    if t_utc.index.tz is None:
        t_utc.index = t_utc.index.tz_localize("UTC")

    trend_map: dict[int, float | None] = {}
    for ts, val in t_utc.items():
        bms = int(ts.timestamp() * 1000)
        bms = (bms // BUCKET_30MIN_MS) * BUCKET_30MIN_MS
        trend_map[bms] = float(val) if pd.notna(val) else None

    for r in records:
        bucket = (r["ts_ms"] // BUCKET_30MIN_MS) * BUCKET_30MIN_MS
        r["t"] = trend_map.get(bucket)

    mapped = sum(1 for r in records if r["t"] is not None)
    total  = len(records)
    log.info(
        "[trends] merge — %d / %d records got t  (%.1f%%)",
        mapped, total, 100 * mapped / total if total else 0,
    )
    return records


def write_daily_csv(symbol: str, enriched: list[dict]) -> list[Path]:
    buckets: dict[str, list[dict]] = {}
    for r in enriched:
        buckets.setdefault(_day_key(r["ts_ms"]), []).append(r)

    written: list[Path] = []
    sym_dir = OUTPUT_DIR / symbol
    sym_dir.mkdir(exist_ok=True)

    fieldnames = [
        "time", "s", "E", "c", "o", "h", "l", "v",
        "t", "va", "atr15", "atr60", "bbw15", "bbw60",
    ]

    for day_str, rows in buckets.items():
        payload = [
            {
                "time":  _fmt_ist(r["ts_ms"]),
                "s":     symbol,
                "E":     r["ts_ms"],
                "c":     round(r["c"],    8),
                "o":     round(r["o"],    8),
                "h":     round(r["h"],    8),
                "l":     round(r["l"],    8),
                "v":     round(r["v"],    8),
                "t":     r.get("t"),
                "va":    r.get("va"),
                "atr15": round(r.get("atr15", 0.0), 8),
                "atr60": round(r.get("atr60", 0.0), 8),
                "bbw15": round(r.get("bbw15", 0.0), 8),
                "bbw60": round(r.get("bbw60", 0.0), 8),
            }
            for r in rows
        ]
        payload.sort(key=lambda x: x["E"])

        year, month, day = day_str.split("-")
        fname = f"{symbol}-{year}-{month}-{day}.csv"
        fpath = sym_dir / fname
        with open(fpath, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(payload)
        written.append(fpath)
        log.debug("[%s] %s — %d records", symbol, fname, len(payload))

    log.info("[%s] Wrote %d daily CSV files.", symbol, len(written))
    return written


def _s3_key(symbol: str, json_path: Path) -> str:
    m = re.match(r"(\w+)-(\d{4})-(\d{2})-(\d{2})\.json", json_path.name)
    if not m:
        raise ValueError(f"Cannot parse filename: {json_path.name}")
    _, year, month, day = m.groups()
    return (
        f"{S3_PREFIX}"
        f"/symbol={symbol}"
        f"/year={year}"
        f"/month={month}"
        f"/day={day}"
        f"/{json_path.name}"
    )


def upload_to_s3(symbol: str, json_paths: list[Path], s3_client=None) -> int:
    if s3_client is None:
        s3_client = boto3.client(
            "s3",
            config=BotoConfig(retries={"max_attempts": 5, "mode": "adaptive"}),
        )

    uploaded = 0
    for path in tqdm.tqdm(json_paths, desc=f"[{symbol}] S3 upload", unit="file"):
        key = _s3_key(symbol, path)
        try:
            s3_client.head_object(Bucket=S3_BUCKET, Key=key)
            log.debug("[%s] Exists in S3, skipping: %s", symbol, key)
            continue
        except ClientError as e:
            if e.response["Error"]["Code"] != "404":
                log.error("[%s] head_object error: %s", symbol, e)
                continue

        try:
            def _put(p=path, k=key):
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=k,
                    Body=p.read_bytes(),
                    ContentType="application/json",
                )
            retry(_put, attempts=4, base_delay=2.0, exceptions=(ClientError, Exception))
            uploaded += 1
        except Exception as exc:
            log.error("[%s] S3 upload failed for %s: %s", symbol, path.name, exc)

    log.info("[%s] Uploaded %d / %d files to S3.", symbol, uploaded, len(json_paths))
    return uploaded


def process_data(
    symbol:        str,
    trends:        pd.Series,
    sentiment:     pd.DataFrame | None,
    btc_sentiment: pd.DataFrame | None,
    s3_client,
) -> dict:
    log.info("[%s] ══════ Starting Binance pipeline ══════", symbol)
    zip_paths = download_data(symbol)

    all_written: list[Path] = []
    total_records = 0

    for zip_path in tqdm.tqdm(zip_paths, desc=f"[{symbol}] Months", unit="mo"):
        csv_path = extract_zip(zip_path)
        if csv_path is None:
            continue

        raw_rows = list(_iter_klines(csv_path))
        if not raw_rows:
            log.warning("[%s] No rows in %s — skipping.", symbol, csv_path.name)
            continue

        raw_rows.sort(key=lambda r: r[0])

        atr_bbw_map = _compute_atr_bbw(raw_rows)

        enriched = compute_rolling_metrics(raw_rows)
        enriched = merge_trends(enriched, trends)
        enriched = merge_sentiment(enriched, sentiment, btc_sentiment, atr_bbw_map)

        for r in enriched:
            metrics       = atr_bbw_map.get(r["ts_ms"], (0.0, 0.0, 0.0, 0.0))
            r["atr15"]    = metrics[0]
            r["atr60"]    = metrics[1]
            r["bbw15"]    = metrics[2]
            r["bbw60"]    = metrics[3]

        written = write_daily_csv(symbol, enriched)
        all_written.extend(written)
        total_records += len(enriched)

        log.info(
            "[%s] %s → %d records, %d daily files",
            symbol, csv_path.stem, len(enriched), len(written),
        )

    uploaded = 0  # S3 upload replaced with local CSV save — see write_daily_csv above

    return {
        "symbol":        symbol,
        "total_records": total_records,
        "daily_files":   len(all_written),
        "s3_uploaded":   uploaded,
    }


def _load_sentiment_csv(symbol: str) -> pd.DataFrame | None:
    csv_path = _sentiment_csv_path(symbol)
    if not csv_path.exists():
        return None
    try:
        df = pd.read_csv(csv_path, parse_dates=["timestamp"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df.set_index("timestamp", inplace=True)
        if "va" not in df.columns:
            return None
        return df
    except Exception:
        return None


def run_pipeline(
    symbols:          list[str] | None = None,
    skip_trends:      bool = False,
    skip_sentiment:   bool = False,
    skip_binance:     bool = False,
    parallel:         bool = True,
) -> None:
    symbols = symbols or list(SYMBOL_MAP.keys())
    log.info("═══════════════════════════════════════")
    log.info("  Pipeline v6 — symbols: %s", symbols)
    log.info("  Period: %s → %s", PIPELINE_START, PIPELINE_END)
    log.info("  Trends: infinite blocking retry per window")
    log.info("  Trends: 30-min z-score (ddof=0, window=%dh, ε=%.0e)",
             ZSCORE_WINDOW, ZSCORE_EPSILON)
    log.info("  Sentiment: Alpha Vantage NEWS_SENTIMENT  (%d keys)", len(AV_API_KEYS))
    log.info("  Sentiment: 4-hr windows, top-%d articles, single va field",
             _4H_WINDOW_ARTICLES)
    log.info("  Sentiment fallback: BTC proxy (×%.1f) → ATR synthetic", BTC_PENALTY)
    log.info("  Output fields: va, atr15, atr60, bbw15, bbw60")
    log.info("═══════════════════════════════════════")

    sentiment_data:   dict[str, pd.DataFrame | None] = {}
    btc_sentiment_df: pd.DataFrame | None = None

    if not skip_sentiment:
        log.info("[BTC] ── Fetching BTC sentiment for proxy fallback ──")
        btc_sentiment_df = fetch_alphavantage_sentiment("BTC")
        time.sleep(2)

        for sym in symbols:
            log.info("[%s] ── AV sentiment fetch ──", sym)
            sentiment_data[sym] = fetch_alphavantage_sentiment(sym)
            time.sleep(2)
    else:
        btc_sentiment_df = _load_sentiment_csv("BTC")
        if btc_sentiment_df is None:
            log.info("[BTC] No valid cached BTC sentiment — proxy unavailable.")

        for sym in symbols:
            df = _load_sentiment_csv(sym)
            if df is not None:
                log.info("[%s] Loading cached AV sentiment CSV.", sym)
                sentiment_data[sym] = df
            else:
                log.info(
                    "[%s] No AV sentiment cache — BTC proxy / ATR synthetic fallback active.",
                    sym,
                )
                sentiment_data[sym] = None

    trends_data: dict[str, pd.Series] = {}
    if not skip_trends:
        for sym in symbols:
            log.info("[%s] ── Google Trends fetch ──", sym)
            trends_data[sym] = fetch_trends_hourly(sym)
    else:
        for sym in symbols:
            trends_data[sym] = load_trends_csv(sym)

    if skip_binance:
        log.info("Skipping Binance processing (--skip-binance).")
        return

    s3_client = boto3.client(
        "s3",
        config=BotoConfig(retries={"max_attempts": 5, "mode": "adaptive"}),
    )
    stats: list[dict] = []

    if parallel and len(symbols) > 1:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {
                pool.submit(
                    process_data,
                    sym,
                    trends_data.get(sym, pd.Series(dtype=float)),
                    sentiment_data.get(sym),
                    btc_sentiment_df,
                    s3_client,
                ): sym
                for sym in symbols
            }
            for fut in tqdm.tqdm(as_completed(futures), total=len(futures),
                                 desc="Overall"):
                sym = futures[fut]
                try:
                    result = fut.result()
                    stats.append(result)
                    log.info("[%s] ✓ Done — %s", sym, result)
                except Exception as exc:
                    log.error("[%s] Pipeline crashed: %s", sym, exc, exc_info=True)
    else:
        for sym in symbols:
            try:
                result = process_data(
                    sym,
                    trends_data.get(sym, pd.Series(dtype=float)),
                    sentiment_data.get(sym),
                    btc_sentiment_df,
                    s3_client,
                )
                stats.append(result)
            except Exception as exc:
                log.error("[%s] Pipeline crashed: %s", sym, exc, exc_info=True)

    log.info("═══════════════════════════════════════")
    log.info("  Pipeline complete")
    for s in stats:
        log.info(
            "  %-4s  records=%-8d  daily_files=%-5d  s3_uploaded=%d",
            s["symbol"], s["total_records"], s["daily_files"], s["s3_uploaded"],
        )
    log.info("═══════════════════════════════════════")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Crypto data pipeline v6")
    parser.add_argument(
        "--symbols", nargs="+", choices=list(SYMBOL_MAP.keys()),
        help="Symbols to process (default: all)",
    )
    parser.add_argument(
        "--skip-trends", action="store_true",
        help="Load cached z30 trends CSV instead of re-fetching",
    )
    parser.add_argument(
        "--skip-sentiment", action="store_true",
        help="Load cached AV sentiment CSV instead of re-fetching",
    )
    parser.add_argument(
        "--skip-binance", action="store_true",
        help="Skip Binance download and processing entirely",
    )
    parser.add_argument(
        "--no-parallel", action="store_true",
        help="Process symbols sequentially (useful for debugging)",
    )
    args = parser.parse_args()

    run_pipeline(
        symbols        = args.symbols,
        skip_trends    = args.skip_trends,
        skip_sentiment = args.skip_sentiment,
        skip_binance   = args.skip_binance,
        parallel       = not args.no_parallel,
    )