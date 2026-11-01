const FLOW_DIRECTIONS = new Int8Array([
  0, 0, 0,
  1, 0, 0, -1, 0, 0,
  0, 1, 0, 0, -1, 0,
  0, 0, 1, 0, 0, -1,
  1, 1, 0, -1, -1, 0,
  1, -1, 0, -1, 1, 0,
  1, 0, 1, -1, 0, -1,
  1, 0, -1, -1, 0, 1,
  0, 1, 1, 0, -1, -1,
  0, 1, -1, 0, -1, 1,
]);
const FLOW_OPPOSITE = new Uint8Array([0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17]);
const FLOW_WEIGHTS = new Float64Array([1 / 3, ...Array(6).fill(1 / 18), ...Array(12).fill(1 / 36)]);
const TEMP_WEIGHTS = new Float64Array([1 / 4, ...Array(6).fill(1 / 8)]);

export class ThermalLbmSolver {
  constructor(grid, options = {}) {
    this.grid = grid;
    this.n = grid.nx * grid.nz * grid.ny;
    this.initialTemp = options.initial_temp_c ?? 16;
    this.outsideTemp = options.outside_temp_c ?? 8;
    this.referenceTemp = options.reference_temp_c ?? this.initialTemp;
    this.tauFlow = options.tau_flow ?? 0.9;
    this.tauTemperature = options.tau_temperature ?? 0.8;
    this.buoyancy = options.buoyancy ?? 5e-4;
    this.heaterScale = options.heater_scale ?? 0.003;
    this.velocityScale = options.velocity_scale ?? 1;
    this.exteriorCoupling = options.exterior_coupling ?? 0.1;
    if (this.tauFlow <= 0.5 || this.tauTemperature <= 0.5) {
      throw new RangeError('LBM relaxation times must be greater than 0.5');
    }
    this.f = new Float64Array(19 * this.n);
    this.fNext = new Float64Array(19 * this.n);
    this.g = new Float64Array(7 * this.n);
    this.gNext = new Float64Array(7 * this.n);
    this.density = new Float64Array(this.n);
    this.temperature = new Float64Array(this.n);
    this.velocity = new Float64Array(3 * this.n);
    this.source = new Float64Array(this.n);
    this.solidTemperature = new Float64Array(this.n).fill(NaN);
    this.neighbours = new Int32Array(19 * this.n).fill(-1);
    this.steps = 0;
    this.cellHeatCapacity = 1.2 * 1005 * grid.cell_m ** 3;
    this.sourceEnergyJ = 0;
    this.boundaryEnergyJ = 0;

    for (const source of grid.heater_sources || []) {
      this.source[source.index] += source.watts * this.heaterScale;
    }
    this.totalSourceTemperature = this.source.reduce((total, value) => total + value, 0);
    for (let index = 0; index < this.n; index += 1) {
      if (grid.solid_temperature && Number.isFinite(grid.solid_temperature[index])) {
        this.solidTemperature[index] = grid.solid_temperature[index];
      } else if (grid.solid_exterior?.[index]) {
        this.solidTemperature[index] = this.outsideTemp;
      }
    }
    this.buildNeighbours();
    this.initialiseDistributions();
    this.macroscopic();
  }

  index(ix, iz, iy) {
    return (iy * this.grid.nz + iz) * this.grid.nx + ix;
  }

  coords(index) {
    const ix = index % this.grid.nx;
    const iz = Math.floor(index / this.grid.nx) % this.grid.nz;
    const iy = Math.floor(index / (this.grid.nx * this.grid.nz));
    return [ix, iz, iy];
  }

