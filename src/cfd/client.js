// Starts a CFD run. Uses Kimi's real solver worker (thermal-cfd/worker.js) when present, else the labelled fixture.
import { runFixture } from './fixture.js';

const workerLoaders = import.meta.glob('../../thermal-cfd/worker.js', { query: '?worker' });

export const hasRealSolver = () => Object.keys(workerLoaders).length > 0;

export async function startCfd({ floorplan, scenario, onGrid, onFrame, onProgress, onDone, onError }) {
  let cancelled = false;
  const handle = (m) => {
    if (cancelled) return;
    if (m.type === 'grid') onGrid(m.grid);
    else if (m.type === 'frame') onFrame(m.frame);
    else if (m.type === 'progress') onProgress(m.fraction, m.note);
    else if (m.type === 'done') onDone(m.stats);
    else if (m.type === 'error') onError(new Error(m.message));
  };
  const loader = Object.values(workerLoaders)[0];
  if (loader) {
    const Worker_ = (await loader()).default;
    const w = new Worker_();
    w.onmessage = (e) => handle(e.data);
    w.onerror = (e) => onError(new Error(e.message || 'CFD worker crashed'));
    w.postMessage({ type: 'run', floorplan, scenario });
    return { source: 'solver', cancel: () => { cancelled = true; w.postMessage({ type: 'cancel' }); w.terminate(); } };
  }
  runFixture({ floorplan, scenario }, handle, () => cancelled);
  return { source: 'fixture', cancel: () => { cancelled = true; } };
}
