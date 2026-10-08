# How to model the Laura Gao case

This guide explains the arithmetic in the Gao modeling toolkit and the questions people usually ask when a portfolio has to fund a known nominal liability and also leave room for an uncertain gift. It is a manual for the software. It is not a strategy for Laura, and it does not pick a reserve, a glide path, or a facility contribution.

The same page is available in the app under **How to model**.

## What the toolkit will and will not do

The competition materials are explicit: there is no single correct strategy. Teams differ on risk, liquidity, funding confidence, the facility contribution, and how much flexibility to keep. This software is a place to run those differences side by side.

It will:

- Lock the case cash flows and dates so they are not retyped by accident.
- Project an undivided portfolio under bull, base, and bear returns you type, and under a seeded Monte Carlo sample.
- Price bill, treasury, and credit sleeves from a short-rate path, and show mark-to-market wealth next to a hold-to-maturity wealth path.
- Run a one-factor satellite basket. The candidate tickers are listed. Their betas, volatilities, jumps, and FX numbers start as labeled placeholders.
- Size the operating reserve with several standard methods and roll it forward from 2033 through 2042. A second table shows four curve-based sizes under each rate-regime template.
- Apply rules you define to turn post-reserve wealth into a facility contribution and a flexibility balance.
- Build a communication range with an explicit method, and write a draft sentence that names that method.
- Score optional headlines with FinBERT, or with a clearly labeled demo word list, and store the scores as research notes.
- Edit a holdings book (ticker, sleeve, weight), check orders against rules you can edit, and export a trade sheet that adds up to the capital.
- Compare two holdings books on one seed, and run named stresses on the book that is loaded.
- Read one screen of the current sample: P(funded), a low wealth percentile, the median gift, the 2031 range, the worst rate-regime template, and the worst stress you have already run.

It will not:

- Choose an allocation, a reserve, a certainty definition, or a facility amount.
- Add WInS trading profit or loss to the long-term projection.
- Apply personal taxes or a Taiwan legal structure.
- Turn a sentiment score into a trade or a portfolio weight.

Amber fields in the app are assumptions. If a number is already filled in at startup, it is either a case fact or a zero. The **teaching example** button loads round figures so the charts move. Those figures are not capital-market assumptions. Do not paste them into a Trading Note, the IPS, or the Final Report.

## Case facts the model locks

Year N is 2026 + N. Year 0 is 2026, the present, before any investment.

| When | What happens to the portfolio |
| --- | --- |
| Beginning of 2027 (Y1) | Contribute $300,000. |
| Beginning of 2028 (Y2) | Contribute $150,000. |
| 2029 through 2032 | No contributions and no withdrawals. Living expenses stay outside the portfolio. |
| 2031 (Y5) | Communicate a credible range for the 2033 facility contribution. No cash flow. |
| Beginning of 2033 (Y7) | Set aside the operating reserve. Pay the first $50,000. Decide a facility contribution from what remains. |
| Beginning of each year 2034–2042 | Pay $50,000. The last payment is at the beginning of 2042. |

The ten payments are a fixed $50,000. They are not inflation-adjusted. All ten must be funded by the portfolio. Co-sponsors, grants, and program fees are not a backstop for this operating commitment. Funding the residency after 2042 is outside the case. The total cost of the facility is unknown, and the case does not ask you to estimate it.

There is no predetermined facility contribution. Committing every dollar left after the reserve can remove flexibility the project may need. That tradeoff is the team’s.

## Two kinds of capital

Goal-based investing separates money by the job it has to do.

**Liability capital**, here the operating reserve, exists to pay a schedule. The useful question is not “what return can we earn?” It is “what has to be true for every payment to clear?” People often hold this capital in cash, Treasury bills, or a bond ladder whose maturity dates line up with the payments. The return is the price of certainty. A higher yield shrinks the reserve. It also means the payments depend on that yield actually being earned.

**Growth capital** is what remains, or what you deliberately keep invested for the facility gift and for flexibility. It can tolerate a wider range of outcomes because it is not the funding for the ten payments. Mixing the two jobs in one unmarked pool makes it easy to spend liability capital on the facility, or to discover in a bad market that the operating payments were never separated.

A glide path is one way to move weight from growth capital toward liability capital as 2033 gets closer. The toolkit’s starter path is flat on purpose. Bend it only when the team has a reason.

The projection tab shows the **undivided** portfolio. It does not silently subtract a reserve or a gift. The reserve tab and the facility tab do that split, so you can see the liability math without baking a contribution into the wealth chart.

## The cash-flow clock

Contributions, the reserve set-aside, the facility gift, and the operating payments all happen at the **beginning** of the year. A return labeled “during 2027” takes beginning-of-2027 wealth to beginning-of-2028 wealth.

For each year Y from 2027 through 2041:

1. Start from the balances brought forward.
2. Add that year’s case contribution, if any.
3. Apply the rebalance rule.
4. Record beginning-of-year wealth. This is the decision wealth. In 2033 it is the wealth available before the reserve and before any facility gift.
5. Earn the year’s sleeve returns.

2042 is reported as a beginning-of-year balance only. No return is modeled during 2042, because the case horizon ends at that payment.

**Annual rebalance.** After the contribution, every sleeve is reset to that year’s glide weight. The portfolio return is the weight times each sleeve’s return.

