"""Record the shipped data sets (ideal, IBM Kingston noise model, generic noise). Run from the repository root: python tools/record.py  (needs qiskit, qiskit-aer, qiskit-ibm-runtime)"""
import os, sys, json, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from qiskit import transpile
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error, ReadoutError
from pricer import runner, circuits as C

runs = []
# 1. Ideal
sim = AerSimulator(seed_simulator=11)
runs.append(json.loads(runner.run_all(sim, 1000)) | {"backend": "Ideal simulator (Qiskit Aer, no noise)"})
# 2. IBM Kingston noise model
try:
    from qiskit_ibm_runtime.fake_provider import FakeKingston
    fk = AerSimulator.from_backend(FakeKingston(), seed_simulator=12)
    class Named:  # make _kind() see an IBM backend
        pass
    payload = json.loads(runner.run_all(fk, 1000))
    payload["backend"] = "IBM Kingston noise model (FakeKingston, Qiskit Aer)"
    runs.append(payload)
except Exception as e:
    print("kingston failed", e)
# 3. IonQ-like: depolarizing noise at IonQ Forte's published gate fidelities, all-to-all
nm = NoiseModel()
nm.add_all_qubit_quantum_error(depolarizing_error(1 - 0.9998, 1), ["rz", "sx", "x", "ry", "h"])
nm.add_all_qubit_quantum_error(depolarizing_error(1 - 0.995, 2), ["cx"])
nm.add_all_qubit_readout_error(ReadoutError([[0.995, 0.005], [0.005, 0.995]]))
ionq_like = AerSimulator(noise_model=nm, basis_gates=["cx", "rz", "sx", "x"], seed_simulator=13)
circs, meta = C.build_all()
t = transpile(circs, basis_gates=["cx", "rz", "sx", "x"], optimization_level=1, seed_transpiler=7)
res = ionq_like.run(t, shots=1000).result()
counts = {mt["id"]: runner._normalise(res.get_counts(i), 4) for i, mt in enumerate(meta)}
runs.append({"source": "recorded", "backend": "Generic noise model (99.5% two-qubit gates, all-to-all; Qiskit Aer)",
             "shots": 1000, "gateset": "abstract", "two_qubit_sent": {mt["id"]: sum(1 for x in q.data if x.operation.num_qubits == 2) for q, mt in zip(t, meta)},
             "recorded_at": "2026-10-12", "counts": counts})
for r in runs:
    r["source"] = "recorded"
    r["recorded_at"] = "2026-10-12"
    print(r["backend"], {k: (v.get("1", 0) if False else sum(c for key, c in v.items() if key[3] == "1")) for k, v in r["counts"].items()}, r.get("two_qubit_sent"))
runs[0]["two_qubit_sent"] = {}
json.dump(runs, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "recorded_runs.json"), "w"), separators=(",", ":"))
