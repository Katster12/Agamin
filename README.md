# Agamin

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