**Drift.** Existing balances are not reset. New contributions are split using that year’s glide weights. Each sleeve then earns its own return. Weights wander. The displayed “return during the year” is the wealth-weighted sleeve return.

Both are modeling choices. Neither is a policy.

### Checking the clock by hand

One sleeve, a constant 5% return, annual rebalancing (with one sleeve the mix does not matter):

```
2027   300,000
2028   300,000 × 1.05 + 150,000 = 465,000
2029   488,250
2030   512,662.50
2031   538,295.63
2032   565,210.41
2033   593,470.93
```

At a 0% return the path is simpler, and it is the app’s starting point: $300,000 in 2027, then $450,000 from 2028 onward. The undiscounted operating liability is $500,000. At a 0% yield the reserve is $500,000, so there is a $50,000 gap and the residual available for a facility gift is $0.

An extreme drift check, useful only as arithmetic: two sleeves, weights 50/50, returns 100% and 0%. By the beginning of 2029, drift wealth is $975,000 and annually rebalanced wealth is $900,000. The gap is the effect of not selling the winner. It is not a market scenario.

## Scenarios and Monte Carlo

**Scenarios** use the bear, base, and bull returns you type for each sleeve. They are stories. Three stories do not become a probability just because there are three of them. A base path is not a forecast. A bear path is not “the” bad outcome. It is the bad outcome you chose to write down.

**Monte Carlo** draws many annual returns from the μ and σ you type.

- **Lognormal** (the starter model). The shock is a standard normal. Correlation across sleeves is applied to those shocks first (a Gaussian copula). The simple return `r` then satisfies `E[1+r] = 1+μ` and `Var(1+r) = σ²`, which keeps `1+r` positive. A sleeve cannot lose more than the money in it.
- **Normal, with a floor.** `r = max(floor, μ + σ Z)`. The floor is an assumption. The default sits just above −100%.

Draws are independent across years. The same master seed repeats the same sample. Quote the seed, the stream ids, and the software commit when you export.

### One master seed, six streams

The engine does not walk a single random-number cursor. A draw is a pure function of five coordinates:

```
(master seed, stream id, trial, step, dimension)
```

Call order does not matter. Trial 0 does not change if you raise the trial count from 1,000 to 5,000. The generator is SplitMix64, turned into a uniform on (0, 1), then into a standard normal with Box–Muller. Dimensions 2k and 2k+1 are one pair. The spare normal is not carried into the next year.

| Stream | Id | Step | Dimension | What it is |
| --- | --- | --- | --- | --- |
| Portfolio | 1 | Calendar year of the return, 2027–2041 | Sleeve index, and 120+ for the equity Student-t | Sleeve shocks for the full-horizon sample, and the market-factor kernel |
| Reserve | 2 | Interval 0..8, after payment k and before payment k+1 | 0 | The reserve asset in the shortfall sample |
| Bootstrap | 3 | Block index | 0 | Starting row, only when you select block bootstrap |
| Rates | 4 | Calendar year | 0 | Short-rate shock for that trial. One path per trial. |
| Credit | 5 | Calendar year | Sleeve index | Default draw for a credit sleeve |
| Single name | 6 | Calendar year | Name, jump, FX, and sector indexes | Idiosyncratic, jump, currency, and sector shocks |

The conditional 2031→2033 band does **not** open a new seed. It reuses stream 1 at calendar years 2031 and 2032 and the same trial index. That is common random numbers with the full-horizon sample. Wealth is restarted at the anchor and at the 2031 policy weights. Balances that had drifted before 2031 are not carried into that restart. With annual rebalancing, trial t started from trial t’s own 2031 wealth lands on trial t’s 2033 wealth. With drift, the sleeve shocks still match and the balances do not, because the restart puts the anchor back on the policy mix. Compared mixes on the assumptions tab use the same seed and the same streams. Adding a mix does not redraw the main sample.

Stream 2 is a different asset on purpose. Trial t of the reserve can be discussed next to trial t of the portfolio, and the shocks are not the portfolio’s shocks. Do not describe them as one shared history of market returns. Do describe them as one master seed with named streams.

Block bootstrap replaces stream-1 parametric shocks with rows you type. A uniform on stream 3 picks the start of each block. μ, σ, and the Gaussian copula are not used on those paths. Bear, base, and bull still use the scenario returns you typed.

Changing trials, the seed, μ, σ, correlation, the stress, the return model, the shock model, the glide path, a priced sleeve, or the rate card changes the sample. Read the new run as a new experiment.

## Rates, duration, and single names

The rate card is an annual short-rate step: last year’s short rate, plus mean reversion `κ(θ − r)`, plus a regime drift, plus `σ` times a stream-4 normal. The rate is floored at −5%. The shock during a year shows up in the next beginning-of-year level. From that short rate the card builds three yields: bills at the short rate, an intermediate yield equal to the short rate plus a premium you type, and a long yield equal to the short rate plus a long premium and a slope.

Five regime buttons copy an illustration into the drift, the 2027 level shock, the equity-rate correlation, and the equity drag. They do not replace the starting short rate or `κ`. The illustrations are: rising +75 bp per year for three years, flat with no drift, falling −50 bp per year for three years (the pace field stays positive and the falling regime subtracts it), shock-up +200 bp during 2027, and stagflation +100 bp per year for two years with a negative equity drag. Edit the fields after you click. None of those numbers is a forecast.

