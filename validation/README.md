# Grid consistency check

Run the **unchanged `solver.js`** from Node, without the renderer, Blender, npm packages, or wall-clock playback. This is a repeatable numerical consistency check, not experimental validation or an engineering accuracy certificate.

From the repository root:

```sh
node validation/grid-consistency.cjs --mode quick
node validation/grid-consistency.cjs --mode extended
```

Reports go to `validation-results/grid-quick.json` and `validation-results/grid-extended.json`. Use `--out path/report.json` to choose a JSON destination. Extended mode defaults to a 36-second **simulated** time budget; `--max-time 60` extends it. Budgets must be multiples of 3 seconds and at least 12. Actual runtime depends on the CPU: the measured quick baseline took about one minute. Node 18+ is required; the baseline was run with Node 24.19.0 on Linux x64. These commands also work from a Windows terminal with Node installed.

Exit codes: **0** = every declared gate passes; **1** = a completed comparison fails at least one gate; **2** = invalid input, incompatible solver state, an instability message, or non-finite data. Exit 2 may occur before a report is written; do not treat an old output file as the result of a failed invocation. The existing baseline fails the density envelope, so exit 1 is expected on the reviewed solver. See [BASELINE.md](BASELINE.md).

## Fixed physical case

Use the built-in sphere, centered at the origin, diameter **2.3 m**, inlet **1 m/s**, requested and effective kinematic viscosity **0.05 m²/s**, Re **46**, and the existing **16 × 8 × 8 m** domain. Keep the solver's initialization, lattice inlet speed 0.075, boundaries, collision, and bounce-back exactly as implemented.

| Grid | dx (m) | dt (s) | Relaxation time | Cells across D | Steps at 6 s |
|---|---:|---:|---:|---:|---:|
| 72 × 36 × 36 | 0.222222 | 0.0166667 | 0.550625 | 10.35 | 360 |
| 96 × 48 × 48 | 0.166667 | 0.0125000 | 0.567500 | 13.80 | 480 |
| 128 × 64 × 64 | 0.125000 | 0.0093750 | 0.590000 | 18.40 | 640 |

The UI default viscosity, 0.04 m²/s, is **not** the same physical case on every grid: `nu = max(requested, 0.014*dx*U/0.075)` raises the coarse value to 0.0414815. At 0.05 all three use the requested viscosity. The harness checks the returned effective viscosity and Re; it rejects a mismatch rather than comparing different fluids. Voxel volume and its error relative to the geometric sphere volume are reported, not corrected by changing the sphere size.

## Measurements and stopping

The harness loads the repository source in a Node function closure, initializes it paused through its worker message handler, and invokes its actual `step()` function. Only browser messaging and scheduling are adapted. No numerical code is copied or rewritten. The adapter accesses the solver's internal state, so an incompatible solver API change requires an explicit harness update.

- **Quick:** sample at 3 and 6 physical seconds. The final verdict is for the field at 6 s (2.61 object transit times). Report 3→6 s temporal drift, but do not require settling.
- **Extended:** sample every 3 seconds, with the same 6 s quick assessment embedded in the report. Stop at a common time of at least 12 s once **every** grid has three consecutive small-drift intervals, or at the time budget. All grids continue together; do not compare their individually chosen stopping times. Exhausting the budget without settling fails the settling gate.
- **Spatial samples:** 9,954 fixed physical points with `x/D ∈ [-1.5,3]`, `y/D,z/D ∈ [-1,1]`, spaced by `D/8`. Exclude the sphere plus a clearance of two coarse cells (0.444444 m). Trilinearly interpolate at the same coordinates on each grid, requiring all eight corners to be interior fluid (`mask=0`). This avoids solid mixing and stale boundary output. Six centerline probes at `x/D = -1, 0.75, 1, 1.5, 2, 3` provide interpretable wake values.
- **Velocity difference:** `sqrt(mean(|u_A-u_B|²))/U`, using all three velocity components per point. Also report the maximum vector difference divided by U.
- **Pressure difference:** RMS and maximum absolute difference in **Cp**, not pascals. `field[3] = (rho_lattice-1)*2/(3*0.075²)`. With this case, physical static pressure relative to the reference is `Cp*0.5*1.225*U²` Pa. No hydrostatic color offset is included.
- **Temporal drift:** apply the same norms to successive snapshots on each individual grid. No averaging of signed differences or visual development indicator is used.
- **Diagnostics:** inspect solver Mach and lattice-density range after every step, retain the peaks and time of peak density range, and record current values at each checkpoint. Check every evolved interior field value for finiteness at each checkpoint. An `unstable` worker message aborts immediately. Initialization alone cannot pass.

