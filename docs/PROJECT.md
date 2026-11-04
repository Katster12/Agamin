# Agamin: project documentation

This document is based only on the code, logs, metrics files and `summary.json` files in this
repository, as they were on the Oracle VM (`/home/ubuntu/crypto`) when backed up on 29 Oct 2026.
Where something cannot be determined from those files, it is marked **unknown**.
No secret values are repeated in this document. They are hardcoded in `crypto_pipeline.py`, which is committed
unchanged from the VM; see §7.2. Keep the repository private.

> **Status:** research only. Every model fell short of its own accuracy target (see
> [Results](#6-results)). Nothing here is fit for trading, and the repo contains no exchange or order code.

---

## 1. Description and goals

Agamin has two parts:

1. **Data pipeline** (`crypto_pipeline.py`, "Pipeline v6"). It builds a 1-minute dataset for 10 large-cap coins by
   combining:
   - Binance spot prices;
   - Alpha Vantage news sentiment;
   - Google Trends search interest;
   - volatility features (ATR, Bollinger Band width).
2. **Models**. These are small PyTorch BiLSTM experiments that try to predict short-horizon price moves from that dataset.

The goals below are written into the code itself:

| Experiment | Goal (from code) |
|---|---|
| `grok_edit_v1` | Directional calls on BTC 30 minutes ahead with **>= 75% precision** on at least 50 test calls, and the same on non-overlapping calls (`reached_75`). |
| `grok_study_v3` | **>= 70% sign accuracy** of the predicted next-step return per coin and horizon (`reached_70`). |

## 2. Architecture

```mermaid
flowchart LR
    subgraph Sources
        B["Binance data.binance.vision<br/>monthly 1m klines (zip)"]
        AV["Alpha Vantage<br/>NEWS_SENTIMENT (key rotation)"]
        GT["Google Trends (pytrends)<br/>via Webshare proxy"]
    end
    B --> P["crypto_pipeline.py<br/>Pipeline v6"]
    AV --> P
    GT --> P
    P --> F["Features per 1m bar<br/>rolling 24h OHLCV, ATR15/60,<br/>BBW15/60, va sentiment, t trends z-score"]
    F --> D["cache/output/COIN/COIN-YYYY-MM-DD.csv<br/>daily CSVs (IST)"]
    D --> E1["grok_edit_v1<br/>BTC, BiLSTM + attention, 3-class + band"]
    D --> S3["grok_study_v3<br/>10 coins x 30min/12h/24h BiLSTM regressor"]
    S3 --> BV2["grok_study_best_v2<br/>best coin per horizon (copies)"]
    E1 --> M["model.pt + scaler.npz"]
    S3 --> M
    BV2 --> M
    M --> R["test_predictions.csv + metrics.json"]
```

The pipeline also contains an optional S3 upload path (boto3), but it is switched off in the code (see §8).

## 3. Scripts

| Script | What it does |
|---|---|
| `crypto_pipeline.py` | Downloads or caches the Binance monthly 1m klines. Fetches AV news sentiment and Google Trends (both checkpointed and resumable). Computes the rolling features, merges everything per minute, and writes one CSV per coin per day to `cache/output/<COIN>/`. Logs to `pipeline.log` (rotating, 20 MB x 5). |
| `grok_edit_v1/grok_edit_v1.py` | BTC only. Resamples to 5-minute bars and builds 29 technical features. Trains a BiLSTM with temporal attention that outputs a 3-class direction (down/flat/up) and a 20-80% quantile band for the 30-minute move. Picks a confidence threshold on validation and writes `model.pt`, `scaler.npz`, `metrics.json`, `test_predictions.csv` and `train.log`. Supports `SMOKE=1` for a quick test run. |
| `grok_study_v3/grok_study_v3.py` | For each coin in `COINS` (env var, default `BTC,ETH,SOL`) and each horizon preset (30min / 12h / 24h), trains a small BiLSTM regressor of the next-step % return. Writes `<COIN>/<horizon>/{model.pt, scaler.npz, metrics.json, test_predictions.csv}`. Supports `SMOKE=1`. |
| `grok_study_best_v2/grok_study_v3.py` | Byte-identical copy of `grok_study_v3/grok_study_v3.py`. |
| `grok_study_best_v2/summary.json` | Lists the best coin per horizon. Each `model.pt` under `grok_study_best_v2/<horizon>/` is byte-identical to the matching `grok_study_v3` model. **How this folder was produced is unknown**; no script or log for it exists. |

## 4. Data

### 4.1 Sources and coverage

| Item | Value (from code / logs / files) |
|---|---|
| Coins (`SYMBOL_MAP`) | BTC, ETH, BNB, XRP, SOL, DOGE, TRX, ADA, AVAX, LINK (each vs USDT) |
| Pipeline period | `PIPELINE_START` 2025-05-01 to `PIPELINE_END` 2026-03-28 |
| Binance zips (`cache/zips/`) | 99 files = 9 coins (no BTC) x 11 months (2025-05 to 2026-03), `<PAIR>-1m-YYYY-MM.zip`. Because downloads are by month, prices run to **2026-03-31**. |
| Last pipeline run | `pipeline.log` (the same content as `run.out`): 2026-10-05 09:28 to 2026-10-06 22:38 UTC (VM clock), i.e. 5 Oct 14:58 to 7 Oct 04:08 IST. Symbols: ETH BNB XRP SOL DOGE TRX ADA AVAX LINK (no BTC). The exact command line is **unknown**; `run.out` starts with `nohup: ignoring input`. |
| Output per coin (9 coins) | 482,400 rows and 335 daily files each (2025-05-01 to 2026-03-31 = 335 days x 1,440 minutes) |
| BTC | `cache/output/BTC/BTC.csv`: one file with 413,919 rows, 01-05-2025 05:30 to 12-02-2026 16:08 (IST). It was **not** produced by the logged run. **Its origin is unknown**; `grok_edit_v1.py` comments mention an original `main.ipynb` / `data/BTC.csv` that is not on the VM. |

### 4.2 Daily CSV schema (`cache/output/<COIN>/<COIN>-YYYY-MM-DD.csv`)

Header: `time,s,E,c,o,h,l,v,t,va,atr15,atr60,bbw15,bbw60`. One row per 1-minute Binance candle.

| Column | Meaning (from `crypto_pipeline.py`) |
|---|---|
| `time` | Candle open time in IST, `YYYY-MM-DD HH:MM:SS`. Daily files are split by IST day. |
| `s` | Coin symbol |
| `E` | Candle open time, ms since epoch (UTC) |
| `c` | Close of this 1-minute candle |
| `o`, `h`, `l`, `v` | **Rolling 24-hour values, not this candle's values.** `RollingOHLCV` with `ROLLING_WINDOW = 1440` gives the open at the start of the window, the max high, the min low and the summed volume over the last 1,440 one-minute candles. |
| `t` | Google Trends z-score for the coin (see §4.3), mapped to the 30-minute bucket |
| `va` | News sentiment (see §4.4) |
| `atr15`, `atr60` | Mean true range over the last 15 / 60 one-minute candles, divided by close |
| `bbw15`, `bbw60` | Bollinger width `4*std/mean` of close over 300 / 1,200 one-minute candles |

`BTC.csv` has the same 14 columns but a different format:
- `time` is `dd-mm-yyyy HH:MM`;
- `E` is stored in scientific notation (`1.75E+12`), so it has lost precision;
- `t` is 0 in the sampled rows;
- in at least one sampled row, `c` lies below `l`.

Treat it as a separately produced file.

### 4.3 Google Trends (`cache/trends/`)

- Fetched with pytrends through the proxy hardcoded in `PROXY_URL`, in 2-day windows (331 windows per coin), with retry and exponential backoff. The log has 1,970 WARNING lines, almost all of them retried Google errors.
- Windows are stitched by scaling on the median of their overlap. A rolling z-score follows (168 points, `ddof=0`, eps 1e-8), then the series is resampled to 30 minutes with forward-fill.
- Files:
  - `<COIN>_trends.csv` (`timestamp,trend,coin`): **332 rows per coin, roughly one value per day**, although the code calls the series "hourly";
  - `<COIN>_trends_z30.csv` (`timestamp,t_z,coin`): 15,889 rows, 2025-05-01 to 2026-03-28.
- The 9 coins in the run have trends. BTC has none.
- In the run, 100% of records received a `t` value.

### 4.4 Alpha Vantage sentiment (`cache/sentiment/`)

- `NEWS_SENTIMENT` is queried with key rotation over the hardcoded `AV_API_KEYS` list, up to 1,000 items per page with a 13 s sleep.
- For each 4-hour UTC window, the first 5 articles are taken and their `ticker_sentiment_score` is averaged, weighted by relevance. The result is stored as `<COIN>_sentiment.csv` (`timestamp,va`).
- Coverage is sparse and uneven:

| Coin | Rows | First -> last window |
|---|---|---|
| ADA | 533 | 2025-05-01 -> 2026-03-27 |
| BNB | 527 | 2025-05-01 -> 2026-03-22 |
| LINK | 404 | 2025-05-01 -> 2026-03-27 |
| XRP | 282 | 2025-05-01 -> 2025-07-24 |
| DOGE | 268 | 2025-05-01 -> 2025-07-13 |
| SOL | 217 | 2025-05-01 -> 2026-03-13 |
| ETH | 140 | 2025-05-01 -> 2025-05-26 |
| TRX | 104 | 2025-05-01 -> 2026-03-26 |
| BTC | 72 | 2025-05-01 -> 2025-05-13 |
| AVAX | 71 | 2025-05-02 -> 2026-03-11 |

- `va` uses a fallback chain:
  1. the coin's own AV score for the window;
  2. otherwise the BTC score x 0.7 (`BTC_PENALTY`);
  3. otherwise a **synthetic** value, `sign(close change) x atr15`.

  Most minutes therefore carry the BTC proxy or the synthetic value. `grok_study_v3` detects the synthetic values and zeroes them (`va_news`). The BTC-proxy values are kept.

### 4.5 Unzipped klines

The pipeline extracts each zip next to itself (`cache/zips/<PAIR>-1m-YYYY-MM.csv`, columns as in the Binance kline format) when it needs to, and reuses an existing CSV. All 99 CSVs are committed as on the VM (632,416,348 bytes); they are byte-identical to the zip contents.

### 4.6 What is not in the repository

Only `venv/` and `grok_edit_v1/venv/` are missing (recreate from `requirements-*.txt`). `cache/output.zip` (172.6 MB, over GitHub's 100 MB per-file git limit; a duplicate of `cache/output/`) is not in git but is attached unchanged to the GitHub Release `data-2026-10-29` (`gh release download data-2026-10-29 -R warrior123-coder/agamin -D cache`). Every other file is the unmodified VM original.

## 5. Models

### 5.1 `grok_edit_v1` (BTC, 30-minute direction + range)

| Setting | Value (`CFG` in `grok_edit_v1.py`) |
|---|---|
| Data | `cache/output/BTC` (`BTC.csv`), last `days=270` days, resampled to 5-minute bars |
| Input | `seq_len=48` bars (4 h) x 29 features, StandardScaler fitted on train |
| Features | `ret_1, ret_3, ret_6, ret_12, ret_24, momentum_12, rsi_14, macd, macd_signal, macd_hist, bb_width, bb_pos, atr_norm, atr_z, obv_zscore, vol_zscore, vwap_dev, ema_cross, body, upper_wick, lower_wick, body_signed, stoch_k, cci_20, fake_up, fake_dn, efficiency, hour_sin, hour_cos` |
| Target | 30-minute-ahead return (`horizon=6` bars), labelled down / flat / up at `min_move=0.40%`, plus 20% / 80% quantiles (`q_lo`, `q_hi`) |
| Network | `BiLSTMRange`: 2-layer bidirectional LSTM (hidden 64, dropout 0.35) -> temporal attention -> LayerNorm -> Linear(64) + GELU + Dropout -> 3-class head + band head (low, width); 156,934 parameters |
| Loss / optimiser | Class-weighted cross-entropy + pinball (quantile) loss; AdamW (lr 1e-3, weight decay 1e-4), OneCycleLR, batch 128 |
| Training | Up to 24 epochs, early stopping with patience 6, seed 42, CPU |
| Split | Chronological 70 / 15 / 15 train / val / test with an embargo between splits |
| Calling rule | Call up/down when the class probability >= `p_star`. `p_star` is picked on validation from {0.40, 0.45, ..., 0.75} as the highest-precision value with >= 40 calls; the chosen value was **0.50**. |
| Baselines | Majority class, momentum (sign of last return), mean-reversion (opposite sign) |

**Caveat (from the data semantics in §4.2):** if `BTC.csv` follows the pipeline schema, its `o/h/l/v` columns are rolling 24-hour values. In that case features built from `h`, `l`, `o` and `v` (wicks, body, ATR, VWAP, OBV, fake-breakout flags) describe 24-hour ranges, not 5-minute candles. It may also be related to `fake_breakout_share_of_missed_up = 1.0` in the metrics: every missed up-move "touched +0.40% and closed back below", which is what you would expect if `h` is a 24-hour high. This has **not been verified**.

### 5.2 `grok_study_v3` (10 coins x 3 horizons, return regression)

| Setting | Value (`grok_study_v3.py`) |
|---|---|
| Data | `cache/output/<COIN>/*.csv`; uses only `time, c, atr15, atr60, t, va` |
| Features (11) | `ret_{step}`, `ret_{4*step}`, `ret_{24*step}`, `ret_10080` (7-day), `atr15`, `atr60`, `atr_ratio`, `t`, `va_news` (synthetic `va` set to 0), `hour_sin`, `hour_cos`; StandardScaler fitted on train |
| Target | Next-step return in % over `step` minutes |
| Presets | 30min: step 30, train 203 days, seq_len 16, min test 1,000 windows. 12h: step 720, train 210 days, seq_len 14, min test 80. 24h: step 1,440, train 210 days, seq_len 10, min test 40. |
| Network | 1-layer bidirectional LSTM (hidden 32) -> Linear(64->32) + GELU + Dropout 0.3 -> Linear(1); no attention |
| Loss / optimiser | Smooth L1; AdamW (lr 1e-3, weight decay 1e-3); 6 epochs; batch 128; CPU |
| Split | First `train_days` of data = train, the rest = test. No validation set, no early stopping and no gap between train and test. |
| Metric | Test sign accuracy (`test_sign`) and MAE in % |
| Baselines | **None computed** in this script |

## 6. Results

### 6.1 `grok_edit_v1` (BTC, `grok_edit_v1/metrics.json` + `train.log`)

Data:
- 77,455 five-minute rows, from 2025-05-19 17:05 to 2026-02-12 15:35.
- Windows: train 54,165, val 11,565, test 11,572.
- Train class counts (down / flat / up): 2,946 / 48,359 / 2,860.

Training stopped early after 8 epochs (`epochs_ran`). The best validation loss was 1.1246, at epoch 2 (per `train.log`).

| Metric (test) | Value | Target / comparison |
|---|---|---|
| Gated calls (n) | 794 (557 up, 237 down) | >= 50 |
| Precision of gated calls | **26.2%** | target 75%: **not met** |
| Non-overlapping calls / precision | 146 / 25.3% | target 75%: **not met** |
| Ungated sign accuracy on large moves (n = 2,250) | 51.1% | baselines: majority 53.2%, momentum 48.9%, revert 51.5% |
| Test base rates | up 9.1%, down 10.3% | |
| Price inside predicted 20-80% band | 46.9% (nominal 60%) | `band_coverage_all_test` 60.1% |
| Mean band width | 0.713% | |
| `fake_breakout_share_of_missed_up` | 1.0 | see caveat §5.1 |
| `reached_75` | **false** | |

Fees and slippage are not included (`fees_included: false`). The script's own notes in `metrics.json` say:
- "CONTINUE. Held-out precision is under 75%..."
- "Before the confidence gate, direction is within 2 points of the best baseline. The gate is not creating an edge by itself."

### 6.2 `grok_study_v3` (all 10 coins, `grok_study_v3/<COIN>/<horizon>/metrics.json`)

Target: sign accuracy >= 70% (`reached_70`). A coin-flip reference is 50%; no other baseline was computed.
BTC has shorter test spans because `BTC.csv` ends on 2026-02-12.

| Coin | Horizon | Train days | Test days | Test windows | Sign accuracy | MAE (%) | Target (>=70%) |
|---|---|---|---|---|---|---|---|
| ADA | 30min | 202.7 | 125.0 | 5999 | 52.6% | 0.388 | not met |
| ADA | 12h | 203.0 | 112.0 | 225 | 45.8% | 2.018 | not met |
| ADA | 24h | 200.0 | 99.0 | 100 | 47.0% | 3.235 | not met |
| AVAX | 30min | 202.7 | 125.0 | 5999 | 49.8% | 0.355 | not met |
| AVAX | 12h | 203.0 | 112.0 | 225 | 55.1% | 1.774 | not met |
| AVAX | 24h | 200.0 | 99.0 | 100 | 41.0% | 2.765 | not met |
| BNB | 30min | 202.7 | 125.0 | 5999 | 51.4% | 0.240 | not met |
| BNB | 12h | 203.0 | 112.0 | 225 | 47.1% | 1.244 | not met |
| BNB | 24h | 200.0 | 99.0 | 100 | 49.0% | 1.823 | not met |
| BTC | 30min | 202.7 | 77.4 | 3717 | 50.1% | 0.231 | not met |
| BTC | 12h | 203.0 | 64.5 | 130 | 46.9% | 1.204 | not met |
| BTC | 24h | 200.0 | 52.0 | 53 | 43.4% | 1.852 | not met |
| DOGE | 30min | 202.7 | 125.0 | 5999 | 52.1% | 0.354 | not met |
| DOGE | 12h | 203.0 | 112.0 | 225 | 53.3% | 1.904 | not met |
| DOGE | 24h | 200.0 | 99.0 | 100 | 38.0% | 2.959 | not met |
| ETH | 30min | 202.7 | 125.0 | 5999 | 52.2% | 0.315 | not met |
| ETH | 12h | 203.0 | 112.0 | 225 | 46.2% | 1.689 | not met |
| ETH | 24h | 200.0 | 99.0 | 100 | 50.0% | 2.585 | not met |
| LINK | 30min | 202.7 | 125.0 | 5999 | 51.4% | 0.364 | not met |
| LINK | 12h | 203.0 | 112.0 | 225 | 56.4% | 1.737 | not met |
| LINK | 24h | 200.0 | 99.0 | 100 | 58.0% | 2.657 | not met |
| SOL | 30min | 202.7 | 125.0 | 5999 | 51.0% | 0.354 | not met |
| SOL | 12h | 203.0 | 112.0 | 225 | 53.3% | 1.843 | not met |
| SOL | 24h | 200.0 | 99.0 | 100 | 47.0% | 2.779 | not met |
| TRX | 30min | 202.7 | 125.0 | 5999 | 46.7% | 0.116 | not met |
| TRX | 12h | 203.0 | 112.0 | 225 | 47.1% | 0.756 | not met |
| TRX | 24h | 200.0 | 99.0 | 100 | 51.0% | 1.096 | not met |
| XRP | 30min | 202.7 | 125.0 | 5999 | 49.5% | 0.331 | not met |
| XRP | 12h | 203.0 | 112.0 | 225 | 56.9% | 1.671 | not met |
| XRP | 24h | 200.0 | 99.0 | 100 | 67.0% | 2.586 | not met |

| Horizon | Mean sign accuracy (10 coins) | Min | Max |
|---|---|---|---|
| 30min | 50.7% | 46.7% | 52.6% |
| 12h | 50.8% | 45.8% | 56.9% |
| 24h | 49.1% | 38.0% | 67.0% |

**`reached_70` is false for all 30 runs.** Sign accuracy sits around 50%.

The single 67% (XRP 24h) comes from only 100 test windows. Its 95% confidence interval is roughly +/- 9 points, so it is not distinguishable from noise with this data.

### 6.3 `grok_study_best_v2/summary.json`

| Horizon | Best coin | Sign accuracy | Test windows | MAE % | reached_70 |
|---|---|---|---|---|---|
| 30min | ADA | 52.6% | 5,999 | 0.388 | false |
| 12h | XRP | 56.9% | 225 | 1.671 | false |
| 24h | XRP | 67.0% | 100 | 2.586 | false |

The coin was selected on **test** accuracy, so these are optimistic.

## 7. Setup and rerun

### 7.1 Environments

There are two venvs, because their frozen numpy versions differ (2.5.3 vs 2.5.4). Python 3.12.3 was used on the VM.

```bash
python3.12 -m venv venv
venv/bin/pip install -r requirements-pipeline.txt          # pandas, requests, pytrends, boto3, tqdm, ...

python3.12 -m venv grok_edit_v1/venv
grok_edit_v1/venv/bin/pip install -r requirements-models.txt   # torch 2.14.1+cpu (PyTorch CPU index), scikit-learn, pandas, numpy
```

### 7.2 Credentials and environment variables

No `.env` file is used. The credentials are hardcoded in `crypto_pipeline.py` exactly as on the VM:

| Name | Where | Purpose |
|---|---|---|
| `AV_API_KEYS` | `crypto_pipeline.py` lines 64-74 (list of 9 keys) | Alpha Vantage keys, rotated in list order |
| `PROXY_URL` | `crypto_pipeline.py` line 117 (`PROXIES` on line 118 uses it) | `http://USER:PASS@host:port` proxy used for Google Trends requests |
| AWS credentials | not needed | S3 upload is disabled in code; none were configured on the VM |

To change a key or the proxy, edit those lines. Environment variables are used only by the model scripts:

| Variable | Used by | Purpose |
|---|---|---|
| `COINS` | `grok_study_v3.py` | Coins to train, e.g. `BTC,ETH,SOL` (the default) |
| `SMOKE` | both model scripts | Any value gives a tiny, fast test run |

The cached sentiment and trends mean a rebuild with `--skip-trends --skip-sentiment` makes no API calls.

### 7.3 Commands

The pipeline uses paths relative to the working directory (`cache/`, `pipeline.log`), so run it from the repo root.

```bash
# Rebuild daily CSVs from cached zips / trends / sentiment (no API calls if caches + checkpoints are present)
venv/bin/python crypto_pipeline.py --symbols ETH BNB XRP SOL DOGE TRX ADA AVAX LINK --skip-trends --skip-sentiment
# Flags: --symbols ... (default: all 10), --skip-trends, --skip-sentiment, --skip-binance, --no-parallel
```

The model scripts **hard-code VM paths** (`/home/ubuntu/crypto/...`). To run them elsewhere, either check the repo out at that path or edit `data_folder` / `out_dir` in `grok_edit_v1.py` and `OUT_ROOT` plus the data path in `grok_study_v3.py`.

```bash
grok_edit_v1/venv/bin/python grok_edit_v1/grok_edit_v1.py
COINS=BTC,ETH,SOL grok_edit_v1/venv/bin/python grok_study_v3/grok_study_v3.py                  # matches train.log
COINS=BNB,XRP,DOGE,TRX,ADA,AVAX,LINK grok_edit_v1/venv/bin/python grok_study_v3/grok_study_v3.py # matches train_rest.log
```

These invocations are reconstructed from the scripts and log contents; the exact original commands are **unknown**.

## 8. Known limitations

- **S3 never used.** `process_data` sets `uploaded = 0` with the comment "S3 upload replaced with local CSV save". The `upload_to_s3` helper still expects `.json` file names, while the pipeline writes `.csv`. No AWS credentials existed. The log reports `s3_uploaded=0` for every coin.
- **Results below target.** Every experiment is below its target, and most are near 50%. `grok_edit_v1` gated precision is 26% against a 75% target. The study has no baselines, and the best-of selection uses test data.
- **CPU only.** torch is the CPU build. Model sizes and epochs (6 to 24) are small.
- **Data caveats:**
  - `o/h/l/v` are rolling 24-hour values;
  - sentiment is sparse and mostly proxy or synthetic;
  - Google Trends is roughly daily, forward-filled to 30 minutes;
  - BTC comes from a separately produced `BTC.csv` of unknown origin with lossy `E` values and no trends.
- **Evaluation is a single chronological split.** There is no walk-forward validation, `grok_study_v3` has no train/test gap, and no transaction costs are modelled.
- **Hard-coded paths** in the model scripts.
- **Nothing is scheduled:** no cron, service or container ran any of this on the VM.

## 9. Next steps (suggestions only, not decided)

1. Fix the feature semantics. Either write true per-minute `o/h/l/v` alongside the rolling 24-hour ones, or rebuild 5-minute candles from `c` only. Then rerun `grok_edit_v1`.
2. Regenerate BTC through the pipeline: download BTCUSDT zips and fetch trends, replacing `BTC.csv`.
3. Add baselines (persistence, majority, momentum) and walk-forward evaluation to `grok_study_v3`. Pick "best" models on validation rather than test, and include fees.
4. Improve sentiment coverage (more AV history or a different news source), or drop `va` if it adds nothing.
5. Make paths configurable (env vars or CLI) and add a small `Makefile` / run script.
6. Only consider anything trade-related after a model clearly beats baselines out of sample, net of costs.