  buildNeighbours() {
    const { nx, nz, ny, cell_type: types } = this.grid;
    this.linkBoundaryTemperature = new Float64Array(7 * this.n).fill(NaN);
    this.linkBoundaryCoupling = new Float64Array(7 * this.n).fill(1);
    for (let index = 0; index < this.n; index += 1) {
      if (types[index] === 1) continue;
      const [ix, iz, iy] = this.coords(index);
      for (let k = 0; k < 19; k += 1) {
        const x = ix + FLOW_DIRECTIONS[3 * k];
        const z = iz + FLOW_DIRECTIONS[3 * k + 1];
        const y = iy + FLOW_DIRECTIONS[3 * k + 2];
        if (x < 0 || x >= nx || z < 0 || z >= nz || y < 0 || y >= ny) continue;
        const neighbour = this.index(x, z, y);
        if (types[neighbour] !== 1) {
          this.neighbours[k * this.n + index] = neighbour;
        } else if (k < 7 && Number.isFinite(this.solidTemperature[neighbour])) {
          this.linkBoundaryTemperature[k * this.n + index] = this.solidTemperature[neighbour];
          this.linkBoundaryCoupling[k * this.n + index] = this.grid.solid_exterior?.[neighbour]
            ? this.exteriorCoupling : 1;
        }
      }
    }
  }

  initialiseDistributions() {
    for (let index = 0; index < this.n; index += 1) {
      if (this.grid.cell_type[index] === 1) continue;
      this.density[index] = 1;
      this.temperature[index] = this.initialTemp;
      for (let k = 0; k < 19; k += 1) this.f[19 * index + k] = FLOW_WEIGHTS[k];
      for (let k = 0; k < 7; k += 1) this.g[7 * index + k] = TEMP_WEIGHTS[k] * this.initialTemp;
    }
  }

  macroscopic() {
    for (let index = 0; index < this.n; index += 1) {
      if (this.grid.cell_type[index] === 1) continue;
      let rho = 0;
      let ux = 0;
      let uy = 0;
      let uz = 0;
      let temperature = 0;
      for (let k = 0; k < 19; k += 1) {
        const value = this.f[19 * index + k];
        rho += value;
        ux += value * FLOW_DIRECTIONS[3 * k];
        uy += value * FLOW_DIRECTIONS[3 * k + 1];
        uz += value * FLOW_DIRECTIONS[3 * k + 2];
      }
      for (let k = 0; k < 7; k += 1) temperature += this.g[7 * index + k];
      this.density[index] = rho;
      this.velocity[3 * index] = ux / rho;
      this.velocity[3 * index + 1] = uy / rho;
      this.velocity[3 * index + 2] = uz / rho;
      this.temperature[index] = temperature;
    }
  }

