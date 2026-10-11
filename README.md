# The Quadratic Bet: Quantum Option Pricing, Noise Included

**Prices a stock option two ways, with classical Monte Carlo and with quantum amplitude estimation, on real Qiskit circuits. It shows where the promised quadratic speedup comes from, how today's noise breaks it, and how a noise-aware estimator still recovers the right price.**

*This effort is supported by Qollab & IonQ.*

Theme: **Quantum Impact** (a real finance workload, solved with quantum and classical computing together).

---

## Why this matters

Banks price options and measure risk with Monte Carlo: simulate many possible futures, average the payoff. It is simple and universal, and it is slow. The error falls only like 1/√N, so ten times the precision costs a hundred times the samples, and banks run these simulations on large clusters every night.

Quantum amplitude estimation is one of the most cited reasons the finance industry invests in quantum computing. In principle its error falls like 1/N: the same precision with quadratically fewer evaluations of the model. This project puts that bet on a real option, runs it on real circuits (including IonQ's), and reports the result honestly, noise included.

## What you can do on the page

1. **The option.** A 3-month call on a $100 stock with 30% volatility. Its fair price is $6.583 (Black–Scholes). Dots on the chart show the prices the quantum computer measured after loading the price model.
2. **Monte Carlo.** Slide from 10 to 100,000 samples and watch the 1/√N rule.
3. **Amplitude estimation.** Five circuits, with 0 to 4 Grover steps. The chart shows the measured probability against the ideal sin²((2k+1)θ) curve. The table gives each circuit's two-qubit gate count on the backend you ran.
4. **Reading the answer.** Maximum-likelihood estimation combines all the depths. Untick depths to see how much each one adds. A textbook estimate and a noise-aware one are shown next to Monte Carlo with the same budget.
5. **The honest scaling.** A log-log chart of error against cost: Monte Carlo, ideal amplitude estimation, and amplitude estimation with the noise measured in your data set.
6. **Run it** on any Qollab backend, see the circuits, and save the counts.

## Results

Recorded data sets (`data/recorded_runs.json`), 1,000 shots at each depth k = 0 to 4. That is 25,000 calls of the model in total, so Monte Carlo gets 25,000 samples.

| Data set | Textbook estimate (95% interval) | Noise-aware estimate (95% interval) | Signal kept per call of A | Monte Carlo, same budget (95%) |
| --- | --- | --- | --- | --- |
| Ideal simulator | $6.51 ($6.44–$6.60) ✓ | $6.51 ($6.44–$6.60) ✓ | 100% | ±$0.12 |
| IBM Kingston noise model | $7.34 ($7.27–$7.41) ✗ | $6.56 ($6.40–$6.70) ✓ | 95.7% | ±$0.12 |
| Generic noise model, 99.5% two-qubit gates | $7.71 ($7.63–$7.75) ✗ | $6.58 ($6.35–$6.81) ✓ | 91.5% | ±$0.12 |
| IonQ Forte 1 simulator, forte-1 noise model (my run: 200 shots, depths 0–2) | $2.39 ($2.17–$27.21), too wide to use | $5.11 ($3.55–$7.05) ✓ | 75.5% | ±$0.44 (1,800 evaluations) |

Fair price: **$6.583**. ✓ = the interval contains it.

What this shows:

- **Without noise, the quantum estimate is tighter than Monte Carlo at the same cost** (±$0.08 against ±$0.12), and the gap grows with depth. With depths k = 0, 1, 2, 4, 8, … ideal amplitude estimation overtakes Monte Carlo after about 900 evaluations and is 7× more precise at 52,000.
- **With noise, the textbook estimator is confidently wrong.** On both noise models it is off by $0.76 to $1.12 (11–17%), with a narrow interval that excludes the fair price. For a pricing desk, a wrong answer that looks precise is the worst kind.
- **A noise-aware estimator fixes the bias.** It also fits f, the share of the signal that survives each call of the circuit A. Its interval contains the fair price on every data set, at the cost of a wider interval.
- **On IonQ's Forte 1 noise model**, each call of A keeps about 75% of the signal, so depths 1 and 2 are already mostly noise. The textbook estimate ($2.39) is useless, the noise-aware estimate ($5.11, interval $3.55–$7.05) still contains the fair price, and Monte Carlo with the same 1,800 evaluations is far more precise (±$0.44). On today's hardware noise, Monte Carlo wins, and the page says so.
- **Noise erases the speedup.** With f = 95.7%, the signal is gone after about 10 Grover steps, and the quantum error curve flattens above Monte Carlo's. Beating Monte Carlo at 52,000 evaluations needs f ≥ 98.8%, which for this circuit (about 21 two-qubit gates per call of A) means about 99.94% fidelity per two-qubit gate. That is beyond today's physical gates, and it is the job of error correction. (My other entry, *Syndrome: You Are the Decoder*, is about error correction.)

The IonQ row is my own run on Qollab (also in the Data set menu). Press **Run** with **IonQ Forte 1 (simulator)** to make a new one; the page fits f for it live.

## How it works

```
main.js               connects Qollab's `backend` to the page
pricer/market.py      the option, the 8-bucket price model, Black–Scholes
pricer/circuits.py    the circuits A and Q, and the five estimation circuits
pricer/runner.py      one-job runner, IonQ packing, recorded runs
ui/estimate.js        maximum likelihood (textbook and noise-aware), Monte Carlo, scaling
ui/app.js, charts.js  the page and its charts
data/recorded_runs.json  runs recorded earlier, so the page works before you run
tests/                checks: every circuit against the exact formula; the results table from the recorded runs
tools/record.py       re-records the data sets (Qiskit Aer, FakeKingston)
```

**The price model.** The stock price in 3 months is log-normal. Its log-price range (±3 standard deviations) is cut into 8 buckets, with the outer two running to infinity. Each bucket carries its probability and its *average* payoff (closed form for a log-normal), so the 8-bucket model gives exactly the Black–Scholes price, with no grid error.

**The circuit A (4 qubits, 14 CNOTs).** Three qubits are loaded with the 8 bucket probabilities, using a binary tree of uniformly controlled RY gates. A uniformly controlled RY then rotates the fourth qubit so that P(1 | bucket i) = payoff_i / max payoff. That makes P(1) = a exactly, with price = discount × max payoff × a.

**The Grover step Q = A S₀ A† S_χ.** One reflection about the "pays" states (a Z on the payoff qubit) and one about the start state (a multi-controlled Z). After k steps the payoff qubit reads 1 with probability sin²((2k+1)θ), where a = sin²θ. Every circuit is checked against this formula with an exact statevector (error below 10⁻¹⁴).

**Estimation.** Maximum-likelihood amplitude estimation (Suzuki et al., 2020) needs no phase estimation, only these five circuits and a classical maximisation. The noise-aware version models each call of A as keeping a share f of the signal: P(1) = f^m sin²(mθ) + (1 − f^m)/2, with m = 2k + 1 (after Tanaka et al., 2021). It fits θ and f together. Intervals come from the profile likelihood.

**Scaling.** The scaling curves use the Fisher information of each depth. Ideal: Var(θ̂) = 1 / Σ 4m²N. With noise, the same expression is computed for the noisy model at the fitted f. Monte Carlo uses the exact payoff variance of the model.

**One job per run.** On local simulators, the five circuits go into a single `backend.run([...])`. IonQ jobs on Qollab take one circuit, and the request must stay small: my first version sent all five depths in IonQ's native gates, a 500 KB request that was cut off in transit. So on IonQ the runner packs depths 0, 1 and 2 side by side into one **12-qubit circuit** (about 34 KB), lets IonQ compile it, and splits the bitstrings back apart. If IonQ refuses that, it falls back to depths 0 and 1. Depths 3 and 4 would be mostly noise on today's hardware anyway, and the noise-aware fit needs only three depths. The packing was checked offline against the exact probabilities. IBM noise models are compiled for the device at optimisation level 3 (18–212 two-qubit gates once routed, against 14–182 with all-to-all connectivity).

## Reproduce the checks

```
pip install qiskit qiskit-aer qiskit-ibm-runtime numpy
python tests/test_circuits.py   # every circuit matches sin^2((2k+1)θ) to 1e-9 with an exact statevector
python tests/test_results.py    # recomputes the Results table from data/recorded_runs.json
python tools/record.py          # re-records the three data sets
```

## How to run

1. Open the project in a recent **Chrome, Edge, Brave or Opera** (Safari cannot run Qollab projects yet).
2. Press **Run** and pick a backend in **Select QPU**:
   - **Built-in simulator**: free and instant, 1,000 shots per depth.
   - **IonQ Forte 1 (simulator)**: free, with IonQ's noise model. One job of one 12-qubit circuit (depths 0 to 2). 200 shots take a few minutes.
   - **IBM noise models**: free, simulated in your browser, 200 shots per depth.
   - **IonQ QPU**: the project sends nothing to real hardware, so no credits are spent. Use the IonQ simulator.
3. The page opens on the recorded data sets and switches to your run when it arrives. Runs on noisy backends are also offered as `quadratic_bet_run.json` in the console.

## Accessibility

Every chart has a text description, and every number it shows is also written in a table or a sentence. Controls are ordinary sliders, checkboxes, menus and buttons, with labels and visible focus. Status messages are announced in a live region. Classical and quantum results are labelled in words, not only by colour (orange against blue). The layout works on a phone.

## Limitations and next steps

- Four qubits and eight price buckets: a demonstration of the method, not a production pricer. Monte Carlo on a laptop beats it today, and the page says so.
- Next: more price qubits and path-dependent payoffs (Asian and barrier options), power-law depth schedules, error mitigation (zero-noise extrapolation on top of the noise-aware fit), and error-detected Grover steps.
- Published resource estimates put a practical advantage in derivative pricing at thousands of error-corrected logical qubits (Chakrabarti et al., 2021). The scaling chart shows why: the advantage lives at large depth, and depth is what noise takes away.

## References

- A. Montanaro, *Quantum speedup of Monte Carlo methods*, Proc. R. Soc. A 471 (2015).
- P. Rebentrost, B. Gupt, T. R. Bromley, *Quantum computational finance: Monte Carlo pricing of financial derivatives*, Phys. Rev. A 98 (2018).
- N. Stamatopoulos et al., *Option pricing using quantum computers*, Quantum 4, 291 (2020).
- Y. Suzuki et al., *Amplitude estimation without phase estimation*, Quantum Inf. Process. 19, 75 (2020).
- T. Tanaka et al., *Amplitude estimation via maximum likelihood on noisy quantum computer*, Quantum Inf. Process. 20, 293 (2021).
- S. Chakrabarti et al., *A threshold for quantum advantage in derivative pricing*, Quantum 5, 463 (2021).

## Disclosure

- **Starting points:** the idea of a finance wing comes from my earlier project **Quantum Odyssey** (github.com/Kanhaiya76618/Quantum-odyssey, MIT, built before this hackathon). Its "Arbitrage Compass" used a hand-tuned 3-qubit circuit; none of its code is reused here, and this pricer is new. The Qollab runner pattern (one job, IonQ packing) and the small DOM helpers are reused from my other entries in this hackathon, *Syndrome* and *The Locked Museum*. Everything here was written during the hackathon's build weekend (9 to 11 October 2026, ET).
- **AI assistance:** I used an AI assistant (Claude) to help write the code and this page. I chose the problem, ran it and checked the results.
- **Libraries:** Qiskit 2.x and Qiskit Aer (Apache 2.0, Aer only to record the noisy data sets offline), qiskit-ionq (Apache 2.0), fonts from Google Fonts (OFL).

## License

MIT. See `LICENSE`.

*This effort is supported by Qollab & IonQ.*
