# grok_study_v3. Bidirectional LSTM. Predicts the next return in percent.
# Up or down is the sign of that number. BTC, ETH, and SOL. 200+ days of
# training, then every remaining window once. h and l are not used.

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler

OUT_ROOT = "/home/ubuntu/crypto/grok_study_v3"
PRESETS = [
    dict(label="30min", step=30, train_days=203, seq_len=16, min_test=1000),
    dict(label="12h", step=720, train_days=210, seq_len=14, min_test=80),
    dict(label="24h", step=1440, train_days=210, seq_len=10, min_test=40),
]


def seed_all():
    np.random.seed(42)
    torch.manual_seed(42)
    torch.set_num_threads(min(8, os.cpu_count() or 1))


def load_symbol(symbol):
    if os.environ.get("SMOKE"):
        rng = np.random.default_rng(5)
        n = 16 * 24 * 60
        times = pd.date_range("2026-01-01", periods=n, freq="1min")
        close = 100 * np.cumprod(1 + rng.normal(0, 0.0004, n))
        atr = np.abs(rng.normal(0.0005, 0.0001, n))
        return pd.DataFrame({
            "time": times, "c": close, "atr15": atr, "atr60": atr * 0.9,
            "t": rng.normal(0, 1, n), "va": np.sign(np.r_[0, np.diff(close)]) * atr,
        })
    folder = Path("/home/ubuntu/crypto/cache/output") / symbol
    single = folder / ("%s.csv" % symbol)
    files = [single] if single.exists() else sorted(folder.glob("*.csv"))
    frames = []
    for path in files:
        part = pd.read_csv(path)
        sample = str(part["time"].iloc[0])
        if len(sample) >= 10 and sample[4] == "-" and sample[:4].isdigit():
            part["time"] = pd.to_datetime(part["time"], format="%Y-%m-%d %H:%M:%S")
        else:
            part["time"] = pd.to_datetime(part["time"], dayfirst=True)
        frames.append(part)
    df = pd.concat(frames, ignore_index=True)
    df["c"] = pd.to_numeric(df["c"], errors="coerce")
    for col in ("atr15", "atr60", "t", "va"):
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.dropna(subset=["c"]).sort_values("time").drop_duplicates("time")


def build(df, step):
    c = df["c"]
    up = np.sign(c.diff().fillna(0.0))
    synthetic = np.isclose(df["va"].fillna(0.0), up * df["atr15"].fillna(0.0), atol=1e-5, rtol=1e-3)
    frame = pd.DataFrame({"time": df["time"].to_numpy()})
    names = []
    for w in (step, step * 4, step * 24, 10080):
        frame["ret_%d" % w] = c.pct_change(w).to_numpy()
        names.append("ret_%d" % w)
    frame["atr15"] = df["atr15"].to_numpy()
    frame["atr60"] = df["atr60"].to_numpy()
    frame["atr_ratio"] = frame["atr15"] / (frame["atr60"] + 1e-9)
    frame["t"] = df["t"].fillna(0.0).to_numpy()
    frame["va_news"] = np.where(synthetic, 0.0, df["va"].fillna(0.0).to_numpy())
    hour = df["time"].dt.hour.to_numpy() + df["time"].dt.minute.to_numpy() / 60.0
    frame["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    frame["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    names += ["atr15", "atr60", "atr_ratio", "t", "va_news", "hour_sin", "hour_cos"]
    frame["target"] = ((c.shift(-step) - c) / (c + 1e-9) * 100.0).to_numpy()
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)
    return frame.iloc[::step].reset_index(drop=True), names


def span_days(times):
    return 0.0 if len(times) < 2 else (times.max() - times.min()).total_seconds() / 86400.0


def sign_acc(pred, y):
    return float(((np.asarray(pred) > 0) == (np.asarray(y) > 0)).mean())


class BiLSTM(nn.Module):
    def __init__(self, n_in, hidden=32):
        super().__init__()
        self.lstm = nn.LSTM(n_in, hidden, num_layers=1, batch_first=True, bidirectional=True)
        self.head = nn.Sequential(nn.Linear(hidden * 2, 32), nn.GELU(), nn.Dropout(0.3), nn.Linear(32, 1))

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :]).squeeze(-1)


