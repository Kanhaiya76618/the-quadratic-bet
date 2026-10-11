"""
Runs the amplitude-estimation circuits on the backend Qollab hands us.

One press of Run sends ONE job:
  * local simulators: the five circuits (Grover depth k = 0..4) in a single
    backend.run([...])
  * IonQ: one circuit only (what IonQ jobs on Qollab accept), and a small
    request: depths 0-2 are packed side by side into one 12-qubit circuit.

The estimation itself (maximum likelihood, plain and noise-aware) is done in
the page, so that it can be redone live as you include or drop depths.

Public functions (they return JSON strings for JavaScript):
  backend_label(backend)        readable backend name
  info()                        the option, its exact price, the circuits' sizes
  run_all(backend, shots)       build, run, count
  load_recorded()               runs recorded earlier, shipped with the project
  drawing(k)                    a text drawing of one circuit
  save_run(payload_json)        offer a run as a downloadable file
"""

import json
from datetime import datetime, timezone

from qiskit import QuantumCircuit, transpile

from . import circuits as C
from . import market

RECORDED_RUNS = "data/recorded_runs.json"
IONQ_DEPTHS = ([0, 1, 2], [0, 1])   # tried in order, one job each until one is accepted
_BUILT = {}


def _build():
    """Build the five circuits once per session."""
    if "all" not in _BUILT:
        _BUILT["all"] = C.build_all(market.model())
    return _BUILT["all"]


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------

def backend_label(backend):
    """Readable backend name, including the IonQ noise model if one is set."""
    name = getattr(backend, "name", None)
    if callable(name):
        name = name()
    name = str(name or type(backend).__name__)
    try:
        noise = getattr(backend.options, "noise_model", None)
        if noise and str(noise).lower() != "ideal":
            name = f"{name} ({noise} noise model)"
    except Exception:
        pass
    return name


def _kind(backend):
    label = (backend_label(backend) + " " + type(backend).__name__).lower()
    if "ionq" in label:
        return "ionq"
    if any(k in label for k in ("fake", "ibm", "aer")):
        return "ibm"
    return "local"


def pack(circuits, name="packed"):
    """Place circuits side by side in one wide circuit. Returns (circuit, offsets)."""
    total = sum(c.num_qubits for c in circuits)
    big = QuantumCircuit(total, total, name=name)
    offsets, off = [], 0
    for c in circuits:
        offsets.append(off)
        big.compose(c, qubits=list(range(off, off + c.num_qubits)),
                    clbits=list(range(off, off + c.num_clbits)), inplace=True)
        off += c.num_qubits
    return big, offsets


def _normalise(counts, width):
    """Qiskit bitstrings put qubit 0 last; flip to qubit 0 first."""
    out = {}
    for key, c in counts.items():
        k = str(key).replace(" ", "")
        if k.startswith("0x"):
            k = format(int(k, 16), f"0{width}b")
        k = k.zfill(width)[::-1]
        out[k] = out.get(k, 0) + int(c)
    return out


def _two_qubit(qc):
    return sum(1 for inst in qc.data if inst.operation.num_qubits == 2)


# --------------------------------------------------------------------------
# Information for the page
# --------------------------------------------------------------------------

def info():
    """The option, its exact price, and the size of each circuit."""
    m = market.model()
    circuits, meta = _build()
    sizes = [{"k": mt["k"], "a_calls": mt["a_calls"], "two_qubit": _two_qubit(qc), "depth": qc.depth()}
             for qc, mt in zip(circuits, meta)]
    return json.dumps({"model": m, "ks": C.KS, "sizes": sizes})


def drawing(k):
    """Text drawing of A followed by k Grover steps (A and Q drawn as boxes)."""
    k = int(k)
    A = C.a_operator()
    Q = C.grover_operator(A)
    qc = QuantumCircuit(4, 4, name=f"k={k}")
    qc.append(A.to_gate(label="A"), [0, 1, 2, 3])
    for _ in range(k):
        qc.append(Q.to_gate(label="Q"), [0, 1, 2, 3])
    qc.measure(range(4), range(4))
    try:
        return str(qc.draw(output="text", fold=-1))
    except Exception:
        return str(qc)


# --------------------------------------------------------------------------
# Running
# --------------------------------------------------------------------------

def run_all(backend, shots=1000):
    """Run the five circuits as ONE job and return the counts as JSON."""
    shots = int(shots)
    kind = _kind(backend)
    circuits, meta = _build()
    counts, sent = {}, {}
    gateset = "abstract"

    if kind == "ionq":
        # IonQ jobs on Qollab take one circuit, and the request has to stay
        # small: all five depths in IonQ's native gates came to about 500 KB
        # and was cut off in transit. So IonQ gets depths 0-2 side by side in
        # one 12-qubit circuit (about 34 KB) and compiles it itself; if that is
        # refused, depths 0-1 (about 14 KB). Deeper circuits would be mostly
        # noise on today's hardware anyway.
        result, errors, used = None, [], None
        for ks in IONQ_DEPTHS:
            chosen = [(qc, mt) for qc, mt in zip(circuits, meta) if mt["k"] in ks]
            big, offsets = pack([qc for qc, _ in chosen], name="quadratic_bet")
            try:
                result = backend.run(big, shots=shots).result()
                used = (chosen, offsets, big.num_qubits)
                break
            except Exception as err:
                msg = str(err).strip().splitlines()[-1] if str(err).strip() else repr(err)
                errors.append(f"depths {ks[0]}-{ks[-1]}: {type(err).__name__}: {msg}")
                print(f"IonQ did not run depths {ks}: {type(err).__name__}: {err}")
        if result is None:
            raise RuntimeError("IonQ did not run the job. " + " | ".join(errors))
        chosen, offsets, width = used
        wide = _normalise(result.get_counts(), width)
        for (qc, mt), off in zip(chosen, offsets):
            part = {}
            for key, c in wide.items():
                k = key[off:off + mt["n_qubits"]]
                part[k] = part.get(k, 0) + c
            counts[mt["id"]] = part
    else:
        runnable = circuits
        if kind == "ibm":
            runnable = transpile(circuits, backend=backend, optimization_level=3, seed_transpiler=7)
            for qc, mt in zip(runnable, meta):
                sent[mt["id"]] = _two_qubit(qc)
        result = backend.run(runnable, shots=shots).result()
        for i, mt in enumerate(meta):
            counts[mt["id"]] = _normalise(result.get_counts(i), mt["n_qubits"])

    return json.dumps({
        "source": "live",
        "backend": backend_label(backend),
        "shots": shots,
        "gateset": gateset,
        "two_qubit_sent": sent,
        "recorded_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "counts": counts,
    })


def load_recorded():
    """Recorded runs shipped in data/recorded_runs.json."""
    try:
        with open(RECORDED_RUNS) as fh:
            return fh.read()
    except OSError:
        return json.dumps([])


def save_run(payload_json):
    """Offer a run as a JSON download in the Qollab console."""
    data = json.loads(payload_json)
    keep = ("source", "backend", "shots", "gateset", "two_qubit_sent", "recorded_at", "counts")
    slim = {k: data[k] for k in keep if k in data}
    slim["source"] = "recorded"
    text = json.dumps(slim, separators=(",", ":"))
    try:
        from js import sendFile
        sendFile("quadratic_bet_run.json", "application/json", text)
        return "sent"
    except Exception:
        print(text)
        return "printed"
