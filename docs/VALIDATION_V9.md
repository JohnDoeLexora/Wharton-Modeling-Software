# Out-of-sample checks (V9)

These are checks of a stated band. They are not a recommendation and they do not pick a portfolio.

## Walk-forward of the p10–p90 band

`walkForwardRange` in `src/core/validationReport.ts` does the following at each origin:

1. Compound returns over a two-year window.
2. Set the band to the 10th and 90th percentiles of windows that end at or before the origin.
3. Score the next two-year compound. That compound does not enter the band.

On a constant series the coverage is 1. On a series that ends in a crash the coverage is below 1. Both are unit tests.

Historical series: Ken French market excess return plus the bill return in `data/french_ff_annual.csv`, compounded from the monthly rows into a calendar year, and only years with 12 months. That is 1927 through 2025 (99 years). 1926 and 2026 are partial in this file and are left out. With one session per year the two-year band scores 93 origins and hits 81. Coverage is 81/93 = 87.1%. The stated band is 80% of outcomes. An expanding percentile band on this history ran a little wide of 80%.

The synthetic daily file is about five years. A two-year window at 252 sessions needs more history than that file has before the first scored origin, so that file does not produce a coverage number.

## VaR backtest on the example universe

`npm run risk-report` on `examples/daily-prices-sample.csv` and `examples/risk-book.csv` (200 trials for the paired wealth comparison; the VaR rows use the daily history). Kupiec p-values on the new EWMA Student-t forecast, 95%:

| Name | 95% hit rate | Kupiec p | Pass at 0.05 |
| --- | --- | --- | --- |
| ADR | 5.1% | 0.85 | yes |
| CALM | 5.4% | 0.56 | yes |
| GAP | 3.4% | 0.01 | no |
| ETF | 2.6% | 0.00 | no |

Two of the four scored names pass. GAP and ETF do not. A pass is a hit-rate check. It is not a reason to hold the name. The example weights are an illustration of the file shape.
