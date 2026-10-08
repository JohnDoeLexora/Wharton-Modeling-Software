# Build status

Schema 3 of the TypeScript workspace is the interactive toolkit (`npm run dev`), now at app version 5.0.0. The Bend 2 package in `bend/` is the reference for the locked arithmetic. Neither engine contains a recommended portfolio, reserve, facility contribution, or co-sponsor range. The holdings editor starts empty.

Checked on 2026-10-08.

## What changed in V5

- The default curve is dynamic Nelson-Siegel (level, slope, curvature), with Svensson as a fourth factor and the version-4 three-point curve kept for the model-risk panel. The five regime buttons stay drift templates on the level. Floor policy `zero-floor-on-quotes`: a quoted annual zero does not go below zero in TypeScript or in Bend. Factor states are not floored. The version-4 TypeScript floor of −5% is retired. Assumption schema stays 3. The browser key for assumptions stays `gao-toolkit-v3`. The holdings book stays `gao-toolkit-v4-book`.
- A curve CSV (Treasury wide percent file, or long `as_of, tenor_years, par_yield`) is bootstrapped to annual zeros and fit by OLS. Factor κ and σ are an annual AR(1), κ = 1 − φ. `scripts/fetch_treasury.py` writes `data/treasury_par_yields.csv`, `data/french_ff_annual.csv`, and `data/PROVENANCE.md`. The backtest rolls a bill book and a duration-style book over consecutive 7-year windows of that history. Equity total return, when the file has it, is context and is not a portfolio weight.
- Treasuries are priced from the semiannual coupon schedule: dirty, clean, accrued, key-rate durations, hold-to-maturity at the purchase yield, and mark-to-market on the current curve. A bond ETF is maturity buckets plus an expense ratio, with roll-down and constant-maturity rebalancing. A target-maturity fund is cash on its liquidation date. A bills ETF earns the short quote minus the expense, and the reinvestment path is explicit. The immunization report shows liability present value, duration, convexity, key-rate durations, the gap against the imported buckets, and surplus-at-risk.
- Bend runs a 16-trial fixed-point fan (seed 42, years 2027–2030, half equity and half the 5-year quote). `bend/laws/FAN.bend` rechecks the integer contract (trial count, seed, 4% start, case contributions) so the checker does not reduce the F32 fan beside every other module. The proven kernel's F32 reduction of one trial passed 6 GB and was killed, so the dollar band is executed parity: `fan_trial0`, `fan_mean`, `fan_min`, and `fan_max`. New laws also cover positive decreasing Nelson-Siegel discount factors, a coupon dirty price equal to the discounted cash flows, a target fund equal to cash at maturity, monotone expense drag, and the zero floor.
- The Tracking tab imports fills and labels the result WInS P&L. That number does not enter `runModel`. Rebalance ideas respect the trade budget and the volume multiple. A Trading Note draft is built from role, sleeve, weight, and modeled stats and stops at 300 characters. The Curve tab plots standard error against trial count and reruns headline metrics under Nelson-Siegel, the three-point curve, and 1.5× level volatility.
- Example shapes for a curve, buckets, fills, and a tiny equity file live under `examples/`. They are not loaded at startup.

## Verification on 2026-10-08

- `npm run verify` exited 0. That is 84 Vitest tests, `npm run build`, `bend bend/laws/LAWS.bend --verdict` and `bend bend/laws/FAN.bend --verdict` each printing `ALL PROOFS CHECK`, and parity. Parity matched 63 deterministic keys, including the locked cash flows, the Nelson-Siegel discount factors, and the 16-trial fan (`fan_trial0` 570859, `fan_mean` 515116, `fan_min` 414380, `fan_max` 684805). The 200-trial parametric sample agreed with the Python cross-check: P(funded) 0.72, p5 391938.17, p50 555189.44.
- Headless Chrome on the production preview walked the Curve tab (example snapshot residuals, the 2016 history windows, and the 50-trial model-risk panel), the Instruments tab (dirty, clean, accrued, and the immunization report), and the Tracking tab (example fills, the WInS P&L label, a trading note under 300 characters, and the counter after an edit). The holdings editor kept the example tickers. Document `scrollWidth` stayed within `clientWidth` at 1280×900 and at 390×844.

