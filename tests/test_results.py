"""
Recompute the README's results table from data/recorded_runs.json, with the
same maximum-likelihood estimators the page uses (ui/estimate.js).

Run from the repository root:   python tests/test_results.py
Needs: numpy
"""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)

from pricer import market  # noqa: E402

THETAS = (np.arange(2400) + 0.5) / 2400 * (math.pi / 2)
FS = np.minimum(np.arange(0.5, 1.00001, 0.0025), 1.0)


def hits_of(run):
    out = []
    for k in range(5):
        c = run["counts"].get(f"k{k}")
        if c:
            out.append((2 * k + 1, sum(v for key, v in c.items() if key[3] == "1"), sum(c.values())))
    return out


def mlae(data, noise_aware):
    fs = FS if noise_aware else np.array([1.0])
    best = np.full(THETAS.shape, -np.inf)
    for f in fs:
        L = np.zeros_like(THETAS)
        for m, h, n in data:
            F = f ** m
            p = np.clip(F * np.sin(m * THETAS) ** 2 + (1 - F) / 2, 1e-12, 1 - 1e-12)
            L += h * np.log(p) + (n - h) * np.log(1 - p)
        best = np.maximum(best, L)
    i = int(np.argmax(best))
    inside = np.sin(THETAS[best >= best[i] - 1.92]) ** 2
    return np.sin(THETAS[i]) ** 2, inside.min(), inside.max()


def main():
    m = market.model()
    scale = m["discount"] * m["fmax"]
    with open(os.path.join(ROOT, "data", "recorded_runs.json")) as fh:
        runs = json.load(fh)
    print(f"Fair price ${m['price_exact']:.3f}")
    for run in runs:
        data = hits_of(run)
        calls = sum(mm * n for mm, _, n in data)
        mc = 1.96 * m["discount"] * m["payoff_std"] / math.sqrt(calls)
        row = [run["backend"]]
        for aware in (False, True):
            a, lo, hi = mlae(data, aware)
            ok = scale * lo <= m["price_exact"] <= scale * hi
            row.append(f"${scale * a:.2f} (${scale * lo:.2f}-${scale * hi:.2f}) {'contains' if ok else 'MISSES'}")
            if aware:
                assert ok, f"noise-aware interval must contain the fair price on {run['backend']}"
        row.append(f"Monte Carlo, same {calls} evaluations: +-${mc:.2f}")
        print(" | ".join(row))
    print("The noise-aware interval contains the fair price on every recorded data set.")


if __name__ == "__main__":
    main()