def sequences(X, indices, seq_len):
    return np.stack([X[t - seq_len + 1:t + 1] for t in indices]).astype(np.float32)


def train_lstm(X, y, fit_idx, seq_len, epochs):
    model = BiLSTM(X.shape[1]).to("cpu")
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-3)
    order = np.asarray(fit_idx)
    for _ in range(epochs):
        np.random.default_rng(42).shuffle(order)
        model.train()
        for start in range(0, len(order), 128):
            batch = order[start:start + 128]
            if len(batch) < 4:
                continue
            xb = torch.tensor(sequences(X, batch, seq_len))
            yb = torch.tensor(y[batch].astype(np.float32))
            opt.zero_grad(set_to_none=True)
            pred = model(xb)
            loss = torch.nn.functional.smooth_l1_loss(pred, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
    return model


@torch.no_grad()
def predict(model, X, indices, seq_len):
    model.eval()
    out = []
    for start in range(0, len(indices), 256):
        batch = indices[start:start + 256]
        xb = torch.tensor(sequences(X, batch, seq_len))
        out.append(model(xb).numpy())
    return np.concatenate(out)


def run_one(symbol, cfg, smoke):
    label = cfg["label"]
    print("=== %s %s ===" % (symbol, label), flush=True)
    step = 6 if smoke else cfg["step"]
    seq_len = 8 if smoke else cfg["seq_len"]
    train_days = 6 if smoke else cfg["train_days"]
    frame, names = build(load_symbol(symbol), step)
    t = frame["time"]
    train_end = t.min() + pd.Timedelta(days=train_days)
    y = frame["target"].to_numpy(np.float64)
    eligible = np.arange(seq_len - 1, len(frame))
    final = eligible[t.iloc[eligible].to_numpy() < np.datetime64(train_end)]
    test = eligible[t.iloc[eligible].to_numpy() >= np.datetime64(train_end)]
    train_span = span_days(t.iloc[final])
    test_span = span_days(t.iloc[test])
    print("rows %d train_days %.1f test_days %.1f train %d test %d" % (
        len(frame), train_span, test_span, len(final), len(test)), flush=True)
    if not smoke and (train_span < 200 or len(test) < cfg["min_test"]):
        raise SystemExit("bad split %s %s" % (symbol, label))
    scaler = StandardScaler().fit(frame.iloc[final][names])
    X = np.nan_to_num(scaler.transform(frame[names]), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    model = train_lstm(X, y, final, seq_len, epochs=1 if smoke else 6)
    pred = np.full(len(frame), np.nan)
    pred[eligible] = predict(model, X, eligible, seq_len)
    yt, yp = y[test], pred[test]
    acc = sign_acc(yp, yt)
    mae = float(np.mean(np.abs(yp - yt)))
    print("TEST BiLSTM sign %.3f on %d  MAE %.3f%%" % (acc, len(test), mae), flush=True)
    folder = Path("/tmp/grok_study_v3_smoke") / symbol / label if smoke else Path(OUT_ROOT) / symbol / label
    folder.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), folder / "model.pt")
    np.savez(folder / "scaler.npz", mean=scaler.mean_, scale=scaler.scale_, features=np.array(names))
    pd.DataFrame({
        "time": pd.to_datetime(t.iloc[test]).astype(str),
        "target_pct": yt, "pred_pct": yp, "pred_up": (yp > 0).astype(int),
    }).to_csv(folder / "test_predictions.csv", index=False)
    summary = {
        "symbol": symbol, "label": label, "model": "bilstm",
        "train_days": round(float(train_span), 2), "test_days": round(float(test_span), 2),
        "test_windows": int(len(test)), "test_sign": acc, "test_mae_pct": mae,
        "reached_70": bool(acc >= 0.70 and len(test) >= (5 if smoke else cfg["min_test"])),
    }
    (folder / "metrics.json").write_text(json.dumps(summary, indent=2))
    return summary


def main():
    seed_all()
    smoke = bool(os.environ.get("SMOKE"))
    symbols = ["BTC"] if smoke else os.environ.get("COINS", "BTC,ETH,SOL").split(",")
    presets = PRESETS[:1] if smoke else PRESETS
    rows = [run_one(symbol, cfg, smoke) for symbol in symbols for cfg in presets]
    print("DONE", json.dumps(rows), flush=True)


if __name__ == "__main__":
    main()
