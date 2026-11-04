# grok_edit_v1
# A separate copy of the BTC BiLSTM. main.ipynb and data/BTC.csv are not modified.
#
# What changed, and why:
# - The head predicts P(the 30-minute move reaches +min_move), the same for down,
#   and a 20th-to-80th percentile band. A call fires when that probability
#   clears a threshold chosen on validation. The band is the range:
#   at least the lower number, at most the upper number.
# - min_move starts at 0.40 percent. Later versions lower it toward 0.20 only if
#   the held-out precision stays ahead of the baselines.
# - Train, validation, and test are chronological. Each window sits entirely on
#   its own side of the cut, and labels stop 6 bars early so a target cannot
#   see the next split. The checkpoint is chosen on validation loss. The test
#   segment is scored once.
# - Fake-breakout features (a wick through the prior high or low that closes
#   back inside) are inputs. The future path is used only to measure how often
#   a call's high touched the target and then the close gave it back.
# - 75% has to hold on the held-out test, with at least 50 calls and the same
#   result on non-overlapping calls. Overlapping 30-minute labels are not 6
#   independent bets.

import glob
import json
import os
import random

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, Dataset

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class CFG:
    # Read-only. This file is never opened for writing.
    data_folder = "/home/ubuntu/crypto/cache/output/BTC"
    days = 270
    seq_len = 48
    horizon = 6
    epochs = 24
    patience = 6
    lr = 1e-3
    batch_size = 128
    hidden = 64
    layers = 2
    dropout = 0.35
    min_move = 0.40
    q_lo = 0.20
    q_hi = 0.80
    train_frac = 0.70
    val_frac = 0.15
    out_dir = "/home/ubuntu/crypto/grok_edit_v1"
    seed = 42


def seed_all(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    threads = min(8, os.cpu_count() or 1)
    torch.set_num_threads(threads)
    print("threads %d" % threads, flush=True)


class SeqDataset(Dataset):
    def __init__(self, X, y, indices, seq_len):
        self.X = torch.as_tensor(X, dtype=torch.float32)
        self.y = torch.as_tensor(y, dtype=torch.float32)
        self.indices = np.asarray(indices, dtype=np.int64)
        self.seq_len = seq_len

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i):
        t = int(self.indices[i])
        return self.X[t - self.seq_len + 1:t + 1], self.y[t]


class TemporalAttention(nn.Module):
    def __init__(self, hidden_dim):
        super().__init__()
        self.attn = nn.Linear(hidden_dim, 1)

    def forward(self, lstm_out):
        weights = torch.softmax(self.attn(lstm_out), dim=1)
        return (weights * lstm_out).sum(dim=1)