A sleeve whose pricing is **parametric** ignores the path and uses μ, σ, and the scenario columns, which is how a version-2 workspace keeps its results. A **T-bill**, **intermediate Treasury**, **long Treasury**, or **credit** sleeve is priced as

```
mark to market = carry − duration·dy + ½·convexity·dy² − default loss
hold to maturity = carry − default loss
```

`carry` is the yield at the start of the year. For a credit sleeve that yield includes the spread you typed. `dy` is the change in that sleeve’s yield over the year. Hold to maturity answers “what if we do not mark the price when yields move?” Mark to market answers “are the bills underwater if rates rise?” A duration of 0.4 makes that price loss small. A duration of 15 makes it about 15 times the yield change, before convexity. Switching a sleeve’s pricing copies round duration, spread, and default placeholders. Those placeholders are assumptions. Replace them. Credit is labeled as not a Treasury bill. A row you mark not tradable, or not eligible for WInS, keeps that flag. The flag does not delete the row.

The bear scenario adds 100 bp to the 2027 step. The bull scenario subtracts 100 bp. Monte Carlo uses the stream-4 shock instead. A credit default on a scenario path is probability times loss given default. On a Monte Carlo path it is a Bernoulli draw on stream 5.

**Broad equity** uses a Student-t market factor, scaled so the factor has variance 1, then your σ. The degrees of freedom are an assumption. Around 5 is a fat-tail illustration, not a fitted value. **Satellite basket** is a one-factor model: alpha, beta times the market, a sector shock, an idiosyncratic shock, an optional jump, and, for a name marked Taiwan, an FX shock and a geopolitical jump. The ticker list is the candidate list in `case-materials/satellite_candidates.pdf`. Weights start at 0. Effective N is `1 / HHI` of the positive weights. The basket does nothing until a sleeve’s pricing is “Satellite basket” and that sleeve has a positive glide weight.

An expense ratio, when it is not zero, turns a return `r` into `(1+r)·(1−fee)−1`. A turnover cost in basis points, when it is not zero, scales balances on an annual rebalance after the first year. Zeros leave the cash-flow identities alone.

Block bootstrap still replaces the priced path on Monte Carlo trials. Scenario paths keep the pricing rule.

`npm run sweep` writes a mix-by-regime grid to `out/sweep` as CSV and JSON. The stress μ and σ in that script are labeled in the file. They are not a portfolio.

### How to read a percentile without overclaiming

The app reports Hyndman–Fan type 7 percentiles, the same convention as the default in R and in NumPy’s linear percentile. For a sample of size `n` and a fraction `p`, it interpolates at position `(n − 1) p` in the sorted sample.

A 10th percentile is the level that about 10% of **these draws** fell below. It is not the statement “there is a 10% chance markets will do this.” That stronger sentence would require the return model to be true, the inputs to be true, and no risks outside the model. None of those are given.

Say this instead: “In 2,000 draws from the return model in our IPS appendix, with seed 42, 10% of beginning-of-2033 wealth figures were below $X.” Then say what the model leaves out.

The shaded band on the projection chart runs from the lowest percentile you requested to the highest. The middle line is the percentile closest to 50, not a promise.

## The operating liability

Ten payments of $50,000, first one immediate, are an **annuity due**.

At a flat annual yield `y` (and `y` above −100%):

```
PV = Σ_{k=0}^{9}  50,000 / (1+y)^k
```

At `y = 0` the present value is $500,000. At 3% it is about $439,305. At 4% it is about $421,767. At 5% it is about $405,391. A higher yield lowers the dollars you set aside today and raises the damage if that yield is not earned.

The same number comes from **backward induction**, which is what the code uses, including when the reinvestment rate is not flat. Let `B_9 = 50,000` be the balance needed on the morning of the last payment. For each earlier date:

```
B_t = 50,000 + B_{t+1} / (1 + r_t)
```

`r_t` is the return earned after payment `t` and before payment `t+1`. There are nine returns between ten payments. If every `r_t` equals `y`, `B_0` equals the present-value formula. After the last payment a perfectly matched reserve has about $0 left. A surplus margin, or a reinvestment path that earns more than the sizing rate, leaves money. A worse path produces a shortfall. The schedule shows both.

**Macaulay duration** at the discount yield, in years:

```
D = Σ_{k=0}^{9}  k · PV_k / PV
```

The immediate payment has time weight zero. At a 0% yield every payment has the same present value, and `D = (0+1+…+9)/10 = 4.5` years. **Modified duration** is `D / (1+y)`. Duration tells you how sensitive the liability’s present value is to the yield. It does not name a bond to buy. If you compare it to a portfolio of bills or notes, that comparison is yours.

**Funded ratio** in the schedule is beginning-of-year assets divided by the present value of the payments still due, including today’s, discounted at your yield `y`. A matched ladder with no surplus margin sits near 1 at every payment date. The ratio is an accounting identity under that yield. It is not a probability.

Inflation is a separate, optional view of purchasing power. Real beginning-of-year wealth is nominal wealth divided by `(1+inflation)^(year−2026)`. The $50,000 payments stay nominal, so their purchasing power falls if your inflation assumption is positive. The case forbids inflating the liability. Do not “fix” that inside the reserve.

