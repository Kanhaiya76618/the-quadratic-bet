"""
The option and its price model.

A European call on a stock: the right to buy at the strike K in T years.
Its fair price is the discounted average payoff, e^(-rT) E[max(S_T - K, 0)],
with S_T log-normal (the Black-Scholes model). Both pricing methods here,
classical Monte Carlo and quantum amplitude estimation, estimate the same
8-point version of that model: three qubits hold 2^3 = 8 possible prices.
"""

import math

SPOT = 100.0       # today's stock price, $
STRIKE = 100.0     # strike, $ (at the money)
VOL = 0.30         # volatility, per year
RATE = 0.05        # risk-free rate, per year
MATURITY = 0.25    # years (3 months)
PRICE_QUBITS = 3
POINTS = 2 ** PRICE_QUBITS
WIDTH = 3.0        # the 8 prices cover +-3 standard deviations of log-price


def _phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black_scholes_call(spot=SPOT, strike=STRIKE, vol=VOL, rate=RATE, maturity=MATURITY):
    s = vol * math.sqrt(maturity)
    d1 = (math.log(spot / strike) + (rate + 0.5 * vol * vol) * maturity) / s
    d2 = d1 - s
    return spot * _phi(d1) - strike * math.exp(-rate * maturity) * _phi(d2)


def model(spot=SPOT, strike=STRIKE, vol=VOL, rate=RATE, maturity=MATURITY):
    """
    The 8-point price model, its payoff, and the exact answers.

    The log-price range is cut into 8 buckets (the outer two run to infinity).
    Each bucket carries its probability and its *average* payoff, so the
    8-point model gives exactly the Black-Scholes price: no grid error.
    """
    mu = math.log(spot) + (rate - 0.5 * vol * vol) * maturity
    s = vol * math.sqrt(maturity)
    lo, hi = mu - WIDTH * s, mu + WIDTH * s
    xs = [lo + (hi - lo) * i / (POINTS - 1) for i in range(POINTS)]
    step = xs[1] - xs[0]
    edges = [-math.inf] + [x + step / 2 for x in xs[:-1]] + [math.inf]
    lnk = math.log(strike)
    growth = math.exp(mu + 0.5 * s * s)          # E[S_T]

    def cdf(x, shift=0.0):
        if x == -math.inf:
            return 0.0
        if x == math.inf:
            return 1.0
        return _phi((x - mu - shift) / s)

    probs, prices, payoff = [], [], []
    for i in range(POINTS):
        a, b = edges[i], edges[i + 1]
        p = cdf(b) - cdf(a)
        mean_s = growth * (cdf(b, s * s) - cdf(a, s * s))      # E[S; bucket]
        lo_k = max(a, lnk)
        if lo_k < b:
            part = growth * (cdf(b, s * s) - cdf(lo_k, s * s)) - strike * (cdf(b) - cdf(lo_k))
        else:
            part = 0.0
        probs.append(p)
        prices.append(mean_s / p if p > 0 else math.exp(xs[i]))
        payoff.append(part / p if p > 0 else 0.0)
    fmax = max(payoff)
    mean = sum(p * f for p, f in zip(probs, payoff))
    second = sum(p * f * f for p, f in zip(probs, payoff))
    disc = math.exp(-rate * maturity)
    a = mean / fmax
    return {
        "spot": spot,
        "strike": strike,
        "vol": vol,
        "rate": rate,
        "maturity": maturity,
        "prices": prices,                     # average price in each bucket
        "probs": probs,
        "payoff": payoff,                     # average payoff in each bucket
        "fmax": fmax,
        "discount": disc,
        "amplitude": a,                       # the number the quantum computer estimates
        "theta": math.asin(math.sqrt(a)),
        "price_exact": disc * mean,           # equals the Black-Scholes price
        "price_bs": black_scholes_call(spot, strike, vol, rate, maturity),
        "payoff_std": math.sqrt(max(second - mean * mean, 0.0)),
    }
