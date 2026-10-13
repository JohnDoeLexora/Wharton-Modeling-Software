# Model specification

This file is the source of truth for the toolkit. Code comments cite the section numbers below. The toolkit runs the arithmetic a team types in. It does not prescribe a portfolio, a reserve policy, a glide, or a facility gift.

## 1. Scope

The TypeScript year step is the canonical engine. Python `reference/python/kernel.py` is a thin reimplementation of that step, fed the same counter-based SplitMix64 draws. Bend locks integer identities of the case cash flows and of the kernel algebra. There is one portfolio engine.

Case cash flows are locked:

- $300,000 at the beginning of 2027
- $150,000 at the beginning of 2028
- a reserve for ten nominal $50,000 payments, 2033 through 2042, carved at the beginning of 2033
- the remainder, under the active facility rule, can become the facility gift
- the co-sponsor range is a 2031 communication band

WInS trading capital is $300,000. WInS profit and loss is not an input to `runModel`.

## 2. Curve

The default curve is dynamic Nelson–Siegel (level, slope, curvature). Svensson adds a fourth factor. The version-4 three-point curve remains available as a model-risk comparison. Quoted annual zeros do not go below zero (`zero-floor-on-quotes`). Factor states are not floored.

### 2.2 Loadings and skipped shocks

Nelson–Siegel loadings depend only on λ and the tenor. A path reuses the three loadings when λ does not change. Slope and curvature shocks are not drawn when their volatilities are zero. Counter-based streams make a skipped coordinate irrelevant to every other draw.

## 3. Case dates

Projection years run from the beginning of 2027 through the beginning of 2042. Beginning-of-2033 wealth is recorded after that year's rebalance and before that year's return. The zero-return path with the locked contributions and no costs is $450,000 at the beginning of 2033. A zero-yield ladder of the ten payments is $500,000.

## 4. Pricing

Sleeves may be parametric μ/σ, T-bills, intermediate or long Treasuries, credit, a Student-t equity index, or a one-factor basket. Parametric sleeves ignore the rate path.

A priced bond return is carry minus duration times the yield change, plus one-half convexity times the yield change squared, minus a default loss. Hold-to-maturity drops the price term and keeps the carry. The kernel overlays in §7 are applied inside `fillPricedSchedule` only when the matching flag is on. With `assumptions.kernel` omitted, this block is the version-7 pricer.

## 5. Year step

### 5.1 Order

One beginning-of-year step, shared by the main path, mixes, the 2031 continuation, and the Python kernel:

1. Charge the new contribution one round trip, `min(contribution, contribution · bps/10000)`.
2. Rebalance from drifted weights to the policy. Annual mode charges `min(1, 0.5 · Σ|policy − drifted| · bps/10000)` of pre-contribution wealth. Drift mode leaves balances and adds the net contribution at the policy weights.
3. Record beginning wealth.
4. Earn the simple return. A null return is the terminal date 2042: costs still apply, and there is no growth.

The portfolio simple return is the wealth-weighted sleeve return. A positive gain-tax rate scales the book down by the tax. The default tax is zero.

`stepYearMut` writes into caller-owned balance arrays. The hot path reuses those arrays and a priced return schedule. That reuse does not change the numbers.

### 5.3 Conditional 2031 range

The anchor is one wealth, the scenario or the median, not each trial's own 2031 balances, unless the team selects that source. The continuation is return-only: drift rebalance, no contribution, no transaction cost, for 2031, 2032, and terminal 2033. Starting balances are the anchor times the 2031 policy weights.

## 6. Random numbers

### 6.1 SplitMix64

Draws are counter-based. The key is `(seed, stream, trial, year, dimension)`. Streams are 1 portfolio, 2 reserve, 3 bootstrap, 4 rates, 5 credit, 6 idiosyncratic. The audit word for seed 42, stream 1, trial 0, step 2027, dimension 0 is the high word 2195427346 and the low word 1420824054.

A uniform uses the top 53 bits: `(bits + 0.5) / 2^53`, so it is never 0 and never 1. A standard normal is Box–Muller on dimensions `2k` and `2k+1`. The same `u` and `v` produce cosine on the even dimension and sine on the odd dimension.

Seeds outside the integers 0 through 2^32 − 1 are rejected. The run does not silently substitute another seed.

### 6.3 The Philox engine is deleted

`reference/python/sim.py` used to simulate a whole book with a NumPy Philox generator, one stream per shock family, and its own year loop. That is a second engine. It is not equivalent to §6.1, and it is not used.

What remains in `sim.py` is the three bond helpers `bond_price`, `par_dur_conv`, and `curve_y`. The parity checker extracts them by name. The portfolio path is `kernel.py`, which calls the same year step as §5.1.

Features that lived only on the Philox path are flags on this kernel (§7), not a second simulator. Turning the flags off leaves the canonical sample unchanged, including the priced five-mix median locked in `docs/perf-baseline.json`.

## 7. Optional kernel overlays

