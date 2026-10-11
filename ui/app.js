// The Quadratic Bet: the page. Python (pricer/) builds and runs the circuits;
// everything you see is computed here from the counts of a run.
import { h, replace } from './dom.js';
import { plot, distribution } from './charts.js';
import { hitsOf, mlae, thetaAt, THETA_POINTS, wilson, scaling, monteCarloError, monteCarlo } from './estimate.js';

const money = (x, d = 2) => (Number.isFinite(x) ? `$${x.toFixed(d)}` : '—');
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : '—');
const int = (x) => Math.round(x).toLocaleString('en-US');

// A small seeded generator, so a Monte Carlo draw does not jump on every redraw.
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function runLabel(run) {
  const kind = run.source === 'live' ? 'This session' : 'Recorded';
  return `${kind}: ${run.backend} · ${run.shots} shots per depth`;
}

export async function start(root, bridge) {
  const state = {
    info: null,
    runs: [],
    current: 0,
    ks: new Set([0, 1, 2, 3, 4]),
    mcExp: 3,
    mcSeed: 1,
    liveDone: false,
    drawings: {},
    drawK: 1,
  };

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, 'Loading the option and the circuits…');
  const select = h('select', { id: 'dataset', 'aria-describedby': 'dataset-help' });
  const masthead = h('header', { class: 'masthead' },
    h('div', { class: 'brand' },
      h('p', { class: 'kicker' }, 'Quantum Impact · finance'),
      h('h1', {}, 'The Quadratic Bet'),
      h('p', { class: 'lede' },
        'Banks price options by Monte Carlo: simulate thousands of futures and average the payoff. ',
        'Quantum amplitude estimation promises the same accuracy with quadratically fewer samples. ',
        'This page prices a real option both ways, on real circuits, and keeps the noise in.')),
    h('div', { class: 'picker' },
      h('label', { for: 'dataset' }, 'Data set'),
      select,
      h('p', { id: 'dataset-help', class: 'help' }, `Backend chosen in Select QPU: ${bridge.backendName}`)));

  const sections = {
    option: h('section', { class: 'card', 'aria-labelledby': 'h-option' }),
    mc: h('section', { class: 'card', 'aria-labelledby': 'h-mc' }),
    quantum: h('section', { class: 'card', 'aria-labelledby': 'h-quantum' }),
    answer: h('section', { class: 'card', 'aria-labelledby': 'h-answer' }),
    scale: h('section', { class: 'card', 'aria-labelledby': 'h-scale' }),
    run: h('section', { class: 'card', 'aria-labelledby': 'h-run' }),
  };
  const footer = h('footer', { class: 'footer' },
    h('p', {}, 'This effort is supported by Qollab & IonQ.'),
    h('p', { class: 'help' }, 'Open source under the MIT license. Built during the Qollab × IonQ Global Quantum Hackathon, October 2026.'));

  replace(root, masthead, status, ...Object.values(sections), footer);

  select.addEventListener('change', () => {
    state.current = Number(select.value);
    render();
  });

  function setStatus(text) {
    status.textContent = text;
  }

  function fillSelect() {
    replace(select, state.runs.map((r, i) => h('option', { value: i, selected: i === state.current }, runLabel(r))));
  }

  // ------------------------------------------------------------------ data
  try {
    state.info = await bridge.info();
    for (const k of [0, 1, 2]) {
      try { state.drawings[k] = await bridge.drawing(k); } catch (e) { /* drawings are a convenience */ }
    }
    const recorded = await bridge.recorded();
    state.runs = Array.isArray(recorded) ? recorded : [];
  } catch (err) {
    setStatus(`Could not load the project data: ${err}`);
    return;
  }
  const model = state.info.model;
  fillSelect();
  render();

  if (bridge.autoRun) {
    await runLive(bridge.defaultShots);
  } else {
    setStatus(`${bridge.backendName} is real hardware and spends credits, so this project sends nothing to it. Showing recorded runs; choose IonQ Forte 1 (simulator) to run on IonQ.`);
  }

  async function runLive(shots) {
    setStatus(bridge.oneJob
      ? `Sending one job to ${bridge.backendName}: Grover depths 0 to 2 side by side in one 12-qubit circuit, ${shots} shots. IonQ simulates every shot, so this can take a few minutes…`
      : `Sending one job: 5 circuits (Grover depth 0 to 4), ${shots} shots each, to ${bridge.backendName}…`);
    try {
      const live = await bridge.run(shots);
      state.runs = [live, ...state.runs.filter((r) => r.source !== 'live')];
      state.current = 0;
      state.liveDone = true;
      fillSelect();
      render();
      let msg = `Done: ${bridge.backendName}, ${live.shots} shots per depth${live.gateset === 'native' ? ', sent in IonQ native gates' : ''}.`;
      if (bridge.autoSave) {
        try {
          await bridge.save(live);
          msg += ' A copy of the counts is offered as quadratic_bet_run.json.';
        } catch (e) { /* saving is a convenience */ }
      }
      setStatus(msg);
    } catch (err) {
      state.liveDone = true;
      render();
      const lines = String(err).trim().split('\n').filter((l) => l.trim());
      const reason = (lines[lines.length - 1] || String(err)).slice(0, 400);
      setStatus(`The run did not finish: ${reason} The recorded runs below still work.`);
    }
  }

  // ---------------------------------------------------------------- render
  function render() {
    const run = state.runs[state.current];
    renderOption(run);
    renderMC();
    renderQuantum(run);
    renderAnswer(run);
    renderScale(run);
    renderRun();
  }

  function renderOption(run) {
    let measured = null;
    const c = run && run.counts && run.counts.k0;
    if (c) {
      measured = new Array(8).fill(0);
      let n = 0;
      for (const key in c) {
        const i = Number(key[0]) + 2 * Number(key[1]) + 4 * Number(key[2]);
        measured[i] += c[key];
        n += c[key];
      }
      measured = measured.map((v) => v / n);
    }
    replace(sections.option,
      h('h2', { id: 'h-option' }, '1 · The bet: a call option'),
      h('div', { class: 'two' },
        h('div', {},
          h('p', {}, 'The right, not the obligation, to buy a stock at a fixed price in three months. It pays only if the stock ends above the strike. What is that right worth today?'),
          h('dl', { class: 'terms' },
            h('dt', {}, 'Stock today'), h('dd', {}, money(model.spot, 0)),
            h('dt', {}, 'Strike'), h('dd', {}, money(model.strike, 0)),
            h('dt', {}, 'Volatility'), h('dd', {}, pct(model.vol, 0), ' a year'),
            h('dt', {}, 'Maturity'), h('dd', {}, '3 months'),
            h('dt', {}, 'Interest rate'), h('dd', {}, pct(model.rate, 0), ' a year')),
          h('p', { class: 'callout' }, 'Fair price (Black–Scholes): ', h('strong', {}, money(model.price_exact, 3))),
          h('p', { class: 'help' },
            'Both methods below estimate this number from the same 8-bucket price model. ',
            'Each bucket carries its probability and its average payoff, so the 8-bucket model gives exactly the Black–Scholes price.')),
        h('figure', {},
          distribution(model, measured),
          h('figcaption', {}, measured
            ? 'Bars: the price model. Dots: prices the quantum computer measured after loading it (depth 0 circuit).'
            : 'The price model: the option pays in the four highest buckets.'))));
  }

  function renderMC() {
    const n = Math.round(10 ** state.mcExp);
    const draw = monteCarlo(model, n, seeded(state.mcSeed * 7919 + n));
    const slider = h('input', {
      type: 'range', id: 'mc-n', min: 1, max: 5, step: 0.5, value: state.mcExp,
      'aria-valuetext': `${int(n)} samples`,
    });
    slider.addEventListener('input', () => {
      state.mcExp = Number(slider.value);
      renderMC();
      document.getElementById('mc-n').focus();
    });
    const again = h('button', { type: 'button', class: 'btn' }, 'Draw again');
    again.addEventListener('click', () => {
      state.mcSeed += 1;
      renderMC();
    });
    const err = draw.price - model.price_exact;
    replace(sections.mc,
      h('h2', { id: 'h-mc' }, '2 · The classical way: Monte Carlo'),
      h('p', {}, 'Simulate the stock many times, average the payoff, discount it. Simple and universal, which is why banks run it on huge clusters every night.'),
      h('div', { class: 'mc-row' },
        h('label', { for: 'mc-n' }, `Samples: ${int(n)}`),
        slider,
        again),
      h('p', { class: 'result classical' },
        `${money(draw.price, 3)} ± ${money(draw.half, 3)} (95%) from ${int(n)} samples, `,
        h('span', { class: 'help' }, `${err >= 0 ? '+' : '−'}${money(Math.abs(err), 3)} from the fair price.`)),
      h('p', { class: 'rule' }, 'The catch: the error shrinks only like 1/√N. Ten times the precision costs a hundred times the samples.'));
  }

  function renderQuantum(run) {
    const ks = state.info.ks;
    const data = hitsOf(run, ks);
    const aware = mlae(data, true);
    const curve = [];
    for (let x = 0; x <= 4.25; x += 0.02) curve.push([x, Math.sin((2 * x + 1) * model.theta) ** 2]);
    const pts = data.map((d) => [d.k, d.hits / d.shots]);
    const errs = data.map((d) => wilson(d.hits, d.shots));
    const fit = aware ? data.map((d) => {
      const F = aware.f ** d.m;
      return [d.k, F * Math.sin(d.m * aware.theta) ** 2 + (1 - F) / 2];
    }) : [];
    const chart = plot({
      width: 560, height: 280,
      x: { min: -0.3, max: 4.3, ticks: [0, 1, 2, 3, 4], format: (v) => `k=${v}`, title: 'Grover steps k' },
      y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], format: (v) => `${Math.round(v * 100)}%`, title: 'P(payoff qubit = 1)' },
      series: [
        { kind: 'line', data: curve, cls: 'q-ideal' },
        { kind: 'points', data: fit, cls: 'q-fit', shape: 'square' },
        { kind: 'points', data: pts, err: errs, cls: 'q' },
      ],
      label: `Measured probability of reading 1 at each Grover depth, against the ideal curve sin squared of (2k+1) theta. ${data.map((d) => `k=${d.k}: ${pct(d.hits / d.shots)}`).join(', ')}.`,
    });
    const sent = (run && run.two_qubit_sent) || {};
    const rows = state.info.sizes.map((sz) => {
      const d = data.find((x) => x.k === sz.k);
      const ideal = Math.sin((2 * sz.k + 1) * model.theta) ** 2;
      return h('tr', {},
        h('th', { scope: 'row' }, String(sz.k)),
        h('td', {}, String(sz.a_calls)),
        h('td', {}, String(sent[`k${sz.k}`] ?? sz.two_qubit)),
        h('td', {}, d ? pct(d.hits / d.shots) : '—'),
        h('td', {}, pct(ideal)));
    });
    replace(sections.quantum,
      h('h2', { id: 'h-quantum' }, '3 · The quantum way: amplitude estimation'),
      h('ol', { class: 'steps' },
        h('li', {}, h('strong', {}, 'Load the future. '), 'Three qubits hold the 8 possible prices, in superposition, with the model\'s probabilities.'),
        h('li', {}, h('strong', {}, 'Write the payoff into a qubit. '), 'A fourth qubit is rotated by an angle set by each price\'s payoff, so it reads 1 with probability a = price ÷ (discount × max payoff). Together these are the circuit A.'),
        h('li', {}, h('strong', {}, 'Amplify. '), 'A Grover step Q (two reflections) turns the state by 2θ, where a = sin²θ. After k steps the qubit reads 1 with probability sin²((2k+1)θ): it swings faster with every step, so each shot pins θ down more sharply.')),
      h('div', { class: 'two' },
        h('figure', {}, chart,
          h('figcaption', {}, 'Line: ideal sin²((2k+1)θ). Circles: measured, with 95% intervals. Squares: the noise-aware fit below.')),
        h('div', {},
          h('table', { class: 'table' },
            h('caption', {}, 'The circuits of one run'),
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Depth k'),
              h('th', { scope: 'col' }, 'Calls of A'),
              h('th', { scope: 'col' }, 'Two-qubit gates'),
              h('th', { scope: 'col' }, 'Measured P(1)'),
              h('th', { scope: 'col' }, 'Ideal P(1)'))),
            h('tbody', {}, rows)),
          h('p', { class: 'help' },
            Object.keys(sent).length
              ? `Two-qubit gates as sent to ${run.backend}${run.gateset === 'native' ? ' (IonQ native ZZ/MS gates)' : ' (after mapping to the device)'}.`
              : 'Two-qubit gates (CNOTs) of the compiled circuits before any device mapping.'),
          h('p', { class: 'help' }, 'On IonQ, depths 0 to 2 run side by side as one 12-qubit circuit in one job. Jobs sent from Qollab must stay small, and depths 3 and 4 would be mostly noise there anyway.'))));
  }

  function estimateCards(run) {
    const ks = [...state.ks].sort();
    const data = hitsOf(run, ks);
    const plain = mlae(data, false);
    const aware = mlae(data, true);
    const calls = data.reduce((s2, d) => s2 + d.shots * d.m, 0);
    return { data, plain, aware, calls };
  }

  function renderAnswer(run) {
    const scale = model.discount * model.fmax;
    const { data, plain, aware, calls } = estimateCards(run);
    const boxes = state.info.ks.map((k) => {
      const id = `use-k${k}`;
      const box = h('input', { type: 'checkbox', id, checked: state.ks.has(k) });
      box.addEventListener('change', () => {
        if (box.checked) state.ks.add(k);
        else if (state.ks.size > 1) state.ks.delete(k);
        else box.checked = true;
        renderAnswer(run);
        renderScale(run);
        document.getElementById(id).focus();
      });
      return h('label', { class: 'check', for: id }, box, ` k = ${k}`);
    });

    let body;
    if (!plain) {
      body = h('p', {}, 'This data set has no counts for the chosen depths.');
    } else {
      const lines = [];
      const lo = Math.max(0, model.price_exact * 0.7);
      const hi = model.price_exact * 1.3;
      for (const [est, cls] of [[plain, 'q'], [aware, 'q-alt']]) {
        const pts = [];
        for (let i = 0; i < THETA_POINTS; i += 2) {
          const price = scale * Math.sin(thetaAt(i)) ** 2;
          if (price < lo || price > hi) continue;
          pts.push([price, Math.exp(est.curve[i] - est.max)]);
        }
        pts.sort((a, b) => a[0] - b[0]);
        lines.push({ kind: 'line', data: pts, cls, dash: cls === 'q-alt' ? '6 4' : null });
      }
      const mc = monteCarlo(model, calls, seeded(4242 + calls));
      const inside = (e) => model.price_exact >= scale * e.lo && model.price_exact <= scale * e.hi;
      const card = (title, value, range, note, cls, ok) => h('div', { class: `est ${cls}` },
        h('p', { class: 'est-title' }, title),
        h('p', { class: 'est-value' }, value),
        h('p', { class: 'est-range' }, range),
        ok === undefined ? null : h('p', { class: `chip ${ok === 'wide' ? 'warn' : ok ? 'good' : 'bad'}` },
          ok === 'wide' ? '~ interval too wide to be useful' : ok ? '✓ interval contains the fair price' : '✗ interval misses the fair price'),
        h('p', { class: 'help' }, note));
      const offPlain = scale * plain.a - model.price_exact;
      // An interval wider than half the price says nothing useful.
      const wide = (e) => scale * (e.hi - e.lo) > 0.5 * model.price_exact;
      const status = (e) => (inside(e) ? (wide(e) ? 'wide' : true) : false);
      const awareNote = inside(aware)
        ? `The noise-aware fit (f = ${pct(aware.f, 1)}) gives ${money(scale * aware.lo)} to ${money(scale * aware.hi)}, which contains the fair price${wide(aware) ? `, but Monte Carlo with the same budget is far more precise (± ${money(mc.half)})` : ''}.`
        : '';
      let verdict;
      if (!inside(plain)) {
        verdict = `Noise makes the textbook estimate confidently wrong: it is off by ${offPlain >= 0 ? '+' : '−'}${money(Math.abs(offPlain))} with an interval that excludes the fair price. ${awareNote}`;
      } else if (wide(plain)) {
        verdict = `Noise has scrambled the deeper circuits: the textbook estimate is off by ${offPlain >= 0 ? '+' : '−'}${money(Math.abs(offPlain))} and its interval is too wide to be useful. ${awareNote}`;
      } else {
        verdict = 'The textbook estimate is right on this data set: its interval contains the fair price.';
      }
      body = h('div', {},
        h('div', { class: 'two' },
          h('figure', {},
            plot({
              width: 560, height: 260,
              x: { min: lo, max: hi, title: 'Option price ($)', format: (v) => `$${v.toFixed(0)}` },
              y: { min: 0, max: 1.05, ticks: [0, 0.5, 1], format: (v) => v.toFixed(1), title: 'Relative likelihood' },
              series: lines,
              vlines: [{ x: model.price_exact, cls: 'exact', label: 'fair price' }],
              label: `Likelihood of each option price given the measured shots. Textbook estimate ${money(scale * plain.a)}, noise-aware estimate ${money(scale * aware.a)}, fair price ${money(model.price_exact)}.`,
            }),
            h('figcaption', {}, 'Solid: textbook maximum likelihood. Dashed: noise-aware. Every extra depth multiplies in its own likelihood, and the peak sharpens.')),
          h('div', { class: 'cards' },
            card('Amplitude estimation (textbook)', money(scale * plain.a, 3),
              `95%: ${money(scale * plain.lo)} to ${money(scale * plain.hi)}`,
              'Maximum likelihood over the chosen depths (Suzuki et al., 2020).', 'q', status(plain)),
            card('Amplitude estimation (noise-aware)', money(scale * aware.a, 3),
              `95%: ${money(scale * aware.lo)} to ${money(scale * aware.hi)}`,
              `Also fits f, the share of signal that survives each call of A: f = ${pct(aware.f, 1)}.`, 'q-alt', status(aware)),
            card('Monte Carlo, same budget', money(mc.price, 3),
              `95%: ± ${money(mc.half)}`,
              `${int(calls)} samples: one per call of A that the quantum run used.`, 'c'),
            card('Fair price', money(model.price_exact, 3), 'Black–Scholes, exact', 'The number every method is trying to hit.', 'exact'))),
        h('p', { class: 'verdict' }, verdict));
    }
    replace(sections.answer,
      h('h2', { id: 'h-answer' }, '4 · Reading the answer out of the shots'),
      h('p', {}, 'No single depth gives the price. Maximum-likelihood estimation asks which θ makes all the measured shots most likely. Untick depths to see how much each one adds.'),
      h('fieldset', { class: 'checks' }, h('legend', {}, 'Depths used'), boxes),
      body);
  }

  function renderScale(run) {
    const all = hitsOf(run, state.info.ks);
    const aware = mlae(all, true);
    const f = aware ? aware.f : 1;
    const ideal = scaling(model, 1);
    const noisy = scaling(model, f);
    const mcLine = [];
    for (let e = 2; e <= 5.01; e += 0.25) mcLine.push([10 ** e, monteCarloError(model, 10 ** e)]);
    const measured = [];
    const measuredErr = [];
    const plainPts = [];
    const scale = model.discount * model.fmax;
    for (let K = 1; K <= 4; K++) {
      const d = hitsOf(run, state.info.ks.filter((k) => k <= K));
      if (!d.length) continue;
      const calls = d.reduce((s2, x) => s2 + x.shots * x.m, 0);
      const a = mlae(d, true);
      const p = mlae(d, false);
      measured.push([calls, Math.max(Math.abs(scale * a.a - model.price_exact), 0.004)]);
      measuredErr.push(null);
      plainPts.push([calls, Math.max(Math.abs(scale * p.a - model.price_exact), 0.004)]);
    }
    const cross = ideal.find((p) => p.err < monteCarloError(model, p.calls));
    const last = ideal[ideal.length - 1];
    const gain = monteCarloError(model, last.calls) / last.err;
    const floor = noisy[noisy.length - 1].err;
    // Smallest per-call fidelity at which amplitude estimation still beats
    // Monte Carlo at the largest budget on the chart.
    let lo = 0.9;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const pts = scaling(model, mid);
      const end = pts[pts.length - 1];
      if (end.err < monteCarloError(model, end.calls)) hi = mid; else lo = mid;
    }
    const perGate = hi ** (1 / 21);
    const usefulDepth = f < 1 ? Math.max(0, Math.round((1 / (1 - f) - 1) / 2)) : null;
    replace(sections.scale,
      h('h2', { id: 'h-scale' }, '5 · Is it faster? The honest scaling'),
      h('p', {}, 'Error against cost, where cost is the number of times the model is evaluated: one Monte Carlo sample, or one call of A. Ideal amplitude estimation uses depths k = 0, 1, 2, 4, 8, … with 100 shots each.'),
      h('figure', {},
        plot({
          width: 760, height: 330,
          x: { min: 100, max: 100000, log: true, title: 'Cost: model evaluations (Monte Carlo samples or calls of A)' },
          y: { min: 0.003, max: 3, log: true, ticks: [0.01, 0.1, 1], format: (v) => `$${v}`, title: 'Price error' },
          series: [
            { kind: 'line', data: mcLine, cls: 'c' },
            { kind: 'line', data: ideal.map((p) => [p.calls, p.err]), cls: 'q' },
            { kind: 'line', data: noisy.map((p) => [p.calls, p.err]), cls: 'q-alt', dash: '6 4' },
            { kind: 'points', data: plainPts, cls: 'q-hollow' },
            { kind: 'points', data: measured, err: measuredErr, cls: 'q' },
          ],
          label: 'Log-log chart of price error against cost. Monte Carlo falls as one over square root of cost; ideal amplitude estimation falls as one over cost; with this data set\'s noise the quantum curve flattens.',
        }),
        h('figcaption', {},
          h('span', { class: 'key c' }, 'Monte Carlo (1/√N)'), ' ',
          h('span', { class: 'key q' }, 'ideal amplitude estimation (1/N)'), ' ',
          h('span', { class: 'key q-alt' }, `with this data set's noise (f = ${pct(f, 1)})`), ' ',
          h('span', { class: 'key dots' }, 'this run: noise-aware ● and textbook ○ errors'))),
      h('ul', { class: 'facts' },
        h('li', {}, cross
          ? `Ideal amplitude estimation overtakes Monte Carlo after about ${int(cross.calls)} evaluations and is ${gain.toFixed(0)}× more precise at ${int(last.calls)}. That is the quadratic bet.`
          : 'Ideal amplitude estimation does not overtake Monte Carlo on this range.'),
        h('li', {}, f < 0.9995
          ? `With this data set's noise, each call of A keeps only ${pct(f, 1)} of the signal. The error stops falling near ${money(floor)}: after about ${usefulDepth} Grover steps the signal is gone, and deeper circuits add noise, not information.`
          : 'This data set is noiseless, so nothing stops the quantum curve.'),
        h('li', {}, `To beat Monte Carlo at ${int(last.calls)} evaluations, each call of A must keep at least ${pct(hi, 2)} of the signal: about ${pct(perGate, 3)} per two-qubit gate for this circuit (about 21 per call). That is beyond today's physical gates, which is exactly the job of error correction.`)));
  }

  function renderRun() {
    // Qollab's Python runtime only lives while the run starts up, so
    // everything this section shows was fetched then: no button here needs
    // Python afterwards.
    const kSel = h('select', { id: 'draw-k' }, [0, 1, 2].map((k) => h('option', { value: k, selected: k === state.drawK }, `k = ${k}`)));
    const pre = h('pre', { class: 'drawing', tabindex: 0, 'aria-label': 'Circuit drawing' },
      state.drawings[state.drawK] || 'The circuit drawing loads when the project runs.');
    kSel.addEventListener('change', () => {
      state.drawK = Number(kSel.value);
      pre.textContent = state.drawings[state.drawK] || 'The circuit drawing loads when the project runs.';
    });
    replace(sections.run,
      h('h2', { id: 'h-run' }, '6 · Run it'),
      h('p', {}, `Backend: ${bridge.backendName}. Each press of Qollab's Run button sends one job to the backend chosen in Select QPU: on IonQ, depths 0 to 2 side by side as one 12-qubit circuit; elsewhere, all five circuits.`),
      h('p', { class: 'help' }, 'To run again or switch backend, press Run at the top of the project page. Runs on noisy backends are offered as quadratic_bet_run.json in the console.'),
      bridge.isHardware ? h('p', { class: 'help' }, 'This project never sends jobs to real hardware on its own, so your credits are safe. Choose IonQ Forte 1 (simulator) to run on IonQ\'s noise model.') : null,
      h('div', { class: 'run-row' }, h('label', { for: 'draw-k' }, 'Circuit: A followed by k Grover steps Q'), kSel),
      pre);
  }
}