class BiLSTMRange(nn.Module):
    """Bidirectional LSTM. Outputs down/flat/up logits plus a return band."""

    def __init__(self, input_size, hidden=64, layers=2, dropout=0.35):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden,
            num_layers=layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if layers > 1 else 0.0,
        )
        wide = hidden * 2
        self.attn = TemporalAttention(wide)
        self.norm = nn.LayerNorm(wide)
        self.trunk = nn.Sequential(
            nn.Linear(wide, 64),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.cls_head = nn.Linear(64, 3)
        self.lo_head = nn.Linear(64, 1)
        self.width_head = nn.Linear(64, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        h = self.trunk(self.norm(self.attn(out)))
        logits = self.cls_head(h)
        lo = self.lo_head(h).squeeze(-1)
        hi = lo + torch.nn.functional.softplus(self.width_head(h).squeeze(-1))
        return logits, lo, hi


def range_loss(logits, lo, hi, y, min_move, q_lo, q_hi, class_w):
    cls = torch.ones(len(y), dtype=torch.long, device=y.device)
    cls = torch.where(y >= min_move, torch.full_like(cls, 2), cls)
    cls = torch.where(y <= -min_move, torch.zeros_like(cls), cls)
    ce = nn.functional.cross_entropy(logits, cls, weight=class_w)
    err_lo = y - lo
    err_hi = y - hi
    pb = torch.maximum(q_lo * err_lo, (q_lo - 1) * err_lo).mean()
    pb = pb + torch.maximum(q_hi * err_hi, (q_hi - 1) * err_hi).mean()
    return ce + pb, ce, pb


def barrier_weights(y, indices, min_move):
    yy = y[indices]
    counts = np.array([
        np.sum(yy <= -min_move),
        np.sum(np.abs(yy) < min_move),
        np.sum(yy >= min_move),
    ], dtype=np.float32)
    weights = counts.sum() / np.maximum(counts, 1.0)
    weights = weights / weights.mean()
    print("train counts down/flat/up %d %d %d" % (counts[0], counts[1], counts[2]), flush=True)
    return torch.tensor(weights, dtype=torch.float32, device=DEVICE)


def synthetic_frame(n_days=40):
    rng = np.random.default_rng(0)
    n = n_days * 24 * 12
    times = pd.date_range("2026-01-01", periods=n, freq="5min")
    close = 60000 * np.cumprod(1 + rng.normal(0, 0.0015, n))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.random(n) * 0.001)
    low = np.minimum(open_, close) * (1 - rng.random(n) * 0.001)
    return pd.DataFrame({
        "time": times, "open": open_, "high": high, "low": low, "close": close,
        "volume": rng.random(n) * 10 + 0.1,
    })


def load_raw(folder):
    if os.environ.get("SMOKE"):
        return synthetic_frame()
    files = sorted(glob_csv(folder))
    if not files:
        raise SystemExit("no csv under %s" % folder)
    frames = [pd.read_csv(f) for f in files]
    return pd.concat(frames, ignore_index=True)


def glob_csv(folder):
    return glob.glob(os.path.join(folder, "**", "*.csv"), recursive=True)


def resample_5m(df):
    df = df.set_index("time")
    out = df.resample("5min").agg({
        "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
    }).dropna()
    return out.reset_index()


def add_features(df, horizon):
    c, h, l, v, o = df["close"], df["high"], df["low"], df["volume"], df["open"]
    df["return_1"] = c.pct_change()
    df["return_3"] = c.pct_change(3)
    df["return_6"] = c.pct_change(6)
    df["return_12"] = c.pct_change(12)
    df["return_24"] = c.pct_change(24)
    df["momentum_12"] = (c - c.shift(12)) / (c.shift(12) + 1e-9)

    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss_ = (-delta.clip(upper=0)).rolling(14).mean()
    rsi = 100 - 100 / (1 + gain / (loss_ + 1e-9))
    df["rsi_14"] = (rsi - 50) / 50.0

    e12 = c.ewm(span=12, adjust=False).mean()
    e26 = c.ewm(span=26, adjust=False).mean()
    macd = e12 - e26
    sig = macd.ewm(span=9, adjust=False).mean()
    df["macd"] = macd / (c + 1e-9)
    df["macd_signal"] = sig / (c + 1e-9)
    df["macd_hist"] = (macd - sig) / (c + 1e-9)

    sma20 = c.rolling(20).mean()
    std20 = c.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    df["bb_width"] = (bb_upper - bb_lower) / (sma20 + 1e-9)
    df["bb_pos"] = (c - bb_lower) / (bb_upper - bb_lower + 1e-9)

    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    df["atr_norm"] = tr.rolling(14).mean() / (c + 1e-9)
    atr = df["atr_norm"]
    df["atr_z"] = ((atr - atr.rolling(288).mean()) / (atr.rolling(288).std() + 1e-9)).clip(-5, 5)

    obv = (np.sign(delta.fillna(0)) * v).cumsum()
    df["obv_zscore"] = (obv - obv.rolling(48).mean()) / (obv.rolling(48).std() + 1e-9)
    typical = (h + l + c) / 3
    vwap = (typical * v).rolling(48).sum() / (v.rolling(48).sum() + 1e-9)
    df["vwap_dev"] = (c - vwap) / (vwap + 1e-9)
    ema8 = c.ewm(span=8, adjust=False).mean()
    ema21 = c.ewm(span=21, adjust=False).mean()
    df["ema_cross"] = (ema8 - ema21) / (ema21 + 1e-9)

    rng = (h - l).clip(lower=1e-9)
    df["body"] = (c - o).abs() / rng
    df["upper_wick"] = (h - pd.concat([o, c], axis=1).max(axis=1)) / rng
    df["lower_wick"] = (pd.concat([o, c], axis=1).min(axis=1) - l) / rng
    df["body_signed"] = (c - o) / rng
    df["vol_zscore"] = (v - v.rolling(24).mean()) / (v.rolling(24).std() + 1e-9)

    lo14 = l.rolling(14).min()
    hi14 = h.rolling(14).max()
    df["stoch_k"] = 2 * (c - lo14) / (hi14 - lo14 + 1e-9) - 1
    tp = (h + l + c) / 3
    df["cci_20"] = ((tp - tp.rolling(20).mean()) / (0.015 * tp.rolling(20).std() + 1e-9)).clip(-3, 3) / 3.0

    prior_high = h.shift(1).rolling(12).max()
    prior_low = l.shift(1).rolling(12).min()
    df["fake_up"] = ((h > prior_high) & (c < prior_high)).astype(np.float32)
    df["fake_dn"] = ((l < prior_low) & (c > prior_low)).astype(np.float32)
    path = c.diff().abs().rolling(12).sum()
    df["efficiency"] = (c - c.shift(12)).abs() / (path + 1e-9)
    hour = df["time"].dt.hour + df["time"].dt.minute / 60.0
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)

    fut_high = pd.concat([h.shift(-k) for k in range(1, horizon + 1)], axis=1).max(axis=1)
    fut_low = pd.concat([l.shift(-k) for k in range(1, horizon + 1)], axis=1).min(axis=1)
    df["mfe_up"] = (fut_high - c) / (c + 1e-9) * 100.0
    df["mfe_dn"] = (c - fut_low) / (c + 1e-9) * 100.0
    df["target"] = (c.shift(-horizon) - c) / (c + 1e-9) * 100.0
    return df


