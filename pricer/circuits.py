"""
The circuits of amplitude estimation, four qubits each.

Qubits 0-2 hold the stock price (qubit 0 is the least significant bit);
qubit 3 is the payoff qubit.

  A    loads the 8-point price distribution, then rotates the payoff qubit by
       an angle set by each price's payoff, so that P(payoff qubit = 1) is
       exactly a = E[payoff] / max payoff.
  Q    the Grover step  A S0 A^dagger S_chi : one reflection about the "good"
       states (payoff qubit = 1) and one about the starting state. It rotates
       the state by 2*theta, where a = sin^2(theta).
  k    after A and k Grover steps, P(payoff qubit = 1) = sin^2((2k+1) theta).

Every rotation is a uniformly controlled RY, so the circuits are exact: the
only approximation is the 8-point price grid itself.
"""

import math

from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import UCRYGate

from . import market

KS = [0, 1, 2, 3, 4]      # Grover depths that are run
BASIS = ["cx", "rz", "sx", "x"]   # gates every Qollab backend accepts


def _ry_angle(p0):
    """RY angle that leaves probability p0 in |0>."""
    p0 = min(max(p0, 0.0), 1.0)
    return 2.0 * math.acos(math.sqrt(p0))


def a_operator(m=None):
    """A: load the price distribution on qubits 0-2, encode the payoff on qubit 3."""
    m = m or market.model()
    p = m["probs"]
    qc = QuantumCircuit(4, name="A")
    # Binary tree of uniformly controlled RY gates, most significant bit first.
    top = sum(p[i] for i in range(8) if not (i >> 2) & 1)
    qc.ry(_ry_angle(top), 2)
    mid = []
    for b2 in (0, 1):
        tot = sum(p[i] for i in range(8) if (i >> 2) & 1 == b2)
        zero = sum(p[i] for i in range(8) if (i >> 2) & 1 == b2 and not (i >> 1) & 1)
        mid.append(_ry_angle(zero / tot if tot else 1.0))
    qc.append(UCRYGate(mid), [1, 2])
    low = [0.0] * 4
    for b2 in (0, 1):
        for b1 in (0, 1):
            tot = sum(p[i] for i in range(8) if (i >> 2) & 1 == b2 and (i >> 1) & 1 == b1)
            zero = sum(p[i] for i in range(8) if (i >> 2) & 1 == b2 and (i >> 1) & 1 == b1 and not i & 1)
            low[b1 + 2 * b2] = _ry_angle(zero / tot if tot else 1.0)
    qc.append(UCRYGate(low), [0, 1, 2])
    # Payoff: P(qubit 3 = 1 | price i) = payoff_i / max payoff.
    angles = [2.0 * math.asin(math.sqrt(f / m["fmax"])) for f in m["payoff"]]
    qc.append(UCRYGate(angles), [3, 0, 1, 2])
    return qc.decompose(reps=3)


def grover_operator(A):
    """Q = A S0 A^dagger S_chi (up to a global phase)."""
    qc = QuantumCircuit(4, name="Q")
    qc.z(3)                                   # S_chi: flip the sign of payoff = 1
    qc.compose(A.inverse(), inplace=True)
    qc.x([0, 1, 2, 3])                        # S0: flip the sign of |0000>
    qc.h(3)
    qc.mcx([0, 1, 2], 3)
    qc.h(3)
    qc.x([0, 1, 2, 3])
    qc.compose(A, inplace=True)
    return qc


def _compact(qc):
    """Shrink a circuit (fewer CNOTs means less noise); no layout change, no routing."""
    return transpile(qc, basis_gates=BASIS, optimization_level=1, seed_transpiler=7)


def building_blocks(m=None):
    """A and Q, each compiled once to the common basis."""
    A = a_operator(m)
    return _compact(A), _compact(grover_operator(A))


def estimation_circuit(k, m=None, blocks=None):
    """A, then k Grover steps, then measure all four qubits."""
    A, Q = blocks or building_blocks(m)
    qc = QuantumCircuit(4, 4, name=f"ae_k{k}")
    qc.compose(A, inplace=True)
    for _ in range(k):
        qc.compose(Q, inplace=True)
    qc.measure(range(4), range(4))
    return qc


def build_all(m=None):
    m = m or market.model()
    blocks = building_blocks(m)
    circuits, meta = [], []
    for k in KS:
        circuits.append(estimation_circuit(k, m, blocks))
        meta.append({"id": f"k{k}", "k": k, "n_qubits": 4, "a_calls": 2 * k + 1})
    return circuits, meta
