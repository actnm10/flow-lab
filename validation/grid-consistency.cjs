#!/usr/bin/env node
'use strict';
// Numerical consistency of the real browser solver; Node standard library only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const CASE = Object.freeze({ speed: 1, size: 2.3, viscosity: 0.05, sphere: true, rate: 1 });
const GRIDS = [72, 96, 128];
const LIMITS = Object.freeze({
  velocityRms: 0.05, cpRms: 0.10,       // Absolute differences normalized by inlet U, or Cp units.
  temporalVelocityRms: 0.002, temporalCpRms: 0.005,
  maxMach: 0.30, densityVariation: 0.05, consecutiveIntervals: 3,
});
const INTERVAL = 3, QUICK_TIME = 6, MIN_SETTLE_TIME = 12;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rms = (sum, count) => Math.sqrt(sum / count);

function options(args) {
  const o = { mode: 'quick', maxTime: 36, out: null };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help') return { help: true };
    if (!['--mode', '--max-time', '--out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Unknown option or missing value: ${key}`);
    }
    const value = args[++i];
    if (key === '--mode') o.mode = value;
    if (key === '--max-time') o.maxTime = Number(value);
    if (key === '--out') o.out = value;
  }
  if (!['quick', 'extended'].includes(o.mode)) throw new Error('--mode must be quick or extended');
  if (!Number.isFinite(o.maxTime) || o.maxTime < MIN_SETTLE_TIME || o.maxTime % INTERVAL) {
    throw new Error('--max-time must be a multiple of 3 seconds, at least 12');
  }
  o.out ||= path.join('validation-results', `grid-${o.mode}.json`);
  return o;
}

function loadSolver(source, resolution) {
  let ready;
  const warnings = [];
  const self = {};
  const postMessage = message => {
    if (message.type === 'ready') ready = message;
    if (message.type === 'warning') warnings.push(message.text);
    if (message.type === 'unstable') throw new Error(`${resolution}: ${message.text}`);
  };
  // Execute the trusted, unchanged repository source in a lexical closure.
  // The appended adapter only reads state and calls the solver's actual step().
  const make = new Function('self', 'postMessage', 'setTimeout', 'performance', source + `
    return { step, state: () => ({ field, mask, time, stepCount, diagnostics: self.diagnostics }) };
  `);
  const api = make(self, postMessage, () => { throw new Error('Unexpected wall-clock scheduling'); }, performance);
  self.onmessage({ data: { type: 'init', paused: true, params: { ...CASE, resolution } } });
  if (!ready || ready.nx !== resolution || ready.ny !== resolution / 2 || ready.nz !== resolution / 2) {
    throw new Error('Solver grid API changed');
  }
  if (Math.abs(ready.nu - CASE.viscosity) > 1e-12 || Math.abs(ready.re - 46) > 1e-10) {
    throw new Error('Effective viscosity / Reynolds number differs from the fixed benchmark');
  }
  if (ready.tau < 0.542 || !Number.isFinite(ready.dt) || ready.dt <= 0 || ready.solidCount <= 0 || warnings.length) {
    throw new Error(`Invalid initialization: ${warnings.join('; ')}`);
  }
  return { api, meta: ready, peakMach: 0, peakDensityVariation: 0,
    peakDensityTimeSeconds: 0, previous: null, streak: 0 };
}

function stencil(meta, mask, point) {
  const { nx, ny, nz, dx } = meta;
  // Solver cells are centered at (-6, -4, -4) + (index + 1/2) dx.
  const q = point.map((v, a) => (v - [-6, -4, -4][a]) / dx - 0.5);
  const base = q.map(Math.floor), frac = q.map((v, a) => v - base[a]);
  if (base.some((v, a) => v < 1 || v + 1 >= [nx, ny, nz][a] - 1)) {
    throw new Error('Sample touches a boundary with stale field output');
  }
  const result = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const i = base[0] + x + nx * (base[1] + y + ny * (base[2] + z));
    if (mask[i] !== 0) throw new Error('Sample interpolation crosses a solid or prescribed boundary');
    result.push([4 * i, (x ? frac[0] : 1 - frac[0]) * (y ? frac[1] : 1 - frac[1]) * (z ? frac[2] : 1 - frac[2])]);
  }
  return result;
}

function interpolate(field, weights) {
  const value = [0, 0, 0, 0];
  for (const [offset, weight] of weights) for (let k = 0; k < 4; k++) value[k] += weight * field[offset + k];
  if (!value.every(Number.isFinite)) throw new Error('Non-finite velocity or Cp at a sample');
  return value;
}

function samplePoints() {
  const points = [], D = CASE.size, clearance = 2 * 16 / GRIDS[0];
  // Fixed physical cloud: x/D in [-1.5,3], y/D,z/D in [-1,1], spacing D/8.
  for (let iz = -8; iz <= 8; iz++) for (let iy = -8; iy <= 8; iy++) for (let ix = -12; ix <= 24; ix++) {
    const p = [ix, iy, iz].map(v => v * D / 8);
    if (Math.hypot(...p) >= D / 2 + clearance) points.push(p);
  }
  return points;
}

