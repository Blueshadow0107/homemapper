import { runSimulation } from './run.js';

let cancelled = false;

self.onmessage = async (event) => {
  if (event.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (event.data.type !== 'run') return;
  cancelled = false;
  try {
    await runSimulation(event.data, (message, transfer = []) => self.postMessage(message, transfer), () => cancelled);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
