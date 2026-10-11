// Small SVG charts for the pricing-calculator page: lines, points with error bars,
// linear or log axes. Every chart carries a text description for screen readers.
import { s } from './dom.js';

function scaleOf(axis, a, b) {
  const { min, max, log } = axis;
  if (log) {
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    return (v) => a + ((Math.log10(Math.max(v, min * 1e-3)) - l0) / (l1 - l0)) * (b - a);
  }
  return (v) => a + ((v - min) / (max - min)) * (b - a);
}

function ticksOf(axis) {
  if (axis.ticks) return axis.ticks;
  if (axis.log) {
    const out = [];
    for (let e = Math.ceil(Math.log10(axis.min)); e <= Math.floor(Math.log10(axis.max)); e++) out.push(10 ** e);
    return out;
  }
  const n = 5;
  return Array.from({ length: n + 1 }, (_, i) => axis.min + ((axis.max - axis.min) * i) / n);
}

function fmtTick(v, axis) {
  if (axis.format) return axis.format(v);
  if (axis.log) return v >= 1000 ? `${v / 1000}k` : String(v);
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
}

/**
 * plot({ width, height, x, y, series, vlines, label })
 * x, y: { min, max, log, title, ticks, format }
 * series: [{ kind: 'line'|'points', data: [[x, y], ...], cls, dash, err: [[lo, hi], ...], label }]
 * vlines: [{ x, cls, label }]
 */
export function plot({ width = 560, height = 300, x, y, series = [], vlines = [], label }) {
  const pad = { l: 58, r: 16, t: 16, b: 44 };
  const X = scaleOf(x, pad.l, width - pad.r);
  const Y = scaleOf(y, height - pad.b, pad.t);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'plot', role: 'img', 'aria-label': label || '' });
  const grid = s('g', { class: 'plot-grid' });
  for (const t of ticksOf(x)) {
    grid.append(s('line', { x1: X(t), x2: X(t), y1: pad.t, y2: height - pad.b }));
    grid.append(s('text', { x: X(t), y: height - pad.b + 18, 'text-anchor': 'middle', class: 'tick', text: fmtTick(t, x) }));
  }
  for (const t of ticksOf(y)) {
    grid.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t) }));
    grid.append(s('text', { x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick', text: fmtTick(t, y) }));
  }
  svg.append(grid);
  svg.append(s('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b, class: 'plot-frame' }));
  if (x.title) svg.append(s('text', { x: (pad.l + width - pad.r) / 2, y: height - 6, 'text-anchor': 'middle', class: 'axis-title', text: x.title }));
  if (y.title) {
    svg.append(s('text', {
      x: 14, y: (pad.t + height - pad.b) / 2, 'text-anchor': 'middle', class: 'axis-title',
      transform: `rotate(-90 14 ${(pad.t + height - pad.b) / 2})`, text: y.title,
    }));
  }
  const clipId = `clip${Math.random().toString(36).slice(2, 8)}`;
  const clip = s('clipPath', { id: clipId }, s('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b }));
  svg.append(s('defs', {}, clip));
  const body = s('g', { 'clip-path': `url(#${clipId})` });
  for (const v of vlines) {
    body.append(s('line', { x1: X(v.x), x2: X(v.x), y1: pad.t, y2: height - pad.b, class: `vline ${v.cls || ''}` }));
  }
  for (const ser of series) {
    if (ser.kind === 'line') {
      const d = ser.data
        .filter((p) => Number.isFinite(p[1]))
        .map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`)
        .join('');
      body.append(s('path', { d, class: `series ${ser.cls || ''}`, 'stroke-dasharray': ser.dash || null }));
    } else {
      ser.data.forEach((p, i) => {
        if (ser.err && ser.err[i]) {
          const [lo, hi] = ser.err[i];
          body.append(s('line', { x1: X(p[0]), x2: X(p[0]), y1: Y(lo), y2: Y(hi), class: `errbar ${ser.cls || ''}` }));
        }
        body.append(s(ser.shape === 'square' ? 'rect' : 'circle', ser.shape === 'square'
          ? { x: X(p[0]) - 4.5, y: Y(p[1]) - 4.5, width: 9, height: 9, class: `dot ${ser.cls || ''}` }
          : { cx: X(p[0]), cy: Y(p[1]), r: 5, class: `dot ${ser.cls || ''}` }));
      });
    }
  }
  svg.append(body);
  for (const v of vlines) {
    if (v.label) svg.append(s('text', { x: X(v.x) + 5, y: pad.t + 14, class: `vlabel ${v.cls || ''}`, text: v.label }));
  }
  return svg;
}

// Bars for the 8-point price model, payoff printed above each bar, and
// optional measured frequencies as dots.
export function distribution(model, measured) {
  const width = 560;
  const height = 260;
  const pad = { l: 46, r: 12, t: 30, b: 50 };
  const n = model.probs.length;
  const bw = (width - pad.l - pad.r) / n;
  const top = Math.max(...model.probs, ...(measured || [0])) * 1.12;
  const Y = (v) => height - pad.b - (v / top) * (height - pad.t - pad.b);
  const label = `Probability of each of the 8 prices; the option pays only in the top four. ${measured ? 'Dots show the prices the quantum computer measured.' : ''}`;
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'plot', role: 'img', 'aria-label': label });
  for (const t of [0, 0.1, 0.2, 0.3]) {
    if (t > top) continue;
    svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t), class: 'plot-grid-line' }));
    svg.append(s('text', { x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick', text: `${Math.round(t * 100)}%` }));
  }
  model.probs.forEach((p, i) => {
    const x = pad.l + i * bw + 6;
    const pays = model.payoff[i] > 0;
    svg.append(s('rect', { x, y: Y(p), width: bw - 12, height: Y(0) - Y(p), class: pays ? 'bar pays' : 'bar' }));
    svg.append(s('text', { x: x + (bw - 12) / 2, y: height - pad.b + 18, 'text-anchor': 'middle', class: 'tick', text: `$${model.prices[i].toFixed(0)}` }));
    svg.append(s('text', {
      x: x + (bw - 12) / 2, y: Y(p) - 8, 'text-anchor': 'middle', class: pays ? 'bar-label pays' : 'bar-label',
      text: pays ? `+$${model.payoff[i] < 1 ? model.payoff[i].toFixed(2) : model.payoff[i].toFixed(0)}` : '$0',
    }));
    if (measured) svg.append(s('circle', { cx: x + (bw - 12) / 2, cy: Y(measured[i]), r: 5, class: 'dot measured' }));
  });
  svg.append(s('text', { x: (pad.l + width - pad.r) / 2, y: height - 8, 'text-anchor': 'middle', class: 'axis-title', text: 'Stock price in 3 months (average of each bucket)' }));
  return svg;
}