function difference(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('Mismatched or empty sample arrays');
  let velocity = 0, cp = 0, maxVelocity = 0, maxCp = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== 4 || b[i].length !== 4 || ![...a[i], ...b[i]].every(Number.isFinite)) {
      throw new Error('Invalid sample vector');
    }
    const du2 = (a[i][0] - b[i][0]) ** 2 + (a[i][1] - b[i][1]) ** 2 + (a[i][2] - b[i][2]) ** 2;
    const dp = a[i][3] - b[i][3];
    velocity += du2; cp += dp * dp;
    maxVelocity = Math.max(maxVelocity, Math.sqrt(du2)); maxCp = Math.max(maxCp, Math.abs(dp));
  }
  return { velocityRmsOverU: rms(velocity, a.length) / CASE.speed,
    velocityMaxOverU: maxVelocity / CASE.speed, cpRms: rms(cp, a.length), cpMax: maxCp };
}

function compare(samples) {
  const pairs = [[0, 1], [1, 2], [0, 2]].map(([a, b]) => ({
    grids: [GRIDS[a], GRIDS[b]], ...difference(samples[a], samples[b]),
  }));
  const [coarse, fine] = pairs;
  const ratio = key => coarse[key] > 1e-14 ? fine[key] / coarse[key] : null;
  return { pairs, refinementRatio: { velocity: ratio('velocityRmsOverU'), cp: ratio('cpRms') } };
}

function assess(checkpoint, mode) {
  const [coarse, fine] = checkpoint.pairs;
  const checks = {
    machWithinEnvelope: checkpoint.grids.every(g => Number.isFinite(g.peakMach) && g.peakMach <= LIMITS.maxMach),
    densityWithinEnvelope: checkpoint.grids.every(g => Number.isFinite(g.peakDensityVariation)
      && g.peakDensityVariation <= LIMITS.densityVariation),
    fineVelocityDifference: fine.velocityRmsOverU <= LIMITS.velocityRms,
    fineCpDifference: fine.cpRms <= LIMITS.cpRms,
    decreasingVelocityDifference: fine.velocityRmsOverU <= coarse.velocityRmsOverU + 1e-12,
    decreasingCpDifference: fine.cpRms <= coarse.cpRms + 1e-12,
  };
  if (mode === 'extended') checks.temporallySettled = checkpoint.timeSeconds >= MIN_SETTLE_TIME
    && checkpoint.grids.every(g => g.settledIntervals >= LIMITS.consecutiveIntervals);
  return { status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks,
    scope: mode === 'quick' ? 'Fixed-time numerical consistency; settling is not required.'
      : 'Numerical consistency and settling of the sampled region; not physical validation.' };
}

function advance(run, timeSeconds) {
  const count = Math.round(timeSeconds / run.meta.dt);
  if (Math.abs(count * run.meta.dt - timeSeconds) > 1e-10) throw new Error('Checkpoint is not an exact step time');
  while (run.api.state().stepCount < count) {
    run.api.step();
    const state = run.api.state(), d = state.diagnostics;
    if (!d || !Number.isFinite(d.maxMach) || !Number.isFinite(d.densityVariation)) throw new Error('Invalid diagnostics');
    run.peakMach = Math.max(run.peakMach, d.maxMach);
    if (d.densityVariation > run.peakDensityVariation) {
      run.peakDensityVariation = d.densityVariation;
      run.peakDensityTimeSeconds = state.stepCount * run.meta.dt;
    }
  }
  const s = run.api.state();
  if (s.stepCount !== count || Math.abs(s.time - timeSeconds) > 1e-8) throw new Error('Physical time mismatch');
  // Check all evolved cells, not the stale inlet/outlet display values or solid cells.
  for (let i = 0; i < s.mask.length; i++) if (s.mask[i] === 0) {
    for (let k = 0; k < 4; k++) if (!Number.isFinite(s.field[4 * i + k])) throw new Error('Non-finite interior field');
  }
  return s;
}