## What changed in V4

- Bend now prices the V3 model in integer arithmetic: short-rate regimes and a three-point curve, duration and convexity with carry, credit spread, default, and recovery, one-factor names with jumps and FX, four reserve methods, glide weights, and the facility gift with a 2031 band. Laws cover locked cash flows, carry when the yield does not move, a mark-to-market price that falls as yield rises, hold-to-maturity par plus coupons, weights of 1,000,000 ppm, a zero-yield ladder of 500,000, a gift that stays inside the surplus, and a trade sheet that does not exceed the capital. `bend bend/laws/LAWS.bend --verdict` prints `ALL PROOFS CHECK`.
- `npm run verify` runs the Vitest suite, `npm run build`, the Bend verdict, and `npm run parity`. Parity compares Bend’s printed goldens with `src/core/golden.ts`, and compares a 200-trial parametric sample with `reference/python/`. That Python file is a copy of the independent analysis harness. It is a cross-check, not a book of holdings. The TypeScript short rate floors at −5%. Bend’s short rate does not go below zero. The goldens are the non-negative paths.
- A holdings editor (CSV in and out, sleeve totals), an editable rules form defaulting to the 2026 WInS Trading Details note, a market-snapshot import, and a trade sheet of whole shares or bond face. Totals equal the capital. Each order is pass or fail with a reason. Compare scores two books on one seed and lists what changed. Exports are prefixed `EXTERNAL - ` or `INTERNAL - `. An annotated HTML page restates the sample in plain sentences.
- A decision screen, five named stresses, a stacked glide preview, a run-hash cache, and a trial counter while a sample is in flight. Tooltips name the source of the assumption. Example CSVs live under `examples/` and are not defaults.
- The browser key for the holdings book is `gao-toolkit-v4-book`. Assumption schema stays 3 (`gao-toolkit-v3`).

## Verification on 2026-10-07

- `npm run verify` exited 0. That is 71 Vitest tests, `npm run build`, `bend bend/laws/LAWS.bend --verdict` printing `ALL PROOFS CHECK`, and parity. Parity matched 47 deterministic keys, including the locked cash flows and the SplitMix word. The 200-trial parametric sample agreed with the Python cross-check: P(funded) 0.72, and the same p5 and p50.
- Headless Chrome at 1280×900 walked Decision, Holdings (CSV import, arrow keys between cells, sleeve totals), Trades (rules, snapshot import, a failing stock-price check with a reason, then a sheet that adds up to the capital), Compare (a diff and a paired sample with a standard error), Export (annotated HTML tagged INTERNAL, then the header tag back to EXTERNAL), Stresses (all five), and the stacked glide preview. The same pages were opened at 390×844. Document `scrollWidth` matched `clientWidth` at both widths. The annotated file does not contain “we recommend”.

## What changed in V3

Schema 3 of the TypeScript workspace is the interactive toolkit. The earlier Bend package proved the locked case arithmetic and the identity that a bond return equals its carry when the yield does not change.

## What changed in V3

- A short-rate path with five regime templates (rising, flat, falling, shock-up, stagflation) and a three-point curve. One path per trial, on stream 4. Choosing a regime copies the illustration into the drift fields and leaves the short-rate level and the mean-reversion speed alone.
- Sleeves can be priced as parametric μ/σ, T-bills, intermediate Treasuries, long Treasuries, credit, a Student-t equity index, or a one-factor satellite basket. Parametric sleeves ignore the rate path, so a version-2 book keeps its results. Mark-to-market wealth includes the duration price term. Hold-to-maturity wealth keeps the carry and any default loss.
- The satellite editor lists the tickers from `case-materials/satellite_candidates.pdf`. Betas, volatilities, jumps, FX, and fees start as placeholder assumptions at weight 0.
- The reserve tab still has the four flat-yield methods. A second table shows present value on the curve, a nominal $500,000, a T-bill ladder, and a duration-matched book under each regime template with volatility forced to zero.
- Sample metrics include p1, P(fully funded), CVaR 5%, max drawdown, facility percentiles, the 2031 conditional band, sleeve price terms, Sharpe, Sortino, and standard errors. Compared mixes share the master seed.
- `npm run sweep` writes a mix × regime grid to `out/sweep`. The stress returns in that file are labeled assumptions.
- Assumptions are schema 3. The browser key is `gao-toolkit-v3`. A stored v1 or v2 workspace migrates: missing pricing becomes parametric, a missing rate card is a flat zero curve, and a missing basket is the candidate list at weight 0.
- Streams 4, 5, and 6 are the short rate, credit default, and single-name shocks. Streams 1–3 are unchanged.