FEATURES = [
    "return_1", "return_3", "return_6", "return_12", "return_24", "momentum_12",
    "rsi_14", "macd", "macd_signal", "macd_hist",
    "bb_width", "bb_pos", "atr_norm", "atr_z",
    "obv_zscore", "vol_zscore", "vwap_dev", "ema_cross",
    "body", "upper_wick", "lower_wick", "body_signed",
    "stoch_k", "cci_20",
    "fake_up", "fake_dn", "efficiency", "hour_sin", "hour_cos",
]


def prepare(raw, cfg):
    df = raw.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "t": "trades"})
    df["time"] = pd.to_datetime(df["time"], dayfirst=True)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close", "volume"])
    df = df.sort_values("time").drop_duplicates("time")
    df = resample_5m(df)
    cutoff = df["time"].max() - pd.Timedelta(days=cfg.days)
    df = df[df["time"] >= cutoff].copy()
    df = add_features(df, cfg.horizon)
    df = df.dropna().reset_index(drop=True)
    if set(FEATURES) & {"target", "mfe_up", "mfe_dn"}:
        raise SystemExit("target leaked into features")
    bar_s = df["time"].diff().dt.total_seconds().median()
    print("rows %d features %d" % (len(df), len(FEATURES)), flush=True)
    print("dates %s -> %s" % (df["time"].min(), df["time"].max()), flush=True)
    print("median bar %.0f sec, horizon %.1f min" % (bar_s, bar_s * cfg.horizon / 60.0), flush=True)
    return df