  step(count = 1) {
    const inverseTauFlow = 1 / this.tauFlow;
    const inverseTauTemperature = 1 / this.tauTemperature;
    for (let iteration = 0; iteration < count; iteration += 1) {
      this.sourceEnergyJ += this.cellHeatCapacity * this.totalSourceTemperature;
      this.fNext.fill(0);
      this.gNext.fill(0);
      for (let index = 0; index < this.n; index += 1) {
        const type = this.grid.cell_type[index];
        if (type === 1) continue;
        const rho = this.density[index];
        const ux = this.velocity[3 * index];
        const uy = this.velocity[3 * index + 1];
        const uz = this.velocity[3 * index + 2];
        const forceY = this.buoyancy * (this.temperature[index] - this.referenceTemp);
        const eqUy = uy + 0.5 * forceY;
        const speedSquared = ux * ux + eqUy * eqUy + uz * uz;
        const temperature = this.temperature[index];

        for (let k = 0; k < 19; k += 1) {
          const cx = FLOW_DIRECTIONS[3 * k];
          const cy = FLOW_DIRECTIONS[3 * k + 1];
          const cz = FLOW_DIRECTIONS[3 * k + 2];
          const cu = cx * ux + cy * eqUy + cz * uz;
          const equilibrium = FLOW_WEIGHTS[k] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * speedSquared);
          const post = this.f[19 * index + k] - inverseTauFlow * (this.f[19 * index + k] - equilibrium)
            + 3 * FLOW_WEIGHTS[k] * cy * forceY;
          const neighbour = this.neighbours[k * this.n + index];
          if (neighbour >= 0) this.fNext[19 * neighbour + k] = post;
          else this.fNext[19 * index + FLOW_OPPOSITE[k]] = post;
        }

        for (let k = 0; k < 7; k += 1) {
          const cu = FLOW_DIRECTIONS[3 * k] * ux + FLOW_DIRECTIONS[3 * k + 1] * eqUy
            + FLOW_DIRECTIONS[3 * k + 2] * uz;
          const equilibrium = TEMP_WEIGHTS[k] * temperature * (1 + 4 * cu);
          let post = this.g[7 * index + k] - inverseTauTemperature * (this.g[7 * index + k] - equilibrium);
          if (k === 0) post += this.source[index];
          const neighbour = this.neighbours[k * this.n + index];
          if (neighbour >= 0) {
            this.gNext[7 * neighbour + k] = post;
          } else {
            const boundary = this.linkBoundaryTemperature[k * this.n + index];
            const coupling = this.linkBoundaryCoupling[k * this.n + index];
            const bounced = Number.isFinite(boundary)
              ? post + 2 * coupling * (TEMP_WEIGHTS[k] * boundary - post)
              : post;
            this.gNext[7 * index + FLOW_OPPOSITE[k]] = bounced;
            this.boundaryEnergyJ += this.cellHeatCapacity * (bounced - post);
          }
        }
      }
      [this.f, this.fNext] = [this.fNext, this.f];
      [this.g, this.gNext] = [this.gNext, this.g];
      this.steps += 1;
      this.macroscopic();
      this.assertStable();
    }
  }

  assertStable() {
    const stats = this.stats();
    if (!Number.isFinite(stats.max_speed_lu) || !Number.isFinite(stats.min_temperature_c)
      || !Number.isFinite(stats.max_temperature_c) || stats.max_speed_lu > 0.5
      || stats.min_temperature_c < -100 || stats.max_temperature_c > 200) {
      throw new Error(`thermal LBM became unstable at step ${this.steps}`);
    }
  }

  stats() {
    let maxSpeed = 0;
    let minTemperature = Infinity;
    let maxTemperature = -Infinity;
    let airTemperatureChange = 0;
    for (let index = 0; index < this.n; index += 1) {
      if (this.grid.cell_type[index] === 1) continue;
      const speed = Math.hypot(this.velocity[3 * index], this.velocity[3 * index + 1], this.velocity[3 * index + 2]);
      maxSpeed = Math.max(maxSpeed, speed);
      minTemperature = Math.min(minTemperature, this.temperature[index]);
      maxTemperature = Math.max(maxTemperature, this.temperature[index]);
      airTemperatureChange += this.temperature[index] - this.initialTemp;
    }
    const airEnergyChangeJ = this.cellHeatCapacity * airTemperatureChange;
    return {
      steps: this.steps,
      max_speed_lu: maxSpeed,
      min_temperature_c: minTemperature,
      max_temperature_c: maxTemperature,
      viscosity_lu: (this.tauFlow - 0.5) / 3,
      thermal_diffusivity_lu: (this.tauTemperature - 0.5) / 4,
      velocity_scale_m_s_per_lu: this.velocityScale,
      source_energy_j: this.sourceEnergyJ,
      boundary_energy_j: this.boundaryEnergyJ,
      wall_loss_energy_j: -this.boundaryEnergyJ,
      air_energy_change_j: airEnergyChangeJ,
      energy_residual_j: this.sourceEnergyJ + this.boundaryEnergyJ - airEnergyChangeJ,
    };
  }

  frame(timeS) {
    const temperature = new Float32Array(this.n);
    const velocity = new Float32Array(3 * this.n);
    const velocityScale = this.velocityScale;
    for (let index = 0; index < this.n; index += 1) {
      if (this.grid.cell_type[index] === 1) continue;
      temperature[index] = this.temperature[index];
      velocity[3 * index] = this.velocity[3 * index] * velocityScale;
      velocity[3 * index + 1] = this.velocity[3 * index + 1] * velocityScale;
      velocity[3 * index + 2] = -this.velocity[3 * index + 2] * velocityScale;
    }
    return { time_s: timeS, temperature_c: temperature, velocity_m_s: velocity };
  }
}