## Verification on 2026-10-07

- `npm test` passed 60 tests in `engine.test.ts`, `streams.test.ts`, `v3.test.ts`, and `guide.test.ts`.
- `npm run build` typechecked and wrote `dist/`.
- `bend bend/laws/LAWS.bend --verdict` printed `ALL PROOFS CHECK` on Bend 2.0.36. `bend bend/main.bend` printed `boy_2033_annual 450000`, `stream_rates 4`, `stream_credit 5`, `stream_idio 6`, and `bond_zero_dy 50000`.
- Headless Chrome on the preview build, at 1280×900 and 390×844: the rate-regime picker, satellite basket, mix table, mark-to-market panel, sample metrics, and regime-funding table rendered. Document `scrollWidth` matched `clientWidth` at both widths. Choosing Rising copied a 0.75 pace and left the short rate at 0; the base path then showed a 2.25% short rate at the beginning of 2033. Typing `TSM` left one basket row. Switching the first sleeve to long Treasuries filled duration 16. Adding the current glide produced a “Comparison mix” row on the projection tab. A cleared browser showed beginning-of-2033 wealth of $450,000. Facility, ledger, research, export, and the modeling guide still opened. The guide contains “Four reserve methods” and does not contain “we recommend”.

The version-2 notes below are the previous toolkit. The app that runs now is version 3.

## Bend engine

## Bend engine

Bend 2.0.35 (`bend version`). Sources live in `bend/`. Laws live in `bend/laws/LAWS.bend`. The TypeScript files were left in place.

- `bend/case.bend` locks year N = 2026+N, the 300,000 and 150,000 contributions, ten 50,000 payments from 2033 through 2042, and a WInS profit of 0.
- `bend/fix.bend` is the fixed-point convention: whole dollars, and parts per million where 1,000,000 ppm is 1. `muldiv` is floor of a 64-bit product.
- `bend/glide.bend` holds two sleeves. The starter knots are 500,000 / 500,000 at 2027 and 2033. Each sums to 1,000,000 ppm. Callers can pass other knots; the laws check the sums of these knots and of the interpolated years 2027, 2030, 2033, and 2042.
- `bend/project.bend` walks 2027 through 2042. Annual rebalance gives the funding sleeve the remainder so dollars are conserved. Drift splits only the new contribution. The zero-return, zero-fee path is a caller input (`zero_returns`), and both modes report beginning-of-2033 wealth 450,000.
- `bend/reserve.bend` is backward induction. At a 0 yield the ladder is 500,000, and rolling that reserve forward ends at 0. A surplus margin is a caller-supplied ppm.
- `bend/facility.bend` takes a gift only from wealth above the reserve. On 450,000 against 500,000 the residual and the contribution are 0.
- `bend/rng.bend` is SplitMix64 on `(seed, stream, trial, step, dimension)`. Stream ids are 1 through 6: portfolio, reserve, bootstrap, rates, credit, and single-name. The 2031–2032 conditional band reuses stream 1. The raw 64-bit word matches `src/core/rng.ts`. F32 uniforms use the top 24 bits of that word.
- `bend/bond.bend` prices a bond in parts per million. With a zero yield change, `mtm_ppm` equals the carry. A 15-year duration loses more, in ppm, than a 0.4-year bill. Negative results saturate at 0, so the loss comparison is the positive `duration_loss_ppm`.
- `bend/corr.bend` stores one off-diagonal in ppm, clips it at 999,000, and applies a caller-supplied stress. The diagonal is 1,000,000 by construction, so the matrix stays symmetric.
- `bend/shock.bend` maps caller-supplied mu and sigma through a normal or lognormal F32 formula. The scenario table does not read it.