def make_indices(n, seq_len, horizon, train_frac, val_frac):
    val_start = int(n * train_frac)
    test_start = int(n * (train_frac + val_frac))
    train_idx = np.arange(seq_len - 1, val_start - horizon)
    val_idx = np.arange(val_start + seq_len - 1, test_start - horizon)
    test_idx = np.arange(test_start + seq_len - 1, n)
    if min(len(train_idx), len(val_idx), len(test_idx)) < 50:
        raise SystemExit("not enough rows after embargo: %d %d %d" % (
            len(train_idx), len(val_idx), len(test_idx)))
    assert train_idx[-1] + horizon < val_start
    assert val_idx[0] - seq_len + 1 >= val_start
    assert val_idx[-1] + horizon < test_start
    assert test_idx[0] - seq_len + 1 >= test_start
    return train_idx, val_idx, test_idx


def make_loader(X, y, indices, seq_len, batch, shuffle, pin):
    ds = SeqDataset(X, y, indices, seq_len)
    return DataLoader(ds, batch_size=batch, shuffle=shuffle, num_workers=0, pin_memory=pin)


def cpu_state(model):
    return {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}


def run_epoch(model, loader, opt, sched, scaler, cfg, class_w, train):
    model.train(train)
    totals = np.zeros(3)
    n = 0
    amp = DEVICE == "cuda"
    grad = torch.enable_grad() if train else torch.no_grad()
    with grad:
        for xb, yb in loader:
            xb = xb.to(DEVICE, non_blocking=amp)
            yb = yb.to(DEVICE, non_blocking=amp)
            if train:
                opt.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=amp):
                logits, lo, hi = model(xb)
                loss, ce, pb = range_loss(logits, lo, hi, yb, cfg.min_move, cfg.q_lo, cfg.q_hi, class_w)
            if train:
                scaler.scale(loss).backward()
                scaler.unscale_(opt)
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(opt)
                scaler.update()
                sched.step()
            bs = len(yb)
            totals += np.array([loss.item(), ce.item(), pb.item()]) * bs
            n += bs
    return totals / max(n, 1)


@torch.no_grad()
def predict(model, loader):
    model.eval()
    parts = []
    for xb, yb in loader:
        logits, lo, hi = model(xb.to(DEVICE))
        prob = torch.softmax(logits, dim=-1).float().cpu().numpy()
        parts.append((prob, lo.float().cpu().numpy(), hi.float().cpu().numpy(), yb.numpy()))
    return tuple(np.concatenate([p[i] for p in parts]) for i in range(4))


def decide(p_up, p_dn, p_star):
    call = np.full(len(p_up), "ABSTAIN", dtype=object)
    up = p_up >= p_star
    down = p_dn >= p_star
    call[up & ~down] = "UP"
    call[down & ~up] = "DOWN"
    return call


def score_calls(call, y, lo, hi, indices, min_move, horizon):
    up = call == "UP"
    down = call == "DOWN"
    called = up | down
    n = int(called.sum())
    hit = np.zeros(len(y), dtype=bool)
    hit[up] = y[up] >= min_move
    hit[down] = y[down] <= -min_move
    inside = (y >= lo) & (y <= hi)
    precision = float(hit[called].mean()) if n else None
    cover = float(inside[called].mean()) if n else None
    width = float((hi - lo)[called].mean()) if n else None

    keep_hit = []
    last = -10 ** 9
    for i in range(len(call)):
        if not called[i] or indices[i] < last + horizon:
            continue
        last = int(indices[i])
        keep_hit.append(bool(hit[i]))
    n_keep = len(keep_hit)
    precision_keep = float(np.mean(keep_hit)) if n_keep else None
    return {
        "n": n,
        "precision": precision,
        "inside_band": cover,
        "band_width": width,
        "n_nonoverlap": n_keep,
        "precision_nonoverlap": precision_keep,
        "n_up": int(up.sum()),
        "n_down": int(down.sum()),
    }


