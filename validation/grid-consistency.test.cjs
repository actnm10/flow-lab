'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stencil, interpolate, difference, assess, options, LIMITS } = require('./grid-consistency.cjs');

test('interpolation compares identical physical positions exactly for a linear field', () => {
  const point = [1.17, -0.43, 0.61];
  const exact = ([x, y, z]) => [1 + 2 * x - y, y + 3 * z, -x + z, 0.4 * x - 0.7 * y + z];
  const sampled = [16, 24, 32].map(nx => {
    const ny = nx / 2, nz = ny, dx = 16 / nx;
    const field = new Float64Array(nx * ny * nz * 4), mask = new Uint8Array(nx * ny * nz);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + nx * (y + ny * z);
      field.set(exact([-6 + (x + 0.5) * dx, -4 + (y + 0.5) * dx, -4 + (z + 0.5) * dx]), 4 * i);
    }
    return interpolate(field, stencil({ nx, ny, nz, dx }, mask, point));
  });
  for (const values of sampled) for (let k = 0; k < 4; k++) assert.ok(Math.abs(values[k] - exact(point)[k]) < 1e-12);
  assert.ok(difference([sampled[0]], [sampled[2]]).velocityRmsOverU < 1e-12);
});

test('sampling rejects solid crossings and stale boundary output', () => {
  const meta = { nx: 16, ny: 8, nz: 8, dx: 1 }, mask = new Uint8Array(16 * 8 * 8);
  const first = stencil(meta, mask, [0, 0, 0])[0][0] / 4;
  mask[first] = 3;
  assert.throws(() => stencil(meta, mask, [0, 0, 0]), /solid/);
  assert.throws(() => stencil(meta, mask, [-5.5, 0, 0]), /boundary/);
});

test('RMS uses vector differences per point and rejects nonfinite input', () => {
  const zero = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const d = difference([[3, 4, 0, 2], [0, 0, 0, 0]], zero);
  assert.equal(d.velocityRmsOverU, Math.sqrt(25 / 2));
  assert.equal(d.velocityMaxOverU, 5);
  assert.equal(d.cpRms, Math.sqrt(2));
  assert.throws(() => difference([[NaN, 0, 0, 0]], [[0, 0, 0, 0]]), /Invalid/);
});

function checkpoint() {
  return { timeSeconds: 12, pairs: [{ velocityRmsOverU: 0.02, cpRms: 0.02 }, { velocityRmsOverU: 0.01, cpRms: 0.01 }],
    grids: [72, 96, 128].map(nx => ({ nx, peakMach: 0.2, peakDensityVariation: 0.02, settledIntervals: 3 })) };
}

test('extended mode requires every grid to settle; quick mode does not', () => {
  const c = checkpoint();
  assert.equal(assess(c, 'extended').status, 'PASS');
  c.grids[0].settledIntervals = 2;
  assert.equal(assess(c, 'extended').checks.temporallySettled, false);
  assert.equal(assess(c, 'quick').status, 'PASS');
  c.grids[0].settledIntervals = 3; c.timeSeconds = 9;
  assert.equal(assess(c, 'extended').status, 'FAIL');
});

test('absolute tolerance, refinement trend, and stability each affect the verdict', () => {
  let c = checkpoint();
  c.pairs[1].velocityRmsOverU = LIMITS.velocityRms * 2;
  assert.equal(assess(c, 'quick').checks.fineVelocityDifference, false);
  c = checkpoint(); c.pairs[1].cpRms = 0.03;
  assert.equal(assess(c, 'quick').checks.decreasingCpDifference, false);
  c = checkpoint(); c.grids[2].peakMach = 0.31;
  assert.equal(assess(c, 'quick').checks.machWithinEnvelope, false);
  c = checkpoint(); c.grids[2].peakDensityVariation = NaN;
  assert.equal(assess(c, 'quick').status, 'FAIL');
});

test('CLI rejects time budgets that cannot share an exact physical checkpoint', () => {
  assert.throws(() => options(['--max-time', '13']), /multiple of 3/);
  assert.throws(() => options(['--max-time', 'NaN']), /multiple of 3/);
  assert.throws(() => options(['--mode', 'unknown']), /quick or extended/);
  assert.throws(() => options(['--mode']), /missing value/);
});