## Four reserve methods

All four are computed from the inputs on the reserve tab. The radio button chooses which schedule you are looking at and which size the facility tab uses. It does not declare a winner.

1. **Flat-yield ladder.** Immunize at the single yield `y`. This is the cash or Treasury-bill style calculation: set aside the present value, and if you can lock `y` through each payment date, the payments clear and the reserve ends near zero. You have not locked anything by typing `y` into the app. You have assumed it.

2. **Present value plus a surplus margin.** Reserve = present value × `(1 + margin)`. A margin of 0 is the same dollars as the ladder. A positive margin is extra funding relative to that present value. A negative margin, down to −100%, is a deliberate underfund relative to that present value. The duration figures are reported beside the size so you can talk about matching, not because the software selected a bond.

3. **Stress path.** The same immunization, using one stress return every year. “Funded on the stress path” means only that. It is not “90% safe” and it is not “safe.”

4. **In-sample shortfall target.** Draw reserve returns from the shortfall μ and σ, using the same return model as the portfolio (lognormal or floored normal). For each path, compute the immunizing reserve. Sort those requirements. The reported reserve is the smallest dollar amount that covers at least your target fraction of the sample. With `n` draws and target `q`, that is the order statistic at index `ceil(q n) − 1`. The achieved share is a count of these draws. A target of 100% is the worst path **in the sample**, not a proof. A target of 0 sizes the reserve at $0 and funds nothing. If some paths lose 100% before later payments, those paths have no finite immunizing reserve, and a high target may be unattainable. The app says so instead of inventing a number.

The schedule can be rolled on a custom path of nine returns (during 2033, after that year’s payment, through during 2041). **Sizing does not follow that custom path** unless the custom rates happen to equal the method’s rate. The gap you then see is the point: a de-risking story that is not the story you sized to will overshoot or undershoot. Writing a declining path is allowed. The app will not invent the decline for you.

Below those four methods, the reserve tab also shows a **regime table**. Each column takes the level, mean reversion, and term premia from the rate card, lays one regime template on top, and sets short-rate volatility to zero. Four sizes are reported for that curve: the present value of the ten payments on the 2033 three-point curve, a nominal $500,000, a T-bill ladder at the 2033 short rate, and a duration-matched book of the same present value. On a zero curve all four are $500,000. A rising template lowers the discounted sizes and leaves the nominal $500,000 where it is. An instantaneous +100 bp column shows how the funded ratio moves. The portfolio sample still uses the volatility you left on the card. The table is not a ranking.

You can also redraw the schedule as if you set aside only `min(scenario wealth, sized reserve)`. The liability math of the full reserve stays in the comparison table and in the CSV. If bear wealth cannot pay for the reserve, the capped schedule is where the missed payments show up year by year.

“High degree of funding certainty” is a sentence the case asks the team to write. The text box on the reserve tab starts empty. A shortfall target of 90%, or any other number already sitting in a field after you load the teaching example, is not that definition.

## Glide paths and de-risking

A glide path is a sequence of mixes. The toolkit interpolates in a straight line between knots and holds the nearest knot outside them. Each knot’s weights must be non-negative and sum to 1. If they do not, portfolio projections pause. Reserve present values, which do not need a mix, still run. **Normalize knots to 100%** rescales whatever you typed. It does not decide the mix.

De-risking, in this case, usually means one or both of these:

- Before 2033, shift the undivided portfolio toward the funding sleeve as the reserve date approaches, so a late bear market does less damage to the dollars that must be set aside.
- After 2033, hold the reserve in instruments that mature on the payment dates, or shorten them as each payment is made, instead of leaving a multi-year bond in a reserve that has one payment left.

The first idea is the glide path. The second idea is the reserve’s reinvestment path and its duration. They answer different questions. A glide path inside the growth sleeve does not, by itself, fund the 2034 payment.

Annual rebalancing sells what outperformed and buys what lagged, back to the policy mix. Drift does not. Over two different returns, drift and rebalance diverge, as in the 100% / 0% check above. Which one matches the IPS is a policy sentence, not a default.

## The facility contribution

At the beginning of 2033 the order is fixed by the case:

1. Observe portfolio wealth `W`.
2. Set aside the operating reserve.
3. Pay the first $50,000 from that reserve.
4. Only then decide a facility contribution from what is left.

The toolkit enforces the split:

```
If W ≥ R:   W = R + contribution + flexibility
If W < R:   contribution = 0,  flexibility = 0,  gap = R − W
```

`R` is whichever method you selected, unless you turn on the reserve override and type a different amount. The override is for illustration. It does not change the four method sizes in the comparison table.

Three rule forms are built in. You can add more rows. You mark one row for the range sentence. Marking it does not make it the team’s rule.

- **Retain a fraction.** Contribution = `(1 − retain) × residual`. Retaining 100% contributes nothing. Retaining 0% contributes the entire residual.
- **Keep a dollar buffer.** Contribution = `max(0, residual − buffer)`.
- **Cap.** Contribution = `min(residual, cap)`.