Commands:

```bash
bend bend/main.bend
bend bend/laws/LAWS.bend
sh bend/check.sh
npm run dev
```

`bend bend/main.bend` prints `boy_2033_annual 450000`, `boy_2033_drift 450000`, `ladder_yield_0 500000`, `roll_end_yield_0 0`, and `residual 0`. The audit draw for seed 42, stream 1, trial 0, step 2027, dimension 0 is `draw_hi 2195427346` and `draw_lo 1420824054`.

### Verification done here for Bend

- `bend version` reported `bend 2.0.35`.
- `bend --check-only` on `fix`, `case`, `glide`, `reserve`, `facility`, `rng`, `corr`, `shock`, `project`, and `main` exited 0.
- `bend bend/laws/LAWS.bend` printed `ALL PROOFS CHECK` and exited 0. The file includes the contribution schedule, the ten-payment schedule, the 450,000 zero path (annual and drift), knot sums of 1,000,000 ppm, the 500,000 ladder, the facility residual of 0, stream ids, and three frozen SplitMix64 words.
- `bend bend/main.bend` printed the locked lines above.
- The React toolkit was not removed. On 2026-10-06, `npm test` passed 48 tests (`engine.test.ts`, `streams.test.ts`, `guide.test.ts`).

### Bend limits

- Two sleeves. The TypeScript workspace can edit a longer sleeve list.
- Whole dollars and truncating ppm division. A 5% TypeScript path still uses IEEE floats (`docs/HOW_TO_MODELING.md`). The Bend demo does not reprint that float path.
- F32 Box–Muller is not bit-identical to the JavaScript `Number` normal. The shared audit value is the 64-bit SplitMix word.
- The proved demo is one deterministic scenario, plus the stream function. It does not print a multi-trial percentile fan, a sensitivity table, or a run package. Those stay in the TypeScript app.
- No WInS connection, no bond CUSIPs, no tax model, and no optimizer.

## What changed in V2

Version 2 of the TypeScript toolkit is in this repository. It is a workspace for exploring the Laura Gao case. It does not contain a recommended portfolio, reserve, facility contribution, or co-sponsor range.

Checked on 2026-10-02.

## What changed in V2

- One master seed and three counter-based streams. Stream 1 is the portfolio (step = calendar year, dimension = sleeve). Stream 2 is the reserve shortfall sample (same trial index, different shocks). Stream 3 picks block-bootstrap starts. The 2031–2033 conditional band reuses stream 1 at 2031 and 2032. It restarts wealth at that year’s policy weights, so an annually rebalanced path matches and a drifted path generally does not.
- Correlation stress is added to off-diagonal entries and clipped. A matrix that is not positive semidefinite is repaired, with a warning, and the inspector shows the matrix the factor used.
- The ten $50,000 payments are a liability schedule next to the reserve methods. Pathwise funded ratios are reported for the shortfall sample. Portfolio funded ratio is beginning-of-2033 wealth on stream 1 divided by the reserve target.
- Assumptions carry `schemaVersion` 2. A stored version-1 workspace migrates forward. The browser key is `gao-toolkit-v2`.
- Local one-at-a-time sensitivities, on demand, for 2033 wealth and the active contribution-band endpoints against μ, σ, the scenario base return, the first-sleeve glide weight, and the discount yield.
- A run ledger stores named immutable snapshots (assumptions hash plus an output summary) and compares two of them. A save computes the sample for the snapshot it stores, so a click during an update does not pair new inputs with the previous sample.
- Export writes one run package: assumptions, results, CSV text, the liability schedule, tolerances, and a methodology footnote (method names, seed, stream ids, software version, git commit). The hash identifies inputs. The commit identifies formulas.
- The assumption inspector shows case contributions, policy weights by year, and the correlation matrix actually used. Charts include a wealth fan, a reserve waterline, and contribution ranges, with SVG and PNG download buttons.
- Monte Carlo and sensitivity run in a web worker so editing assumptions does not freeze the page. The previous sample stays on screen until the new one arrives.

