import { voxelize } from './voxelize.js';
import { ThermalLbmSolver } from './solver.js';

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function runSimulation(message, post, isCancelled) {
  const scenario = message.scenario || {};
  const grid = voxelize(message.floorplan, scenario.cell_m ?? 0.25,
    scenario.heaters || [], scenario.obstacles || []);
  const solver = new ThermalLbmSolver(grid, scenario);
  const publicGrid = {
    origin_m: grid.origin_m,
    cell_m: grid.cell_m,
    nx: grid.nx,
    nz: grid.nz,
    ny: grid.ny,
    height_m: grid.height_m,
    cell_type: grid.cell_type.slice(),
  };
  post({ type: 'grid', grid: publicGrid }, [publicGrid.cell_type.buffer]);

  const duration = scenario.duration_s ?? 10800;
  const frameEvery = scenario.frame_every_s ?? 60;
  const stepsPerFrame = scenario.steps_per_frame ?? 5;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(frameEvery) || frameEvery <= 0
    || !Number.isInteger(stepsPerFrame) || stepsPerFrame <= 0) {
    throw new RangeError('duration_s, frame_every_s and steps_per_frame must be positive');
  }
  const internalDt = frameEvery / stepsPerFrame;
  const sendFrame = (time) => {
    const frame = solver.frame(time);
    post({ type: 'frame', frame }, [frame.temperature_c.buffer, frame.velocity_m_s.buffer]);
  };

  sendFrame(0);
  post({ type: 'progress', fraction: 0, note: 'thermal LBM · D3Q19 + D3Q7' });
  let time = 0;
  while (time < duration && !isCancelled()) {
    await pause();
    if (isCancelled()) break;
    solver.step(stepsPerFrame);
    time = Math.min(duration, time + frameEvery);
    sendFrame(time);
    post({ type: 'progress', fraction: time / duration });
  }
  if (!isCancelled()) {
    post({
      type: 'done',
      stats: {
        ...solver.stats(),
        last_dt_s: internalDt,
        solver: 'D3Q19-D3Q7',
        uncalibrated: true,
      },
    });
  }
}