The JSON includes solver and harness SHA-256 hashes, the solver Git blob SHA-1, Node/platform metadata, exact setup, sample-coordinate hash, all checkpoint steps/times, probes, drift, spatial comparisons, and each gate result. Runtime is informational and is not a numerical acceptance criterion. Repeated runs on the same Node/platform should reproduce the numerical values; across platforms compare within floating-point tolerance, not by JSON byte equality.

## Explicit acceptance policy

These are deliberately declared exploratory regression tolerances, selected before the first run. They are not derived uncertainty bounds and are not adjusted to make the baseline pass.

| Gate | Requirement |
|---|---|
| Medium→fine velocity difference | RMS / inlet U ≤ 0.05 |
| Medium→fine pressure difference | RMS ΔCp ≤ 0.10 |
| Refinement trend | Medium→fine RMS ≤ coarse→medium RMS for both velocity and Cp (1e-12 roundoff allowance) |
| Mach envelope | Peak over all steps and all three grids ≤ 0.30 |
| Density envelope | Peak `max(rho_lattice)-min(rho_lattice)` over all steps and grids ≤ 0.05 |
| Extended settling | Each grid has RMS temporal velocity / U ≤ 0.002 **and** RMS temporal ΔCp ≤ 0.005 for three consecutive 3 s intervals, at a common time ≥ 12 s |

The density range is relative to the reference lattice density of 1, not the maximum absolute deviation from 1. The Mach/density envelopes are stricter diagnostics than the solver's emergency pause; exceeding one does **not** mean the solver emitted an instability message. A startup peak remains part of the verdict even when later fields settle. A PASS would only mean these stated criteria were satisfied for this one case and sampled region.

## Limits found in the current implementation

1. **Spatial and temporal refinement are coupled.** `dt=0.075*dx/U`; equal step counts would compare different times. The lattice inlet Mach remains about 0.13 as the grid is refined, so this study does not drive weak-compressibility error to zero.
2. **Geometry changes discretely.** Cell-center sphere masking and halfway link bounce-back produce a different voxel obstacle on each grid. Neither geometric volume error nor solution differences must improve monotonically at these three resolutions. The finest grid is a comparison reference, not an exact solution.
3. **Boundary treatment also changes in physical space.** The uniform inlet/lateral populations are prescribed at cell centers; this is not a full Zou–He boundary implementation. The outlet copies populations from the adjacent cell's previous step. The sponge acts on the last eight interior x layers, a physical width of 1.7778, 1.3333, and 1.0 m, respectively. The sampled region is upstream of all sponges, but downstream boundaries can still influence it. Therefore this measures consistency of the app's current quality settings, not a clean isolated spatial truncation error.
4. **Field output at outer boundary cells is not refreshed by `step()`.** Those entries retain initialization values even when outlet populations evolve. Whole-array RMS comparisons would include misleading boundary data; the sampler excludes them.
5. **The analytic sphere field is only a startup guess.** Creeping-flow/Stokes drag is not an exact reference for this finite-domain Re=46 case. This harness does not add force integration or claim drag accuracy. It also does not validate imported meshes, arbitrary orientations, high-speed settings, turbulence, gravity-driven motion, thermal effects, or multiphase flow.
6. **Settling is local and sampled.** A small 3 s snapshot difference can miss oscillations between checkpoints or slow drift, and RMS can conceal localized errors. The report includes maximum differences and wake probes, but its stopping rule is not a global steady-state proof. A longer budget, denser time sampling, independent boundaries/domain-size studies, and reference CFD/experimental data would be separate checks.

Do not estimate a formal convergence order, Richardson-extrapolated error, or GCI from these three app settings without first controlling the boundary, temporal, compressibility, and geometry effects above.

Harness verification (independent of the simulation run):

```sh
node --test validation/grid-consistency.test.cjs
```

The small tests check exact interpolation of an analytic linear field across grids, solid/boundary exclusion, vector RMS normalization, non-finite rejection, settling/stability/trend failures, and CLI input validation.