`assumptions.kernel` is omitted by default. `kernelEngaged` is false for `undefined` and for an empty object. When a flag is on, the overlay is reported on `ModelOutput.kernelReport`. The report is a description of the overlay. It is not a recommendation.

### 7.1 Markov regimes

A Markov chain on the equity simple return. The default two-state transition is `[[0.85, 0.15], [0.35, 0.65]]`. The three-state default is `[[0.8, 0.15, 0.05], [0.25, 0.6, 0.15], [0.2, 0.3, 0.5]]`. Default drags are `0`, `−0.08`, and `−0.18`. The uniform is stream 1, dimension 400. Standard errors of a transition row are `sqrt(p(1−p)/n)`.

### 7.2 Shared Student-t

One chi-square, built from the same stream-1 normals the market Student-t already uses at `MARKET_DIM`, scales the market factor. When the flag is on, basket residuals share that scale. The market kernel itself does not move, because it already consumed those dimensions.

### 7.3 Sector and USD/TWD

An equity-index add-on. Sector volatility multiplies a normal on stream 6, dimension 21000. USD/TWD volatility multiplies the next dimension and enters as a multiplicative currency return. Zero volatilities leave the return unchanged.

### 7.4 Investment-grade spread

`spread + κ (θ − spread) + σ Z`, then the sleeve's spread beta times `max(0, −equity)`. Zero κ and zero σ leave the spread where it was, before the equity term. The shock is stream 5.

### 7.5 Issuer credit

Default intensity is `base · exp(β · max(0, −equity))`, capped at 1. It replaces the sleeve's default probability on the same credit uniform. A non-positive base stays at zero.

### 7.6 Target maturity

If the flag is on and the sleeve has `targetYear`, duration is pulled linearly to zero at that year. At the first projection year the duration is the sleeve's duration. At the target year it is zero. Without the flag, `targetYear` is ignored.

### 7.7 Binned 2031 range

Wealth is sorted into equal-count bins. The reported low and high are the mean gift in the bottom and top bins. This is a summary of the sample. It does not replace the facility rule.

## 8. Statistic verification

A quoted statistic carries a claim id. `verifyClaims` recomputes it on three windows:

- 1-year daily, 252 observations, annualized with `sqrt(252)` where the statistic is a volatility or a Sharpe
- 3-year weekly, every 5th price, 156 observations, `sqrt(52)`
- 5-year monthly, the last price in each `YYYY-MM`, 60 observations, `sqrt(12)`

The citation states all three, the source file, the SHA-256 of that file, the as-of date, and the estimator. A quote outside the range of the finite windows, beyond `max(1e-12, |v| · 1e-9)`, is flagged. An as-of date more than five weekdays before the review date is stale.

Estimators: sample standard deviation with `n − 1`; OLS beta with the usual residual standard error; Pearson correlation; peak-to-trough drawdown of the price index; annualized geometric return; Sharpe with a zero excess rate; yield, duration, and spread as means of the matching level column.

`scripts/fetch_free.py` may download Treasury, FRED, or Ken French files. Each attempt is appended to `data/FETCH_LOG.md`. Issuer ETF holdings are a local CSV the team already has. The fetch is optional and is not part of `npm run verify`.

## 9. Attribution

Weights are the caller's. The factor block is market, size, value, momentum, and quality when the team supplies those columns, plus rates (level and slope), credit spread, USD/TWD, and sector factors when those columns are in the exposure matrix.

Total variance is `w′ Σ w`. Factor variance is the systematic piece. Specific variance is the diagonal idiosyncratic piece. Marginal risk is `Σw / σ`. Component (Euler) risk is weight times marginal, and the components sum to total risk. The diversification ratio is `Σ |wᵢ| σᵢ / σₚ`. Meucci's effective number of bets is the exponential of the entropy of the positive eigenvalues.

A covariance with a negative eigenvalue is clipped at zero and rebuilt. `repaired` is true only in that case. That repair is separate from the Higham repair of the Monte Carlo correlation.

Ex post, Brinson allocation, selection, and interaction sum to the active return against the benchmark the team chose. Tracking error of the active weights splits into factor and specific, and those two pieces sum in variance. Rolling attribution is multivariate OLS on a window the caller sets.

A paired difference of two wealth vectors that share a seed is the mean of trial-by-trial gaps, with the usual standard error of that mean.

## 10. Reserve ladder

The liability is ten $50,000 payments, 2033 through 2042. Present value at a flat yield is the annuity-due formula. At a zero yield it is $500,000. Key-rate durations bump a tenor band. Convexity is a central second difference.

The cash-flow match is the linear program: minimize cost subject to covering each payment (plus a surplus buffer), round lots, a maximum fraction of quoted volume, bid and ask, and the $300,000 capital. The solver walks payment years from the last date backward and buys the cheapest instrument that pays that year. For zero-coupon instruments this is optimal for that program. Coupon bonds can overshoot later years; the report shows the cost anyway. A bill ladder discounts each payment at the yield the team typed. A duration match buys the bond whose modified duration is closest to the liability's, inside the same constraints.