Using the 5% hand path above and a 0% reserve of $500,000, residual wealth is about $93,471. Retaining 40% of that residual contributes about $56,083 and keeps about $37,388. Change the return, the yield, or the rule, and both numbers move. That is the experiment.

The scratch pad on the facility tab applies the same rules to any 2033 wealth you type. It does not alter the scenarios.

## A range for co-sponsors, without a false point estimate

In 2031 Laura needs language for a contribution that will not be decided until 2033. Promising one number and then missing it damages credibility. The range also has to leave the operating commitment standing, which is why every method in this app takes the reserve out first.

Three methods are always shown. You mark one as the primary draft. The draft sentence is generated so a reader can see the method. Rewrite it in the team’s voice before it goes near a fundraising paragraph.

1. **Scenario envelope.** The low and the high are the smallest and largest contributions under the scenarios you tick, using the marked rule. This span is not a probability. Paths you did not write down are not in it. If you only tick the base path, the “range” is a point. That is a useful warning, not a communication plan.

2. **Full-horizon percentile band.** Draws start in 2027 from the case contributions and your return model. At each draw’s 2033 wealth, the reserve is removed and the marked rule is applied. The band runs from the low percentile you set to the high percentile you set. The sentence also reports the share of **this sample** that landed inside the band, and the share of draws in which 2033 wealth does not cover the reserve. Those are counts. They are not a promise that the gift will land in the band.

3. **Conditional two-year band.** This is the problem as it looks in 2031, once that morning’s wealth is known. You anchor on the bear, base, or bull 2031 wealth, on the sample median, or on a number you type. The app then applies the portfolio stream’s 2031 and 2032 shocks, the same trial index as the full-horizon sample, starting from that anchor at the 2031 policy weights. It does not open a new seed. From the team’s seat in 2026, this method describes a **rule** for what to say later (“given the portfolio we actually have in 2031, communicate the 10th to 90th percentile of the two-year sample”). The full-horizon band describes the range of gifts implied by today’s assumptions, before 2031 wealth is known. They answer different questions. Report which one you mean.

A draw that cannot fund the reserve contributes $0 to the facility. The range can therefore include zero because the operating commitment comes first, not because the rule is stingy.

The histogram is the full-horizon contribution sample under the marked rule. A spike at zero usually means many draws failed to fund the reserve, or the marked rule retains the entire residual.

## Holdings, rules, and a trade sheet

The holdings tab is a list you type or import. It starts empty. Files under `examples/` show the CSV columns and are labeled as examples. They are not loaded at startup, and they are not a book for the competition.

Weights are shares of the starting capital. Sleeve totals are the sum of the rows in that sleeve. **Use these weights in the model** copies those sleeve weights onto both glide knots, keeps the return assumptions of a sleeve whose name matches, and gives a new sleeve a zero μ and σ. An empty list does not change the assumptions.

The trades tab starts from the 2026 WInS Trading Details note: $300,000 of capital, stocks priced at $5 or more, WInS ETFs allowed, WInS Treasury bonds for the US, UK, Germany, France, Italy, and the Netherlands, at most 200 trades, each order at most twice that security’s average daily volume, and no shorting or margin. Every one of those fields can be edited if the note in front of you says something else. The validator marks each order pass or fail and says why.

A market snapshot is a CSV you paste or import: ticker, price, average daily volume, as-of date, and, for bonds, clean price, accrued interest, coupon, and maturity. The app does not fetch prices. The sheet buys whole shares, or bond face in the increment you set, and prices a bond off the dirty price (clean plus accrued). Leftover cash is a row. The cash plus the orders equals the capital, and the orders do not spend more than the capital.

Compare pins one holdings list as a baseline and scores it against the list on screen with the same seed. The standard error next to P(funded) is √(p(1−p)/n) for the current book. The diff table is the weight and sleeve changes, not a judgment about which book is better.

Exports are tagged. **EXTERNAL** is the shareable trade sheet and the annotated one-page results. **INTERNAL** is the working package. The prefix is part of the file name. The annotated page restates the sample in plain sentences: holdings, the wealth path, funding against the mix, the rate-regime table, mark-to-market against hold-to-maturity, the stresses you ran, the facility gift and the 2031 range, and the assumption table. It describes that sample. It does not pick a portfolio.

## Stresses and the decision screen

The decision tab is one screen for the sample that is already running: P(funded), p5 wealth, the median gift, the 2031 range, the rate-regime template with the lowest minimum funded ratio on the present-value ladder, and the stress with the lowest P(funded) among the ones you have run. Pin a sample to see the change when you edit. An empty stress tile means you have not run the stress panel yet.

The stress panel can run five overlays on the current assumptions: a crash in a year you choose, a jump on basket rows marked as Taiwan exposure, a fatter Student-t, a lower equity drift, and a higher volatility. The default sizes are labeled illustrations. Change them. They are not forecasts, and they are not applied until you run them.

The glide chart on the assumptions tab has a second picture: the same knots stacked so you can see the mix fill the portfolio. A gap under 100% is a knot that does not sum to 1. Portfolio projections stay paused until the knots are valid. **Normalize knots to 100%** rescales what you typed.

Samples are cached by the hash of the assumptions. A repeat of the same inputs reuses the last sample and says so. A new hash shows how many trials have finished.

## What Bend checks, and what the three engines share

