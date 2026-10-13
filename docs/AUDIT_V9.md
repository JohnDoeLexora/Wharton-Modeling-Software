# Audit V9

Independent read of the portfolio engine against `docs/MODEL_SPEC.md`, the Bend laws, and `reference/python/kernel.py`. Each fix below started from a failing test in `src/core/v9.test.ts` or `src/core/v9robust.test.ts`. Line numbers are the tree that carries version 9.0.0.

Nothing in this note is a portfolio, a reserve policy, or a facility gift.

## Fixes

### Jump model

The version 8 detector treated ordinary fat-tail days as jumps, collapsed an annual Poisson into one Bernoulli draw, and added `p · size` to the expected return. The fit then stacked a Student-t on the same tails, and a class fallback filled names that had no gaps.

- Detection is a Student-t quantile on GARCH residuals of demeaned returns, aimed at 0.02 false positives a year. `src/core/risk/jumps.ts:16` and `src/core/risk/jumps.ts:135`.
- A long history with zero gaps stays at intensity zero and source `name`. `src/core/risk/jumps.ts:322`.
- The proposal stores `jumpLambda` and does not put a Bernoulli probability on top. `src/core/risk/assemble.ts:134`.
- The annual step draws `N ~ Poisson(λ)` from the existing jump uniform and contributes `(N − λ) · jumpMean`. `src/core/equity.ts:158`. Scenario mode leaves that term at zero (`src/core/equity.ts:145` only assigns the draw when `mode === "mc"`).
- Tests: a pure Student-t(4) sample has λ̂ ≤ 0.2 per year; an injected Poisson λ is recovered within two standard errors; the expected annual return is invariant to the jump parameters.

### Comparison harness

`src/core/risk/compare.ts:60` sets the legacy idiosyncratic volatility to the residual after the monthly beta, not to total monthly volatility. `compareMethods` (`src/core/risk/compare.ts:161`) keeps the caller's market μ and reserve and returns `paired.fundedDiff` with `paired.fundedSe`. `scripts/risk-report.ts` passes `teachingAssumptions()`.

On the synthetic book, 200 trials, seed 42, that paired P(funded) difference is 0.010 (SE 0.027).

### Trial-curve reserve

`src/core/reserve.ts:289` prices a flat zero curve at `discountYield` and sets a warning. The teaching sample reserve is $439,305.45. A zero yield is still the $500,000 sum. The main run does not substitute a silent undiscounted ladder.

### Trial-level wealth

Teaching Monte Carlo trial index 3, seed 42, 0 bps, beginning-of-2033 wealth is $503,352.77. The same number is produced by version 5 commit `3b21322` and version 7 commit `99174a4`. $505,241 and $547,835 do not reproduce on those commits. The coordinate system is unchanged: SplitMix64 stream 1, Box–Muller pairs, the jump uniform still at stream 6 dimension `8000 + index`. `src/core/v9.test.ts` pins trial 0, trial 3, and the base scenario.

### Beta labels

`src/core/risk/beta.ts:18` sets `MIN_BETA_OBS` to 24. Blume and the monthly slope are withheld below that count. The risk card and the report name the window on the measured beta.

### Sampler work

`src/core/run.ts:592` runs the three-sampler comparison only when `assumptions.diagnostics.samplerComparison` is true. The Curve lab (`src/ui/CurvePanel.tsx`, button `run-convergence-lab`) is a separate click. It does not run on render.

## Checked and left as specified

| Claim | Evidence | Result |
| --- | --- | --- |
| Case cash flows and the $450,000 zero-return path | `docs/MODEL_SPEC.md` §1 and §3 | Unchanged. |
| Zero-yield ladder $500,000 | `docs/MODEL_SPEC.md` §3 and §18 | Unchanged. The teaching 3% hurdle is a different object. |
| Bend jump identity 40000 | `bend/laws/LAWS.bend:715`, `bend/names.bend:47`, `src/core/golden.ts:65` | Unchanged. This subtracts probability times loss. It is not the compensated scenario return of the float engine. |
| Bend jump variance 18000 | `bend/laws/LAWS.bend:973`, `bend/risk.bend` `golden_jump` | Unchanged. That integer is `λ · E[size²]`. |
| Python kernel | `reference/python/kernel.py` has no jump term | The year step matches the TypeScript kernel. Jumps live only on the basket sleeve in TypeScript. |
| Tenor accrued interest is zero on a coupon date | `src/core/instruments.ts` `accruedInterest` | Unchanged. Dated ACT/ACT and 30/360 are additional functions, pinned in `v9robust.test.ts`. |
| GARCH failure | `src/core/risk/vol.ts:118` | Non-finite or short samples return `ok: false` and `conditionalSigma` flags EWMA. They do not throw. |
| Curve OLS failure | `src/core/nelson.ts:234` `fitCurveRobust` | Fewer than three usable points, or a singular design, returns a flagged median-flat curve or no curve when no zero is finite. |
| Form trial count | `docs/MODEL_SPEC.md` §14 | The main sample does not stop early. `runUntilStandardError` in `src/core/convergence.ts` is the lab only. |
| Philox book | `docs/MODEL_SPEC.md` §6.3 | Still deleted. `reference/python/sim.py` keeps the three bond helpers. |

## Not a defect

The integer name-return in Bend and in `nameReturnPpm` still charges the expected jump loss. Changing it would move the law `single_name_jump_cuts_the_return`. The portfolio engine compensates so that a jump does not add drift. Both are documented in `docs/MODEL_SPEC.md` §17.
