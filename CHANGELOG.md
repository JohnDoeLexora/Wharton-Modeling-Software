# Changelog

## 9.0.0

Jumps are a compensated compound Poisson. Detection uses a Student-t quantile on GARCH residuals (EWMA if the fit does not converge, and that fallback is flagged). The degrees of freedom are fit after the jumps are removed. A name with at least three years of history and no detected gap does not get a class-fallback jump. The expected annual return does not change when the jump parameters change.

The old-versus-new harness uses residual monthly volatility and the caller's market drift and reserve. It reports a paired difference and a paired standard error. A trial-curve reserve with a flat zero curve uses the stated discount yield and warns. On the teaching book that hurdle is $439,305.45, not the undiscounted $500,000.

Trial 3 of the teaching Monte Carlo (seed 42, 0 bps) is $503,352.77 at the beginning of 2033. The same trial is $503,352.77 on the version 5 commit `3b21322` and the version 7 commit `99174a4`. The figures $505,241 and $547,835 do not reproduce. Stream 1 and the scenario path are unchanged. Golden tests pin trial 0 ($661,189.07), trial 3, and the base scenario ($593,470.93).

Betas name their window. A monthly or Blume beta needs 24 monthly observations. Sampler comparison and the three-sampler standard-error curve run only when you ask. `npm run bench` holds the timing checks. `npm run verify` does not.

Dated accrued interest uses ACT/ACT ICMA for Treasuries and 30/360 US for corporates, including a negative accrual inside an ex-coupon window. The Curve lab plots standard error against N and can stop a separate sample at a target standard error. The form trial count does not change. Headline metrics show an effective sample size.

Case cash flows are unchanged. No portfolio is hardcoded.

## 8.0.0

One portfolio engine. The TypeScript year step is canonical. Python follows it with the same SplitMix64 draws. The Philox book in `reference/python/sim.py` is gone. Bond helpers stay so the existing parity checker can still extract them. Optional overlays (regimes, a shared Student-t, sector and currency factors, the investment-grade spread, issuer credit, target-maturity duration, and a binned 2031 range) are flags and default to off.

Statistic citations recompute a claim on three windows and name the file, the hash, the as-of date, and the estimator. Factor risk, a reserve ladder under the $300,000 capital, exploration frontiers, a scenario library, tear sheets, a reproduce bundle, and a board workbook are in the app. The command palette, undo, a shareable run link, paired-difference standard errors, a cancelable worker, and streaming percentiles are on the shell.

Case cash flows are unchanged. No portfolio is hardcoded.

## 7.0.0

One year-step function shared by the main path, the continuation, the mixes, and the Python parity fixture. Priced schedules are reused. The teaching-book headlines are unchanged.

## 6.0.0

Daily history, several volatility estimators, betas with standard errors, jumps, and a coverage backtest.

## 5.0.0

Dynamic Nelson–Siegel, instrument pricing, and the immunization report.

## 4.0.0

Bend prices the integer model. Holdings, trades, and compare land in the browser.

## 3.0.0

The TypeScript workspace becomes the interactive toolkit. Short-rate regimes and priced sleeves arrive. Parametric books keep their results.
