// The Quadratic Bet. Qollab entry point.
//
// The circuits live in Python (pricer/), the page lives in ui/. This file
// connects the two and hands the page the backend chosen in Select QPU.
// `backend` is created by Qollab before this file runs.
import { start } from './ui/app.js';
import * as runner from 'pricer.runner';

const label = String(await runner.backend_label.callPromising(backend));
const lower = label.toLowerCase();
const isIonQ = lower.includes('ionq');
const isIBM = lower.includes('fake') || lower.includes('ibm') || lower.includes('aer');
const isQPU = isIonQ && lower.includes('qpu');

const bridge = {
  backendName: label,
  // Real IonQ hardware spends credits: never send a job without a click.
  isHardware: isQPU,
  // IonQ accepts one job per press of Qollab's Run button.
  oneJob: isIonQ,
  // On simulators the job goes out while the run starts up, as Qollab expects.
  autoRun: !isQPU,
  // IonQ simulates every shot separately; IBM noise models run in the browser.
  defaultShots: isIonQ || isIBM ? 200 : 1000,
  // Runs on noisy backends are worth keeping: offer them as a file at once.
  autoSave: isIonQ || isIBM,

  async info() {
    return JSON.parse(String(await runner.info.callPromising()));
  },
  async run(shots) {
    return JSON.parse(String(await runner.run_all.callPromising(backend, shots)));
  },
  async recorded() {
    return JSON.parse(String(await runner.load_recorded.callPromising()));
  },
  async drawing(k) {
    return String(await runner.drawing.callPromising(k));
  },
  async save(run) {
    return String(await runner.save_run.callPromising(JSON.stringify(run)));
  },
};

await start(document.getElementById('app'), bridge);