The Bend program in `bend/` is the reference for the locked arithmetic: case cash flows, the zero-yield reserve of $500,000, bond carry when the yield does not move, a mark-to-market price that falls when the yield rises and duration is positive, a hold-to-maturity bond that still pays par plus coupons, weights that sum to 1,000,000 ppm, a facility gift that stays between zero and the surplus, and a trade sheet that does not spend more than the capital. `bend bend/laws/LAWS.bend --verdict` prints `ALL PROOFS CHECK` when those laws hold.

The TypeScript app is the interactive sample. `npm run parity` runs one seed through Bend, through this app’s engine, and through `reference/python/`. Cash flows, the integer bond return, the reserve present value, and the SplitMix64 word have to match. P(funded), p5, and p50 of a fixed 200-trial parametric book have to agree inside the sampling band. The Python file `reference/python/sim.py` is an independent copy of the analysis harness. It is a cross-check, not a second user interface, and it does not contain a recommended book.

One limit is worth stating. The TypeScript short rate is floored at −5%. The Bend short rate does not go below zero. The proved paths and the printed goldens stay non-negative, so the two engines agree on those lines. A path that would have gone negative in the app is not the path Bend is proving.

## Inflation, and what is deliberately left out

Inflation changes only the real-wealth column. It does not index the $50,000 payments and it does not estimate the facility’s construction cost. The case says not to build that cost.

Also left out, on purpose:

- Taxes, and the legal setup of a residency in Taiwan.
- Contributions or withdrawals other than the two case contributions and the 2033 decisions.
- Monthly or daily paths. The step is one year.
- Any risk you did not type. Mean reversion is only the `κ` on the rate card. Fat tails are only the Student-t degrees of freedom you set. Currency is only the FX volatility on a basket name. A parametric sleeve still has only the μ, σ, and scenario return you typed.
- A separate endowment or contingency fund. The case says you are not expected to size one. Flexibility in this toolkit is simply the residual the rule does not give away.
- WInS profit and loss. The competition guide says long-term projections start from the case cash flows and the team’s return assumptions.

If a real portfolio would face one of those, the IPS should say the model ignores it, not that the model handled it.

## From the toolkit to the three deliverables

Use each module as a workshop, then write the judgment yourselves.

**Trading Notes.** A note should say what decision was made, which part of the strategy it serves (growth, liquidity, funding reliability, or flexibility), and what research sat behind it. The research tab can store a FinBERT or demo-lexicon score next to a ticker or theme. That score is a label on a headline. It is not a signal to buy or sell, and it never changes the projection. WInS is where trades happen. This toolkit does not connect to it.

**Investment Policy Statement.** This is where the strategy becomes final: the mix and how it may change, the reserve’s size and what it is allowed to hold, the sentence that defines high certainty, the rule for the facility contribution, and the rule for the 2031 range. Export the assumption JSON and attach it as an appendix if it helps a reader rerun the numbers. The IPS is still the prose, not the JSON. Once the IPS deadline passes, the strategy is frozen. A later bad month in WInS is not a reason to rewrite it. The model’s scenarios are how you talk about outcomes you already accepted.

**Final Report.** Evaluate the implementation. The useful exhibits are the scenario table, the reserve schedule against remaining liability, the gaps when wealth is short, the candidate contributions, and a range sentence whose method a co-sponsor could understand. Explain favorable and unfavorable cases without replacing the range by a single point. Detailed final-report instructions arrive in week 7 of the competition. Do not pretend this guide is those instructions.

A practical order of work:

1. Read the locked timeline.
2. Write a certainty definition in the empty box, in the team’s words.
3. Enter return, volatility, and mix assumptions you are willing to defend. Keep the teaching example out of the write-up.
4. Compare the four reserve sizes with the 2033 wealth on each scenario.
5. Read the schedule. If you want the reserve’s return to change as payments approach, type that path and see whether the schedule still clears.
6. Try more than one facility rule. Look at the identity `W = R + contribution + flexibility`.
7. Mark a range method. Read the generated sentence critically. Rewrite it.
8. Export CSV or JSON for the appendix.
9. Keep research notes in their lane.

## FinBERT, and the demo lexicon