function runCheck(o) {
  const root = path.resolve(__dirname, '..'), solverPath = path.join(root, 'solver.js');
  const bytes = fs.readFileSync(solverPath), source = bytes.toString('utf8');
  const points = samplePoints();
  const probes = [-1, 0.75, 1, 1.5, 2, 3].map(x => ({ xOverD: x, point: [x * CASE.size, 0, 0] }));
  const runs = GRIDS.map(nx => loadSolver(source, nx));
  for (const r of runs) {
    r.weights = points.map(p => stencil(r.meta, r.meta.mask, p));
    r.probeWeights = probes.map(p => stencil(r.meta, r.meta.mask, p.point));
  }
  const report = {
    schemaVersion: 1, mode: o.mode,
    provenance: { solverSha256: hash(bytes), harnessSha256: hash(fs.readFileSync(__filename)),
      solverGitBlobSha1: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      node: process.version, platform: process.platform, arch: process.arch },
    case: { ...CASE, effectiveRe: 46, domainMetres: [16, 8, 8], densityKgM3: 1.225 },
    sampling: { count: points.length, xOverD: [-1.5, 3], yOverD: [-1, 1], zOverD: [-1, 1],
      spacingOverD: 0.125, solidClearanceMetres: 2 * 16 / GRIDS[0], pointsSha256: hash(JSON.stringify(points)),
      method: 'Trilinear at identical SI coordinates; all eight stencil cells must have mask=0.',
      pressure: 'field[3] is Cp=(rho_lattice-1)*2/(3*0.075^2), not pressure in Pa.' },
    policy: { ...LIMITS, intervalSeconds: INTERVAL, quickTimeSeconds: QUICK_TIME,
      minSettleTimeSeconds: MIN_SETTLE_TIME, maxTimeSeconds: o.mode === 'quick' ? QUICK_TIME : o.maxTime,
      note: 'Exploratory regression tolerances, selected before the baseline run; not accuracy guarantees.' },
    grids: runs.map(({ meta: m }) => ({ nx: m.nx, ny: m.ny, nz: m.nz, dx: m.dx, dt: m.dt,
      effectiveViscosity: m.nu, tau: m.tau, re: m.re, cellsPerDiameter: CASE.size / m.dx,
      solidCells: m.solidCount, voxelVolume: m.solidCount * m.dx ** 3,
      voxelVolumeRelativeError: m.solidCount * m.dx ** 3 / (Math.PI * CASE.size ** 3 / 6) - 1 })),
    checkpoints: [],
  };
  const started = performance.now();
  for (let t = INTERVAL; t <= report.policy.maxTimeSeconds; t += INTERVAL) {
    const samples = [], gridStats = [];
    for (const r of runs) {
      const s = advance(r, t), values = r.weights.map(w => interpolate(s.field, w));
      const drift = r.previous ? difference(values, r.previous) : null;
      const small = drift && drift.velocityRmsOverU <= LIMITS.temporalVelocityRms && drift.cpRms <= LIMITS.temporalCpRms;
      r.streak = small ? r.streak + 1 : 0;
      r.previous = values; samples.push(values);
      gridStats.push({ nx: r.meta.nx, steps: s.stepCount, actualTimeSeconds: s.time, drift,
        settledIntervals: r.streak, peakMach: r.peakMach, peakDensityVariation: r.peakDensityVariation,
        peakDensityTimeSeconds: r.peakDensityTimeSeconds, diagnosticsAtCheckpoint: { ...s.diagnostics },
        probes: probes.map((p, i) => ({ xOverD: p.xOverD, velocityAndCp: interpolate(s.field, r.probeWeights[i]) })) });
      console.error(`${r.meta.nx}: t=${t}s (${s.stepCount} steps), drift U=${drift ? drift.velocityRmsOverU.toExponential(3) : 'n/a'}`);
    }
    const checkpoint = { timeSeconds: t, transitTimes: t * CASE.speed / CASE.size, grids: gridStats, ...compare(samples) };
    report.checkpoints.push(checkpoint);
    if (t === QUICK_TIME) report.quick = assess(checkpoint, 'quick');
    // All grids stop at the SAME time. A single grid may not stop early.
    if (o.mode === 'extended' && t >= MIN_SETTLE_TIME && runs.every(r => r.streak >= LIMITS.consecutiveIntervals)) break;
  }
  report.result = assess(report.checkpoints.at(-1), o.mode);
  report.stopReason = o.mode === 'quick' ? 'fixed_time' : report.result.checks.temporallySettled ? 'all_grids_settled' : 'time_budget_exhausted';
  report.elapsedSeconds = (performance.now() - started) / 1000;
  return report;
}

function main() {
  const o = options(process.argv.slice(2));
  if (o.help) {
    console.log('node validation/grid-consistency.cjs [--mode quick|extended] [--max-time 36] [--out report.json]');
    return;
  }
  // Never allow --out to overwrite solver, documentation, or the harness.
  const target = path.resolve(o.out);
  if (path.extname(target).toLowerCase() !== '.json') throw new Error('--out must end in .json');
  const report = runCheck(o);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  const last = report.checkpoints.at(-1);
  console.table(last.pairs.map(p => ({ grids: p.grids.join(' → '), 'velocity RMS / U': p.velocityRmsOverU, 'Cp RMS': p.cpRms })));
  console.log(`${report.result.status}: ${report.mode}, t=${last.timeSeconds}s, ${report.stopReason}; ${target}`);
  for (const [check, ok] of Object.entries(report.result.checks)) if (!ok) console.log(`  Failed: ${check}`);
  process.exitCode = report.result.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 2; }
}
module.exports = { options, loadSolver, stencil, interpolate, samplePoints, difference, compare, assess, CASE, GRIDS, LIMITS };