def sign_accuracy(pred_up, y, min_move):
    large = np.abs(y) >= min_move
    n = int(large.sum())
    if n == 0:
        return None, 0
    return float((pred_up[large] == (y[large] > 0)).mean()), n


def select_p_star(p_up, p_dn, lo, hi, y, indices, cfg):
    curve = []
    for p_star in (0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75):
        stats = score_calls(decide(p_up, p_dn, p_star), y, lo, hi, indices, cfg.min_move, cfg.horizon)
        curve.append((p_star, stats))
        prec = stats["precision"]
        print("  val p>=%.2f  precision %s  calls %d  nonoverlap %s (%d)" % (
            p_star,
            "none" if prec is None else "%.3f" % prec,
            stats["n"],
            "none" if stats["precision_nonoverlap"] is None else "%.3f" % stats["precision_nonoverlap"],
            stats["n_nonoverlap"],
        ), flush=True)
    eligible = [row for row in curve if row[1]["n"] >= 40 and row[1]["precision"] is not None]
    if eligible:
        eligible.sort(key=lambda row: (row[1]["precision"], row[1]["n"]))
        return eligible[-1][0]
    curve.sort(key=lambda row: (row[1]["n"], -row[0]))
    return curve[-1][0]


def num(x):
    if x is None or (isinstance(x, (float, np.floating)) and not np.isfinite(x)):
        return None
    return float(x) if isinstance(x, (float, np.floating, int, np.integer)) else x


def diagnose(train_loss, val_loss, test, ungated, baselines, fake_share, cover_all, cfg):
    notes = []
    reached = (
        test["precision"] is not None and test["precision"] >= 0.75
        and test["n"] >= 50
        and test["precision_nonoverlap"] is not None and test["precision_nonoverlap"] >= 0.75
        and test["n_nonoverlap"] >= 20
    )
    if reached:
        notes.append("STOP. Held-out precision is at least 75% on 50 or more calls, and on non-overlapping calls.")
    else:
        notes.append("CONTINUE. Held-out precision is under 75%, or there are too few calls to trust it.")
    if val_loss > train_loss * 1.25:
        notes.append("Validation loss is well above train loss. The next version should be smaller or stop sooner.")
    best_base = max(v for v in baselines.values() if v is not None)
    if ungated is None or ungated < best_base + 0.02:
        notes.append("Before the confidence gate, direction is within 2 points of the best baseline. The gate is not creating an edge by itself.")
    if test["n"] < 50:
        notes.append("Fewer than 50 test calls. Precision on a handful of bars is not a strategy.")
    if cover_all is not None and abs(cover_all - 0.60) > 0.15:
        notes.append("The 20-80 percent band covered %.0f%% of test outcomes. A calibrated band covers about 60%%." % (100 * cover_all))
    if test["band_width"] is not None and test["band_width"] > 2.0:
        notes.append("The average called band is wider than 2 percent. That is too loose to act on.")
    if fake_share is not None and fake_share >= 0.35:
        notes.append("Of the missed UP calls, %.0f%% touched +%.2f%% and then closed back below it. The next version should train on the close holding, not the wick." % (100 * fake_share, cfg.min_move))
    if (not reached) and ungated is not None and ungated >= best_base + 0.03 and (test["precision"] or 0) >= best_base + 0.05:
        notes.append("There is a small edge at %.2f%%. The next version can try %.2f%%." % (cfg.min_move, max(0.20, cfg.min_move - 0.10)))
    elif not reached:
        notes.append("Do not lower the %.2f%% move yet. A smaller target is a harder call, not an easier one." % cfg.min_move)
    return reached, notes


