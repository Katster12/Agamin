from __future__ import annotations

import json
import math
import threading
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn


HORIZONS = {
    "30min": {"step": 30, "seq_len": 16, "ttl": 300},
    "12h": {"step": 720, "seq_len": 14, "ttl": 1800},
    "24h": {"step": 1440, "seq_len": 10, "ttl": 3600},
}


class BiLSTM(nn.Module):
    def __init__(self, n_in: int, hidden: int = 32):
        super().__init__()
        self.lstm = nn.LSTM(n_in, hidden, num_layers=1, batch_first=True, bidirectional=True)
        self.head = nn.Sequential(nn.Linear(hidden * 2, 32), nn.GELU(), nn.Dropout(0.3), nn.Linear(32, 1))

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        output, _ = self.lstm(value)
        return self.head(output[:, -1, :]).squeeze(-1)


class ModelBundle:
    def __init__(self, folder: Path):
        scaler = np.load(folder / "scaler.npz", allow_pickle=False)
        self.features = [str(value) for value in scaler["features"].tolist()]
        self.mean = scaler["mean"].astype(np.float64)
        self.scale = scaler["scale"].astype(np.float64)
        self.model = BiLSTM(len(self.features))
        self.model.load_state_dict(torch.load(folder / "model.pt", map_location="cpu", weights_only=True), strict=True)
        self.model.eval()
        self.metrics = json.loads((folder / "metrics.json").read_text(encoding="utf-8"))


class ModelRuntime:
    def __init__(self, root: Path):
        self.root = Path(root)
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        self.models: dict[tuple[str, str], ModelBundle] = {}
        self._lock = threading.RLock()
        for symbol_dir in sorted(path for path in self.root.iterdir() if path.is_dir() and path.name.isupper()):
            for horizon in HORIZONS:
                folder = symbol_dir / horizon
                if (folder / "model.pt").is_file():
                    self.models[(symbol_dir.name, horizon)] = ModelBundle(folder)
        if len(self.models) != 30:
            raise RuntimeError(f"expected 30 model bundles, found {len(self.models)}")

    @property
    def symbols(self) -> list[str]:
        return sorted({symbol for symbol, _ in self.models})

    def models_for_symbol(self, symbol: str) -> list[str]:
        return [horizon for horizon in HORIZONS if (symbol, horizon) in self.models]

    def feature_frame(self, candles: list, signals: list, step: int) -> tuple[pd.DataFrame, list[str]]:
        frame = pd.DataFrame([dict(row) for row in candles])
        frame["time"] = pd.to_datetime(frame.pop("open_time"), unit="ms", utc=True).dt.tz_convert("Asia/Kolkata")
        close = frame["close"]
        previous = close.shift(1)
        true_range = pd.concat([
            frame["high"] - frame["low"],
            (frame["high"] - previous).abs(),
            (frame["low"] - previous).abs(),
        ], axis=1).max(axis=1)
        frame["atr15"] = true_range.rolling(15, min_periods=1).mean() / (close + 1e-9)
        frame["atr60"] = true_range.rolling(60, min_periods=1).mean() / (close + 1e-9)
        frame["t"] = 0.0
        frame["va_news"] = 0.0
        if signals:
            signal_frame = pd.DataFrame([dict(row) for row in signals])
            signal_frame["time"] = pd.to_datetime(signal_frame.pop("observed_at"), unit="ms", utc=True).dt.tz_convert("Asia/Kolkata")
            signal_frame = signal_frame.rename(columns={"trend": "signal_t", "sentiment": "signal_va"})
            frame = pd.merge_asof(frame.sort_values("time"), signal_frame.sort_values("time"), on="time", direction="backward")
            frame["t"] = frame["signal_t"].fillna(0.0)
            frame["va_news"] = frame["signal_va"].fillna(0.0)

        result = pd.DataFrame({"time": frame["time"].to_numpy(), "close": close.to_numpy()})
        names = []
        for window in (step, step * 4, step * 24, 10080):
            name = f"ret_{window}"
            result[name] = close.pct_change(window).to_numpy()
            names.append(name)
        result["atr15"] = frame["atr15"].to_numpy()
        result["atr60"] = frame["atr60"].to_numpy()
        result["atr_ratio"] = result["atr15"] / (result["atr60"] + 1e-9)
        result["t"] = frame["t"].to_numpy()
        result["va_news"] = frame["va_news"].to_numpy()
        hour = frame["time"].dt.hour.to_numpy() + frame["time"].dt.minute.to_numpy() / 60.0
        result["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
        result["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
        names += ["atr15", "atr60", "atr_ratio", "t", "va_news", "hour_sin", "hour_cos"]
        result = result.replace([np.inf, -np.inf], np.nan).dropna(subset=names).reset_index(drop=True)
        return result, names

    def predict(self, symbol: str, horizon: str, candles: list, signals: list) -> dict:
        config = HORIZONS[horizon]
        bundle = self.models[(symbol, horizon)]
        frame, names = self.feature_frame(candles, signals, config["step"])
        if names != bundle.features:
            raise RuntimeError(f"feature contract mismatch for {symbol}/{horizon}")
        required_rows = 1 + (config["seq_len"] - 1) * config["step"]
        if len(frame) < required_rows:
            raise RuntimeError(f"insufficient live history for {symbol}/{horizon}: {len(frame)} rows")
        latest = len(frame) - 1
        indices = np.arange(latest - (config["seq_len"] - 1) * config["step"], latest + 1, config["step"])
        matrix = frame[names].iloc[indices].to_numpy(dtype=np.float64)
        scaled = np.nan_to_num((matrix - bundle.mean) / bundle.scale, nan=0.0, posinf=0.0, neginf=0.0)
        with self._lock, torch.inference_mode():
            value = float(bundle.model(torch.tensor(scaled, dtype=torch.float32).unsqueeze(0)).item())
        if not math.isfinite(value):
            raise RuntimeError(f"non-finite output for {symbol}/{horizon}")
        current = float(frame.iloc[-1]["close"])
        return {
            "symbol": symbol,
            "horizon": horizon,
            "as_of": pd.Timestamp(frame.iloc[-1]["time"]).isoformat(),
            "current_price": current,
            "predicted_return_pct": value,
            "price_target": current * (1 + value / 100),
            "direction": "Bullish" if value > 0 else "Bearish" if value < 0 else "Neutral",
            "evaluation": {
                "test_sign_accuracy": bundle.metrics.get("test_sign"),
                "test_mae_pct": bundle.metrics.get("test_mae_pct"),
                "test_windows": bundle.metrics.get("test_windows"),
                "target_reached": bundle.metrics.get("reached_70", False),
            },
            "research_only": True,
        }