[FinBERT](https://arxiv.org/abs/1908.10063) (Araci, 2019) is a BERT model further trained for financial sentiment. The weights this toolkit calls are [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) on Hugging Face. Given a headline or a short passage, the model returns a label of positive, negative, or neutral, plus a score for each class. This guide does not restate an accuracy figure. Use the paper and the model card for the authors’ evaluation, on the data they evaluated.

In this app the flow is:

1. Optional. Run `python scripts/setup_finbert.py` once. The download is large because it includes PyTorch.
2. Run `python services/finbert/server.py`. It listens on `127.0.0.1:8765` and does not place trades.
3. On the Research tab, paste text, one item per line, and score with FinBERT.
4. Save the rows next to a ticker or theme. They persist in this browser only.

If the service is down or the weights are not downloaded, the tab says so. **Score with demo lexicon** is a separate button. That scorer is a short word list in `src/core/lexicon.ts`. It is not FinBERT, it is not trained, and it is not financial analysis. Saved notes record which source produced them so the two cannot be confused later.

Sentiment does not enter `runModel`. There is no optimizer.

## Correlation stress

The typed matrix is the Gaussian copula of the parametric model. A stress number is added to every off-diagonal and the result is clipped to ±0.999. Zero stress leaves the typed matrix unchanged. The diagonal stays 1.

If the minimum eigenvalue is below −1e−8, the matrix is not positive semidefinite and a correlation factor cannot be built honestly. The engine clips negative eigenvalues to zero, restores a unit diagonal, and says so. Monte Carlo then uses the repaired matrix, not the one you typed. A warning on the assumption inspector is the signal. Do not quote the typed entries as if they were the ones in the sample.

Block bootstrap ignores the matrix. The dependence is whatever dependence is in the rows you typed.

## Pathwise funded ratio

Two ratios are reported. Neither is a probability.

**Portfolio ratio.** Beginning-of-2033 wealth on a stream-1 trial, divided by the reserve target used on the facility page. A ratio of at least 1 means that trial can set the reserve aside before any facility gift. The share is a count of trials.

**Reserve-path ratio,** shortfall method only. The sized reserve divided by the immunizing reserve of that stream-2 path. A ratio of at least 1 means that path’s ten payments clear if you set aside the sized reserve and then earn that path. The examples table shows the first trials and the trial with the largest finite requirement.

A funded ratio of 1 on the ladder schedule is a different object. It means assets match the present value of what is left, at the yield you typed, along the single reinvestment path on the schedule.

## Local sensitivity

The projection tab can compute a one-at-a-time probe. It is not an optimizer and it does not search for a portfolio.

For a result V and an input x, with a bump h:

```
greek ≈ (V(x+h) − V(x−h)) / (2h)
one-at-a-time up = V(x+h) − V(x)
```

h is 0.01 for μ, for σ, and for the scenario base return. h is 0.05 for the first sleeve’s glide weight, after which the other weights are rescaled so the knot still sums to 1. h is 0.005 for the discount yield.

The four results are beginning-of-2033 wealth on the **base** path, the type-7 50th percentile of Monte Carlo 2033 wealth, and the low and high ends of the communication method you marked.

μ and σ move the Monte Carlo. They do not move the bear, base, or bull paths. The scenario base return moves the base path and does not move a zero-volatility Monte Carlo whose μ you left alone. The discount yield moves the ladder and the contribution band. It does not move portfolio wealth. If a chart moves when you thought you bumped a different input, you have mixed the columns up. The sensitivity table is there to catch that.

A one-sleeve glide cannot shift, and a σ bump that would pass below zero is floored. Those rows are marked clamped. The greek is then not a clean central difference. Read the note on the row.

## Worked numbers from the case cash flows

Contributions: $300,000 at the beginning of 2027, $150,000 at the beginning of 2028, nothing else. One sleeve, or a 50/50 mix of 7% and 3%, both give a constant 5% portfolio return on the base path.

```
2027   300,000.00
2028   465,000.00
2029   488,250.00
2030   512,662.50
2031   538,295.625
2032   565,210.40625
2033   593,470.9265625
```

The same path at 4% ends 2033 at $562,093.6409088. At 6% it ends at $626,289.5703168. The central difference of 2033 wealth with respect to that constant return, per 1.00 of return, is about $3,209,796. Per percentage point it is about $32,098. That is the scenario-base greek when every sleeve’s base return moves together and the path is a flat 5%. It is not a μ greek. μ does not enter this path.

Ten payments of $50,000, first one immediate:

| Yield | Present value |
| --- | --- |
| 0% | 500,000 exactly |
| 3% | 439,305.446094 |
| 4% | 421,766.580526 |
| 5% | 405,391.083782 |

At 0% the reserve is $500,000 and 2033 wealth on the zero-return path is $450,000, so the residual for a facility gift is $0 and the gap is $50,000. At a 5% base path and a 0% reserve, residual wealth is $593,470.93 − $500,000 = $93,470.93. Retaining 40% of that residual contributes 60% of it, about $56,082.56, and keeps about $37,388.37. Check the identity: 500,000 + 56,082.56 + 37,388.37 = 593,470.93.

Macaulay duration at a 0% yield is (0+1+…+9)/10 = 4.5 years. The immediate payment has time weight zero.

A flat ladder at the sizing yield has a funded ratio within 1e−6 of 1 at every payment date, and the balance after the 2042 payment is within a fraction of a cent of zero. If your schedule does not do that, the reinvestment path is not the path you sized.

## Run ledger and the reproducibility package

Save a named run on the Run ledger tab. The row stores a deep copy of the assumptions, the SHA-256 of their canonical JSON, the master seed, the stream description, and a short summary: 2033 wealth on each scenario, the Monte Carlo median, the reserve, and the range endpoints. Editing the workspace afterward does not edit the row. Load replaces the workspace inputs. Compare shows the summaries and every field that differs.

Export **Run package JSON** for the appendix. One file contains:

- assumptions
- results, including the 2031 and 2033 wealth samples
- the projection, reserve, and facility CSV text
- the liability schedule
- the tolerances named below
- a methodology footnote: method names, master seed, stream ids, shock model, whether correlation was repaired, software version, and git commit

The hash identifies inputs. The commit identifies formulas. A matching hash under a different commit is not the same experiment. The export time is not part of the hash.

WInS profit and loss is not in the package. FinBERT scores are not in the projection. Research notes are included only as notes.

## Failure modes

These are the mistakes that make a careful table say something it does not mean.

- **Putting WInS profit and loss into the long-term projection.** The competition guide starts the projection from the case contributions and the team’s return assumptions. This toolkit has no field for trading profit and loss. A good month in the portfolio game is not a new μ.
- **Reading a percentile as a promise.** “The 10th percentile is $X” means 10% of these draws fell below $X. It does not mean the probability is 10%, and it does not mean co-sponsors should expect $X.
- **Pasting the teaching example into a deliverable.** Those numbers exist so charts move. They are labeled as not a strategy.
- **Mixing μ with the scenario base return.** μ feeds Monte Carlo. The base column feeds the base path. They can be equal. They are not the same input. The sensitivity table is the check.
- **Treating stream 2 as the portfolio’s shocks.** Same seed, same trial index, different stream, different asset.
- **Treating the conditional band as a fresh independent sample.** It reuses 2031 and 2032 portfolio shocks. It does restart the balances at the policy mix, so a drifted portfolio and the conditional band are not the same wealth path.
- **Reading a funded ratio of 1 as “safe.”** It means matched at the yield you typed.
- **Typing a custom reinvestment path and thinking the reserve was resized.** Sizing still uses the method rate. The schedule then shows the gap. That gap is the point.
- **Inflating the $50,000.** The case payments are nominal. Inflation changes only the real-wealth column.
- **Quoting a repaired correlation as if it were the matrix you typed.** The inspector shows the matrix the factor used, and the warning says it was repaired.
- **Letting block bootstrap silently stand in for a view about μ.** If the shock model is bootstrap, μ and σ are not in the Monte Carlo. Say that.
- **Treating a 100% shortfall target as a proof.** It is the worst finite path in the sample.

## Numerical tolerances

| Check | Tolerance |
| --- | --- |
| Dollar identities, such as wealth = reserve + contribution + flexibility | 1e−6 dollars |
| Rates, weights, Cholesky entries | 1e−9 |
| Funded ratio of a matched ladder | 1e−6 |
| An eigenvalue is treated as nonnegative | above −1e−8 |
| Percentiles | Hyndman–Fan type 7, position (n−1)·p |
| Money on screen | nearest dollar |
| Money in JSON and CSV | full precision |

A lognormal draw whose exponent would overflow is capped at exp(709)−1, which is finite. A non-finite μ, σ, or scenario return stops the portfolio sample and says why. It does not draw a quiet NaN through the chart.

## A small map of the code

| Piece | Role |
| --- | --- |
| `src/core/case.ts` | Locked dates, contributions, payment amount, disclaimer. |
| `src/core/liability.ts` | The ten-payment liability object. |
| `src/core/rng.ts` | Counter-based streams 1 through 6. |
| `src/core/rates.ts` | Short-rate step, three-point curve, regime templates. |
| `src/core/bonds.ts` | Duration and convexity return, mark to market and hold to maturity. |
| `src/core/equity.ts` | Unit-variance Student-t and the one-factor basket. |
| `src/core/basket.ts` | Candidate tickers. Parameters are placeholders. |
| `src/core/regimeReserve.ts` | Curve present value and funded status by regime template. |
| `src/core/sweep.ts` | Mix × regime grid used by `scripts/sweep.ts`. |
| `src/core/project.ts` | Beginning-of-year projection, rebalance or drift, sleeve shocks. |
| `src/core/reserve.ts` | Immunization, roll-forward, shortfall order statistic, pathwise funded ratio, duration. |
| `src/core/correlation.ts` | Stress, PSD check, eigenvalue repair. |
| `src/core/sensitivity.ts` | One-at-a-time bumps and central differences. |
| `src/core/ledger.ts` | Saved runs, the assumptions hash, field diffs. |
| `src/core/facility.ts` | Rules, scenario envelope, percentile bands, draft wording. |
| `src/core/run.ts` | Validates inputs and runs one consistent pass. |
| `src/core/package.ts` | Run package and the methodology footnote. |
| `src/core/defaults.ts` | Zero starting point and the opt-in teaching example. Schema version 3. |
| `services/finbert/server.py` | Optional local FinBERT scoring. |

`npm test` checks the cash flows, the annuity, the ladder invariant (funded ratio near 1 and a final balance near 0), scenario compounding, drift versus rebalance, seed repeatability, common random numbers between the full-horizon sample and the conditional band, the separation of μ from the scenario base return, the rule that facility dollars cannot touch the reserve, and the wording of a range. When you change a formula, change the guide in the same edit.

## Limits, stated plainly

Annual independent returns will not reproduce a crash that lasts three months and then reverses, or a decade of below-average real equity returns, unless you put that story into a scenario return, into μ, into a rate regime, or into a bootstrap history. A parametric lognormal sleeve has no jumps. An equity-index sleeve uses a Student-t you set, and a basket sleeve can add a jump you typed. Those are still one step per year. Correlation is constant unless you stress it, and a repair changes the matrix. Stream 2 is not stream 1. Present value is only as meaningful as the yield you discount at. A funded ratio of 1 means “matched at that yield,” not “safe.” A percentile band is a property of a sample. The draft co-sponsor sentence is a template. The judgment, and the responsibility for it, stays with the team.
