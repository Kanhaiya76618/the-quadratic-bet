// Reading the answer out of the shots.
//
// After A and k Grover steps, the payoff qubit reads 1 with probability
// sin^2((2k+1) theta), and the price is  discount * max payoff * sin^2(theta).
// Maximum-likelihood amplitude estimation (Suzuki et al., 2020) picks the
// theta that makes the measured hits most likely, over all depths at once.
// The noise-aware version (after Tanaka et al., 2021) also fits f, the share
// of the signal that survives each call of A:
//     P(1) = f^m sin^2(m theta) + (1 - f^m) / 2,   m = 2k + 1.

const HALF_PI = Math.PI / 2;
const THETAS = 2400;
const FS = [];
for (let f = 0.5; f <= 1.00001; f += 0.0025) FS.push(Math.min(f, 1));

export function hitsOf(run, ks) {
  const out = [];
  for (const k of ks) {
    const c = run && run.counts ? run.counts[`k${k}`] : null;
    if (!c) continue;
    let hits = 0;
    let shots = 0;
    for (const key in c) {
      shots += c[key];
      if (key[3] === '1') hits += c[key];
    }
    out.push({ k, m: 2 * k + 1, hits, shots });
  }
  return out;
}

function logLik(data, theta, f) {
  let L = 0;
  for (const d of data) {
    const s = Math.sin(d.m * theta) ** 2;
    const F = f ** d.m;
    let p = F * s + (1 - F) / 2;
    p = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
    L += d.hits * Math.log(p) + (d.shots - d.hits) * Math.log(1 - p);
  }
  return L;
}

// Returns { a, theta, f, lo, hi, curve } where curve is the (profile)
// log-likelihood over theta, and [lo, hi] is a 95% interval on a.
export function mlae(data, noiseAware = false) {
  if (!data.length) return null;
  const fs = noiseAware ? FS : [1];
  const curve = new Float64Array(THETAS);
  const bestF = new Float64Array(THETAS);
  let max = -Infinity;
  let arg = 0;
  for (let i = 0; i < THETAS; i++) {
    const theta = ((i + 0.5) / THETAS) * HALF_PI;
    let bl = -Infinity;
    let bf = 1;
    for (const f of fs) {
      const L = logLik(data, theta, f);
      if (L > bl) { bl = L; bf = f; }
    }
    curve[i] = bl;
    bestF[i] = bf;
    if (bl > max) { max = bl; arg = i; }
  }
  // Profile-likelihood 95% interval: every theta within 1.92 of the maximum.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < THETAS; i++) {
    if (curve[i] >= max - 1.92) {
      const a = Math.sin(((i + 0.5) / THETAS) * HALF_PI) ** 2;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  }
  const theta = ((arg + 0.5) / THETAS) * HALF_PI;
  return { theta, a: Math.sin(theta) ** 2, f: bestF[arg], lo, hi, curve, max };
}

export function thetaAt(i) {
  return ((i + 0.5) / THETAS) * HALF_PI;
}

export const THETA_POINTS = THETAS;

// Wilson 95% interval for a proportion.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

// Fisher information about theta carried by one shot at depth k (m = 2k+1),
// when each call of A keeps a share f of the signal.
function fisher(theta, m, f) {
  const F = f ** m;
  const s = Math.sin(m * theta) ** 2;
  const p = Math.min(Math.max(F * s + (1 - F) / 2, 1e-9), 1 - 1e-9);
  const dp = F * m * Math.sin(2 * m * theta);
  return (dp * dp) / (p * (1 - p));
}

// Expected error (one standard deviation, in $) after spending `calls` calls
// of A, for Monte Carlo and for amplitude estimation with the schedule
// k = 0, 1, 2, 4, 8, ... and `perDepth` shots at each depth.
export function scaling(model, f = 1, perDepth = 100) {
  const scale = model.discount * model.fmax;
  const theta = model.theta;
  const ks = [0, 1, 2, 4, 8, 16, 32, 64, 128];
  const points = [];
  let calls = 0;
  let info = 0;
  for (const k of ks) {
    const m = 2 * k + 1;
    calls += perDepth * m;
    info += perDepth * fisher(theta, m, f);
    // Var(a) = (da/dtheta)^2 / I = sin^2(2 theta) / I
    const err = (Math.abs(Math.sin(2 * theta)) / Math.sqrt(info)) * scale;
    points.push({ k, calls, err });
  }
  return points;
}

export function monteCarloError(model, calls) {
  return (model.discount * model.payoff_std) / Math.sqrt(calls);
}

// Draw n samples of the payoff from the 8-point model; returns the price estimate.
export function monteCarlo(model, n, rand = Math.random) {
  const cum = [];
  let acc = 0;
  for (const p of model.probs) { acc += p; cum.push(acc); }
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    const r = rand() * acc;
    let j = 0;
    while (j < cum.length - 1 && r > cum[j]) j++;
    const f = model.payoff[j];
    sum += f;
    sum2 += f * f;
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(sum2 / n - mean * mean, 0));
  return { price: model.discount * mean, half: (1.96 * model.discount * sd) / Math.sqrt(n) };
}