The report compares the three costs, the share of yield shifts on which assets still cover the liability, and a rebalancing turnover. Quote richness is the WInS yield minus the Nelson–Siegel fair yield, in basis points, and the ask-versus-fair gap in dollars per trade. The report is not a reserve decision and not an order.

## 11. Exploration frontiers

Mean-CVaR, a Michaud resampled cloud, Black–Litterman with the team's views, and a worst-case mean on the ellipsoid `(μ − μ₀)′ Σ⁻¹ (μ − μ₀) ≤ κ²` are labeled "Exploration under assumptions." None of them is written back to the book. There is no default allocation.

The model-risk spread runs the same book under the return model, the shock model, the correlation regime, and, when a return series is supplied, the V6 estimators (sample daily, EWMA, realized one-year, and GARCH). Headline metrics are tabulated. A breakeven panel reports the equity mean at which a straight line through P(funded) would cross a threshold the team typed. The slope is an assumption.

## 12. Scenarios

The library has nine rows: 1973–74, 1987, 2000–02, 2008, the 2013 taper, 2020, the 2022 rates shock, a Taiwan Strait hypothetical, and a stagflation illustration. Historical rows carry a source. Hypothetical rows are marked.

A replay lays a realized annual path onto 2027–2042, aligned at a start year the team chooses. Factor shocks map to holdings through the exposure matrix the team supplies. Reverse stress searches for the smallest scale of a negative shock that puts wealth under the reserve. A two- or three-state Markov fit on a return series reports the transition and multinomial standard errors.

The five stress buttons already on the Stresses screen are unchanged. They are overlays, not a recommended book.

## 13. Exports and reproduction

A tear sheet is HTML or a text PDF. The title prefix is `INTERNAL - ` or `EXTERNAL - `, chosen at export. The sheet lists holdings, risk lines, the citation table, scenarios, the reserve and the gift band, and methodology footnotes. It says the output is exploratory.

Per-trial CSV and Parquet stay on the export screen. A JSON bundle stores the assumptions, the seed, the version, the git hash, data hashes, and the wealth vector. `npm run reproduce -- bundle.json` runs the bundle again and requires the wealth vectors to match within `1e-6`, with the same master seed.

The board workbook is an XLSX file of the headline rows.

## 14. What this specification does not do

It does not select weights. It does not turn a scenario into a probability. The trial count on the assumptions form stays the team's choice, from 50 to 20,000, and the main sample does not stop early. The Curve lab can plot standard error against N for pseudo-random, antithetic, and Sobol draws, and it can stop a separate sample when a target standard error is met. That lab does not rewrite the form.

## 15. Parity

Twenty golden configurations agree between TypeScript and `kernel.py` to a relative error of `1e-9` or better on the first path and on beginning-of-2033 wealth. Five richer configurations also agree on p5, p50, p95, P(funded) at a $500,000 reserve, and the gift, within three standard errors. Bend laws lock the integer forms of a zero drag, a midpoint target duration, a zero-kappa spread, Euler components that sum, and a one-bet entropy. Those laws do not print golden lines.

## 16. Dated accrued interest

The tenor helper `accruedInterest` is unchanged: on a coupon date, accrued interest is zero. A dated quote uses ACT/ACT ICMA for a Treasury and 30/360 US (NASD) for a corporate. Accrued interest is the period coupon times the day-count fraction. Inside an ex-coupon window the fraction is negative, so the dirty price is the clean price plus a negative accrual. `WINS_SETTLEMENT` (`2026-02-20`) is an illustrative date. It is not a trade and it is not an input to `runModel`.

## 17. Jumps in the portfolio engine

Detection uses GARCH-standardized residuals of demeaned returns, or EWMA when GARCH does not converge, with that fallback flagged. The threshold is a Student-t quantile aimed at about 0.02 false positives per year. The annual step draws a compound Poisson count and size `jumpMean`, and subtracts λ times that mean, so the jump does not add drift. Scenario paths use the compensated mean, which is zero. The Student-t degrees of freedom are fit on the returns that were not jumps. A name with at least three years of history and no detected gap does not receive a class-fallback jump.

Bend `Names.golden_jump` and the TypeScript `nameReturnPpm` helper still subtract probability times loss. That product is the locked integer identity `40000`. It is not the compensated scenario return of the float engine. Python `kernel.py` has no jump term. `jump_variance_ppm` stays the Poisson second moment, and the Bend law `jump_var` stays `18000`.

## 18. A trial-curve reserve with no curve

When discount mode is `trial_curve` and rate volatilities and the curve level are all zero, the reserve is the annuity due at the stated `discountYield`, and the run warns that there is no stochastic curve. A zero-yield ladder of the ten payments remains $500,000. That identity is the zero-yield case, not the teaching book's 3% hurdle.
