"""
Check every circuit against the exact formula, with an exact statevector.

Run from the repository root:   python tests/test_circuits.py
Needs: qiskit
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from qiskit.quantum_info import Statevector  # noqa: E402

from pricer import circuits as C  # noqa: E402
from pricer import market  # noqa: E402


def main():
    m = market.model()
    assert abs(m["price_exact"] - m["price_bs"]) < 1e-9, "the 8-bucket model must give the Black-Scholes price"
    print(f"Fair price: ${m['price_exact']:.4f} (Black-Scholes ${m['price_bs']:.4f})")

    A, Q = C.building_blocks(m)
    reg, good = [0.0] * 8, 0.0
    for key, v in Statevector.from_instruction(A).probabilities_dict().items():
        bits = key[::-1]                      # qubit 0 first
        reg[int(bits[0]) + 2 * int(bits[1]) + 4 * int(bits[2])] += v
        if bits[3] == "1":
            good += v
    assert max(abs(a - b) for a, b in zip(reg, m["probs"])) < 1e-9, "A must load the price model"
    assert abs(good - m["amplitude"]) < 1e-9, "A must give P(1) = a"
    print(f"A loads the 8 prices and gives P(1) = a = {good:.6f}")

    for k in range(7):
        qc = C.estimation_circuit(k, m, (A, Q)).remove_final_measurements(inplace=False)
        probs = Statevector.from_instruction(qc).probabilities_dict()
        p1 = sum(v for key, v in probs.items() if key[0] == "1")
        want = math.sin((2 * k + 1) * m["theta"]) ** 2
        assert abs(p1 - want) < 1e-9, (k, p1, want)
        print(f"k={k}: P(1) = {p1:.6f}   sin^2((2k+1)theta) = {want:.6f}   CNOTs = {qc.count_ops().get('cx', 0)}")
    print("All circuits match the exact formula.")


if __name__ == "__main__":
    main()