def predict_latest(model, scaler, frame, seq_len):
    window = frame[FEATURES].iloc[-seq_len:]
    x = np.nan_to_num(scaler.transform(window), nan=0.0, posinf=0.0, neginf=0.0)
    xb = torch.tensor(x, dtype=torch.float32, device=DEVICE).unsqueeze(0)
    model.eval()
    with torch.no_grad():
        logits, lo, hi = model(xb)
        prob = torch.softmax(logits, dim=-1)[0]
    return float(prob[2]), float(prob[0]), float(lo.item()), float(hi.item())


def train(cfg):
    seed_all(cfg.seed)
    print("device %s" % DEVICE, flush=True)
    print("cwd %s" % os.getcwd(), flush=True)
    print("device pick: cuda if present, otherwise cpu", flush=True)
    print("grok_edit_v1 reads BTC.csv and does not write it", flush=True)
    data_root = os.path.abspath(cfg.data_folder)
    out_root = os.path.abspath(cfg.out_dir)
    if out_root == data_root or out_root.startswith(data_root + os.sep):
        raise SystemExit("refusing to write inside the BTC data folder")

    df = prepare(load_raw(cfg.data_folder), cfg)
    y = df["target"].to_numpy(np.float32)
    train_idx, val_idx, test_idx = make_indices(
        len(df), cfg.seq_len, cfg.horizon, cfg.train_frac, cfg.val_frac)
    print("windows train %d val %d test %d embargo %d seq %d" % (
        len(train_idx), len(val_idx), len(test_idx), cfg.horizon, cfg.seq_len), flush=True)

    scaler = StandardScaler()
    val_start = int(len(df) * cfg.train_frac)
    scaler.fit(df.iloc[:val_start][FEATURES])
    X = np.nan_to_num(scaler.transform(df[FEATURES]), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)

    pin = DEVICE == "cuda"
    train_loader = make_loader(X, y, train_idx, cfg.seq_len, cfg.batch_size, True, pin)
    val_loader = make_loader(X, y, val_idx, cfg.seq_len, cfg.batch_size, False, pin)
    test_loader = make_loader(X, y, test_idx, cfg.seq_len, cfg.batch_size, False, pin)

    model = BiLSTMRange(len(FEATURES), cfg.hidden, cfg.layers, cfg.dropout).to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=cfg.lr, steps_per_epoch=len(train_loader), epochs=cfg.epochs,
        pct_start=0.2, anneal_strategy="cos")
    scaler_amp = torch.amp.GradScaler("cuda", enabled=pin)
    class_w = barrier_weights(y, train_idx, cfg.min_move)
    n_params = sum(p.numel() for p in model.parameters())
    print("parameters %d" % n_params, flush=True)

    best_vl = float("inf")
    best_state = cpu_state(model)
    patience = 0
    last_train = None
    epochs_ran = 0
    for ep in range(cfg.epochs):
        epochs_ran = ep + 1
        tr = run_epoch(model, train_loader, opt, sched, scaler_amp, cfg, class_w, True)
        va = run_epoch(model, val_loader, None, None, scaler_amp, cfg, class_w, False)
        last_train = float(tr[0])
        tag = ""
        if va[0] < best_vl - 1e-4:
            best_vl = float(va[0])
            best_state = cpu_state(model)
            patience = 0
            tag = "  best"
        else:
            patience += 1
        print("epoch %02d train %.4f (ce %.4f pb %.4f) val %.4f%s" % (
            ep + 1, tr[0], tr[1], tr[2], va[0], tag), flush=True)
        if not np.isfinite(tr[0]) or not np.isfinite(va[0]):
            print("loss is not finite, stopping", flush=True)
            break
        if patience >= cfg.patience:
            print("early stop, validation loss flat for %d epochs" % cfg.patience, flush=True)
            break

    model.load_state_dict(best_state)
    val_prob, val_lo, val_hi, val_y = predict(model, val_loader)
    test_prob, test_lo, test_hi, test_y = predict(model, test_loader)
    if np.any(val_lo > val_hi + 1e-4) or np.any(test_lo > test_hi + 1e-4):
        raise SystemExit("lower band crossed the upper band")

    print("validation threshold curve, selection set only", flush=True)
    p_star = select_p_star(val_prob[:, 2], val_prob[:, 0], val_lo, val_hi, val_y, val_idx, cfg)
    print("selected p_star %.2f on validation, then test is scored once" % p_star, flush=True)

    test_call = decide(test_prob[:, 2], test_prob[:, 0], p_star)
    test_stats = score_calls(test_call, test_y, test_lo, test_hi, test_idx, cfg.min_move, cfg.horizon)
    ungated, n_large = sign_accuracy(test_prob[:, 2] >= test_prob[:, 0], test_y, cfg.min_move)
    cover_all = float(((test_y >= test_lo) & (test_y <= test_hi)).mean())

    y_train = y[train_idx]
    large_train = np.abs(y_train) >= cfg.min_move
    majority_up = bool((y_train[large_train] > 0).mean() >= 0.5) if large_train.any() else True
    r6 = df["return_6"].to_numpy()[test_idx]
    r1 = df["return_1"].to_numpy()[test_idx]
    base_majority, _ = sign_accuracy(np.full(len(test_y), majority_up), test_y, cfg.min_move)
    base_momentum, _ = sign_accuracy(r6 > 0, test_y, cfg.min_move)
    base_revert, _ = sign_accuracy(r1 < 0, test_y, cfg.min_move)
    baselines = {"majority": base_majority, "momentum": base_momentum, "revert": base_revert}

    missed_up = (test_call == "UP") & (test_y < cfg.min_move)
    mfe_up = df["mfe_up"].to_numpy()[test_idx]
    fake_share = None
    if missed_up.any():
        fake_share = float((missed_up & (mfe_up >= cfg.min_move)).sum() / missed_up.sum())

    up_rate = float((test_y >= cfg.min_move).mean())
    down_rate = float((test_y <= -cfg.min_move).mean())
    reached, notes = diagnose(
        last_train, best_vl, test_stats, ungated, baselines, fake_share, cover_all, cfg)
    if test_stats["precision"] is not None and test_stats["n_up"] >= test_stats["n_down"]:
        if test_stats["precision"] <= up_rate + 0.03:
            notes.append("Most calls are UP and precision is within 3 points of the %.3f base rate, so the gate is not selective." % up_rate)

    print("", flush=True)
    print("TEST scored once at p_star %.2f and min_move %.2f percent" % (p_star, cfg.min_move), flush=True)
    print("gated precision %s on %d calls (up %d down %d)" % (
        "none" if test_stats["precision"] is None else "%.3f" % test_stats["precision"],
        test_stats["n"], test_stats["n_up"], test_stats["n_down"]), flush=True)
    print("nonoverlap precision %s on %d calls" % (
        "none" if test_stats["precision_nonoverlap"] is None else "%.3f" % test_stats["precision_nonoverlap"],
        test_stats["n_nonoverlap"]), flush=True)
    print("called band coverage %s mean width %s" % (
        "none" if test_stats["inside_band"] is None else "%.3f" % test_stats["inside_band"],
        "none" if test_stats["band_width"] is None else "%.3f" % test_stats["band_width"]), flush=True)
    print("all-test band coverage %.3f (about 0.60 if calibrated)" % cover_all, flush=True)
    print("ungated sign accuracy %s on %d bars with a move of at least %.2f%%" % (
        "none" if ungated is None else "%.3f" % ungated, n_large, cfg.min_move), flush=True)
    print("baseline majority %.3f momentum %.3f revert %.3f" % (
        base_majority, base_momentum, base_revert), flush=True)
    print("test base rate of a %.2f%% move: up %.3f down %.3f" % (cfg.min_move, up_rate, down_rate), flush=True)
    print("fake-breakout share of missed UP calls %s" % (
        "none" if fake_share is None else "%.3f" % fake_share), flush=True)
    print("fees and spread are not in these numbers", flush=True)

    print("last 5 test bars: time close p_up at_least at_most target call", flush=True)
    times = df["time"].iloc[test_idx]
    closes = df["close"].to_numpy()[test_idx]
    for i in range(max(0, len(test_y) - 5), len(test_y)):
        print("%s %8.0f %5.2f %+6.2f %+6.2f %+6.2f %7s" % (
            pd.Timestamp(times.iloc[i]).strftime("%Y-%m-%d %H:%M"),
            closes[i], test_prob[i, 2], test_lo[i], test_hi[i], test_y[i], test_call[i]), flush=True)

    p_live, p_dn_live, lo_live, hi_live = predict_latest(model, scaler, df, cfg.seq_len)
    live_call = decide(np.array([p_live]), np.array([p_dn_live]), p_star)[0]
    last = df.iloc[-1]
    print("deployment check on the last bar only (it is inside the test window, not an extra score)", flush=True)
    print("live %s close %.0f p_up %.2f at_least %+.2f at_most %+.2f call %s" % (
        pd.Timestamp(last["time"]).strftime("%Y-%m-%d %H:%M"),
        last["close"], p_live, lo_live, hi_live, live_call), flush=True)

    for note in notes:
        print("note %s" % note, flush=True)
    print("RESULT reached_75 %s" % reached, flush=True)

    os.makedirs(cfg.out_dir, exist_ok=True)
    torch.save(best_state, os.path.join(cfg.out_dir, "model.pt"))
    np.savez(
        os.path.join(cfg.out_dir, "scaler.npz"),
        mean=scaler.mean_, scale=scaler.scale_,
        features=np.array(FEATURES), p_star=p_star, min_move=cfg.min_move,
    )
    out = pd.DataFrame({
        "time": pd.to_datetime(times).astype(str),
        "close": closes,
        "target_pct": test_y,
        "p_up": test_prob[:, 2],
        "p_down": test_prob[:, 0],
        "at_least_pct": test_lo,
        "at_most_pct": test_hi,
        "call": test_call,
    })
    out.to_csv(os.path.join(cfg.out_dir, "test_predictions.csv"), index=False)
    summary = {
        "version": "grok_edit_v1",
        "min_move_pct": cfg.min_move,
        "p_star": p_star,
        "epochs_ran": epochs_ran,
        "best_val_loss": best_vl,
        "last_train_loss": last_train,
        "n_train": int(len(train_idx)),
        "n_val": int(len(val_idx)),
        "n_test": int(len(test_idx)),
        "n_large_test": n_large,
        "gated": {k: num(v) for k, v in test_stats.items()},
        "ungated_sign_accuracy": num(ungated),
        "baselines": {k: num(v) for k, v in baselines.items()},
        "test_up_base_rate": num(up_rate),
        "test_down_base_rate": num(down_rate),
        "band_coverage_all_test": num(cover_all),
        "fake_breakout_share_of_missed_up": num(fake_share),
        "reached_75": reached,
        "notes": notes,
        "fees_included": False,
    }
    with open(os.path.join(cfg.out_dir, "metrics.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print("saved %s" % cfg.out_dir, flush=True)
    return summary


def main():
    cfg = CFG()
    if os.environ.get("SMOKE"):
        cfg.epochs = 1
        cfg.patience = 1
        cfg.days = 40
        cfg.seq_len = 16
        cfg.batch_size = 64
        cfg.hidden = 16
        cfg.layers = 1
        cfg.out_dir = "/tmp/grok_edit_v1_smoke"
    summary = train(cfg)
    if os.environ.get("SMOKE"):
        assert os.path.exists(os.path.join(cfg.out_dir, "metrics.json"))
        assert summary["n_test"] > 50
        print("smoke ok", flush=True)


if __name__ == "__main__":
    main()