## How to run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints, usually `http://127.0.0.1:5173`. `npm run build` typechecks and writes `dist/`. The short git commit is read at build time and stored in the run package.

Optional sentiment service (large download; skip it if you only want the portfolio tools):

```bash
python3 scripts/setup_finbert.py
.venv/bin/python services/finbert/server.py
```

`GET http://127.0.0.1:8765/health` reports whether packages and cached weights are present. The server does not download the model. Dev mode proxies `/finbert` to port 8765.

To reproduce a run, export **Run package JSON** from the Export tab, or save a named row on the Run ledger and compare two rows. The package’s methodology footnote lists the seed, the stream ids, and the commit. Read [docs/HOW_TO_MODELING.md](docs/HOW_TO_MODELING.md) before treating a chart as a conclusion. The same text is the **How to model** tab.

## Verification done here

- `npx vitest run`: 48 tests passed (26 engine, 21 stream/sensitivity/ledger/package, 1 guide render). The 5,000-trial two-sleeve case inside that run finished in 919ms.
- `npm run build` (`tsc --noEmit && vite build`) succeeded after the UI work. The worker bundle is emitted separately.
- Headless Chrome walked Assumptions, Projections, Operating reserve, Facility & range, Run ledger, Research, Export, and How to model at 1280×900 and at 390×844. Zero-default beginning-of-2033 wealth is $450,000. The teaching example (a labeled 7% / 3% blend, not a strategy) shows base 2033 wealth of $593,471. The draft range text contains “Exploratory” and does not contain “we recommend”. The status line names streams 1, 2, and 3. Compute sensitivities returned a Greek table. Two ledger rows were saved, compared (base 2033 $593,471 versus $450,000, different assumption hashes), and the teaching row was loaded back. The demo lexicon scored two headlines. The export panel shows a 64-character assumptions hash and, with the footnote open, “not an investment recommendation”. ArrowRight moves from Assumptions to Projections. Document `scrollWidth` matched `clientWidth` at both sizes (1265 and 390). Wide tables scrolled inside their wrappers. On the phone-sized viewport one guide table was wider than its wrapper (341 versus 329) and scrolled inside it.
- `curl http://127.0.0.1:8765/health` failed to connect. The FinBERT service was not started in this session, and the model weights were not downloaded.

The browser check used headless Chrome, not a physical phone. CSV, SVG, and PNG download buttons were not clicked. The CSV helpers are covered by unit tests.

## Known gaps

- No connection to WInS. Trading profit and loss cannot be entered, and the app does not place trades.
- Annual steps only. Parametric returns are independent across years, normal (with a floor) or lognormal. Block bootstrap is available when a history is typed in. It ignores μ, σ, and the Gaussian copula.
- Stream 2 is a different shock from stream 1 on purpose. The conditional band reuses stream 1 but restarts at policy weights, so it is not a continuation of drifted sleeve balances.
- A custom reinvestment path redraws the reserve schedule. Sizing still uses the method’s rate. The schedule is where the gap shows up.
- No bond CUSIPs, no tax model, no optimizer, and no inflation adjustment of the $50,000 payments.
- Sensitivity is a local central difference on five inputs. It is not a search for a portfolio.
- The ledger summary does not store every Monte Carlo path. The run package does.
- Workspace state is `localStorage` in this browser only.
- FinBERT is optional and not preinstalled. The demo lexicon is a word list, not the model.
- `npm audit` reports 2 moderate findings, both through Vitest’s `@vitest/mocker` (GHSA-82fw-gwwq-j7x9). They were left as-is. `npm audit fix --force` would jump to Vitest 5 and was not run.
