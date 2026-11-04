# Agamin

## Live cached inference deployment

The `new` branch now contains a production-oriented live inference service in `ml_service/`.
It loads all 30 supplied BiLSTM bundles (10 coins × 30-minute/12-hour/24-hour horizons),
fetches closed 1-minute candles from Binance's public market-data endpoint, reconstructs the
training feature contract, and refreshes predictions concurrently.

The service is intentionally research-only: the supplied artifacts did not meet their stated
accuracy targets. API responses include the original held-out metrics and do not invent a
confidence score.

### Local persistent cache

`.runtime/agamin-live.sqlite3` stores:

- 36 days of 1-minute OHLCV per coin;
- timestamped sentiment/Trends signal snapshots;
- per-coin/per-horizon prediction JSON;
- provider responses and failure TTLs.

Prediction TTLs are 5 minutes (30min), 30 minutes (12h), and 60 minutes (24h). Candle downloads
resume from the newest cached minute after restart. When no horizon has expired, the refresh path
does not reload historical frames or rerun a model.

### Run

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-live.txt
.venv/bin/python -m ml_service.api

curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/api/predict \
  -H 'Content-Type: application/json' \
  -d '{"coin":"BTC","horizons":["30min","12h","24h"]}'
```

Useful endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | model, refresh, and cache health |
| `GET /api/models` | all deployed coin/horizon bundles |
| `GET /api/predictions` | all locally cached forecasts |
| `GET /api/best` | original best-per-horizon research summary |
| `POST /api/predict` | cached forecast for a coin and requested horizons |
| `POST /api/admin/refresh` | trigger a refresh; disabled unless `AGAMIN_API_KEY` is set |

The checked-in systemd units under `deploy/` run the ML service and its outbound HTTPS tunnel.
The frontend's Vercel function proxies `/api/predict` to that HTTPS service, while Vite proxies to
`localhost:8000` during development.

Environment controls include `AGAMIN_WORKERS`, `AGAMIN_REFRESH_SECONDS`, `AGAMIN_STATE_DIR`,
`AGAMIN_API_KEY`, `ALPHA_VANTAGE_KEYS`, `TRENDS_PROXY_URL`, and `AGAMIN_ENABLE_TRENDS`.
Alpha Vantage and Google Trends are best-effort auxiliary signals: failures are cached for 30
minutes and inference continues with neutral values rather than repeatedly loading the provider.

Crypto research project: a data pipeline that builds 1-minute feature datasets for 10 coins
(Binance prices + Alpha Vantage news sentiment + Google Trends + volatility features), and a set of
small PyTorch BiLSTM models trained on that data.

**Status: research only. None of the models reached its accuracy target; results are not tradeable.**
There is no exchange connection and no order/trading code in this repository.

Full documentation: **[docs/PROJECT.md](docs/PROJECT.md)**

## Layout

| Path | What it is |
|---|---|
| `crypto_pipeline.py` | Data pipeline "v6" (Binance klines, AV sentiment, Google Trends, ATR/BBW) -> daily CSVs |
| `cache/zips/` | 99 monthly Binance 1m kline zips (9 coins x May 2025 - Mar 2026) and their 99 unzipped CSVs |
| `cache/output/<COIN>/` | Pipeline output: one CSV per coin per day (BTC: a single `BTC.csv`) |
| `cache/sentiment/`, `cache/trends/`, `cache/checkpoints/` | Cached API results and resume checkpoints |
| `grok_edit_v1/` | BTC 30-min BiLSTM + attention classifier, its model, scaler, metrics and test predictions |
| `grok_study_v3/` | BiLSTM return regressor for 10 coins x 3 horizons (30min/12h/24h): models, scalers, metrics |
| `grok_study_best_v2/` | Best coin per horizon from the study (copies of three `grok_study_v3` runs) + `summary.json` |
| `pipeline.log`, `run.out` | Logs from the pipeline run of 5-6 Oct 2026 |

## Setup

Two separate virtual environments (Python 3.12):

```bash
python3.12 -m venv venv && venv/bin/pip install -r requirements-pipeline.txt
python3.12 -m venv grok_edit_v1/venv && grok_edit_v1/venv/bin/pip install -r requirements-models.txt
```

No `.env` or extra configuration is needed. `crypto_pipeline.py` is committed exactly as it was on the VM:
the Alpha Vantage keys (`AV_API_KEYS`, lines 64-74) and the Google Trends proxy (`PROXY_URL`, line 117)
are hardcoded in the script. **This repository therefore contains live credentials. Keep it private.**

## What is not in this repository

This repository mirrors `/home/ubuntu/crypto` on the VM as-is: every file is byte-for-byte the original,
including `crypto_pipeline.py` and the unzipped `cache/zips/*.csv`. Only these are missing:

- `venv/` and `grok_edit_v1/venv/`: virtual environments; recreate them from `requirements-*.txt`.
- `cache/output.zip` (172,592,264 bytes, 172.6 MB): over GitHub's 100 MB per-file limit for git, so it is
  attached unchanged (byte-for-byte the VM file) to the GitHub Release **`data-2026-10-29`** instead. Download it
  from the repo's Releases page, or `gh release download data-2026-10-29 -R warrior123-coder/agamin -D cache`.
  Its contents duplicate `cache/output/`: all 3,015 files inside matched the files on disk by sha256
  (`cache/output/BTC/BTC.csv` exists only on disk and is included in git).

The files added for the repository are `.gitignore`, `README.md`, `docs/PROJECT.md` and the three
`requirements*.txt` files.
