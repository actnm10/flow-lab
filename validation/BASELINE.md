# Measured baseline

Both modes completed against the unchanged solver from [actnm10/flow-lab commit 3ee01f5](https://github.com/actnm10/flow-lab/tree/3ee01f59cadbed4801d9e50a1d86c5b17e6846cb), on Node **24.19.0**, Linux x64. Solver Git blob: `2de913814441acd1c10ce15de39fac02696dc22c`. The [quick JSON](baselines/grid-quick.json) and [extended JSON](baselines/grid-extended.json) contain source hashes, all checkpoint data, and the precise acceptance policy.

**Overall result: FAIL in both modes, solely because the startup lattice-density range exceeds the declared 5% envelope.** The spatial-difference, refinement-trend, and Mach gates pass. The extended run also passes its sampled-region settling gate. This result does not mean the solver triggered its emergency instability pause; no such pause occurred.

## Resolution differences

The fixed sphere case uses U=1 m/s, D=2.3 m, effective viscosity 0.05 m²/s, Re=46, and 9,954 common physical sample points. Velocity RMS values below are percentages of the **inlet** speed, not percentages of the local velocity or errors against an exact solution. Pressure differences are absolute Cp units.

| Mode / common time | Grid pair | Velocity RMS / U | RMS ΔCp |
|---|---|---:|---:|
| Quick / 6 s | 72→96 | 1.178929% | 0.01690623 |
| Quick / 6 s | 96→128 | 0.589217% | 0.00873003 |
| Quick / 6 s | 72→128 | 1.693161% | 0.02286236 |
| Extended / 24 s | 72→96 | 1.299147% | 0.01792603 |
| Extended / 24 s | 96→128 | 0.676161% | 0.00953689 |
| Extended / 24 s | 72→128 | 1.903646% | 0.02484860 |

At 24 s, medium→fine RMS differences are **0.5205 times** the coarse→medium velocity difference and **0.5320 times** its pressure difference. This is a favorable refinement trend for these sampled quantities. It is not an estimated convergence order or a bound on physical error. The medium→fine **maximum** pointwise velocity difference is 3.8053% of U and maximum ΔCp is 0.07347; RMS values conceal this spatial variation.

The independent quick and extended invocations reproduce **every numerical checkpoint value exactly at 3 and 6 s** on this runtime. Both report hashes match the delivered solver and harness. The six harness unit tests pass. Measured integration/report runtimes were about **59 s** for quick and **224 s** for extended; these are machine-dependent, not performance guarantees.

## Settling and diagnostic limits

At 6 s, 3→6 s velocity drift is still 9.38–9.54% of U, so the quick comparison should not be interpreted as a settled solution. Extended mode first satisfies all three consecutive small-drift intervals at **24 s**, or **10.435 object transit times**. The passing intervals end at 18, 21, and 24 s. All grids are compared at the same final physical time.

| Grid | Final steps | 21→24 s velocity RMS drift / U | 21→24 s RMS ΔCp | Peak density range | Peak time (s) | Density range at 24 s |
|---|---:|---:|---:|---:|---:|---:|
| 72 | 1,440 | 0.010260% | 0.00005751 | 8.8030% | 0.63333 | 1.9022% |
| 96 | 1,920 | 0.010207% | 0.00005438 | 8.2200% | 0.61250 | 1.7881% |
| 128 | 2,560 | 0.009611% | 0.00004984 | 8.3246% | 0.61875 | 1.8163% |

The global peak Mach values are 0.15469, 0.15297, and 0.15180, below the 0.30 envelope. Density ranges have fallen below 2% by 24 s, but the all-step peak-density gate still fails. The code retains the initial transient instead of relaxing the threshold or excluding an unannounced warmup period.

## Geometry and interpretation

| Grid | Solid cells | Voxel volume (m³) | Difference from geometric sphere volume |
|---|---:|---:|---:|
| 72 | 624 | 6.847737 | +7.4892% |
| 96 | 1,376 | 6.370370 | −0.0040% |
| 128 | 3,184 | 6.218750 | −2.3840% |

The voxel volume error is not monotone. Together with the fixed-cell outlet sponge, changing time step, and fixed lattice Mach, this prevents treating the measured differences as a pure spatial discretization error. The report tests interior velocity/pressure consistency for one sphere; it does not establish surface pressure, force accuracy, far-boundary independence, or agreement with experiments.

The most direct follow-up prompted by this baseline is to investigate the early density transient with more frequent diagnostics, while retaining this benchmark as-is for comparison. Improvements to initialization or boundary treatment should rerun both modes with the same declared policy. See [README.md](README.md) for the full method and limits.
