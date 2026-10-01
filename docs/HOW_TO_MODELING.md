# How to model the Laura Gao case

This guide explains the arithmetic in the Gao modeling toolkit and the questions people usually ask when a portfolio has to fund a known nominal liability and also leave room for an uncertain gift. It is a manual for the software. It is not a strategy for Laura, and it does not pick a reserve, a glide path, or a facility contribution.

The same page is available in the app under **How to model**.

## What the toolkit will and will not do

The competition materials are explicit: there is no single correct strategy. Teams differ on risk, liquidity, funding confidence, the facility contribution, and how much flexibility to keep. This software is a place to run those differences side by side.

It will:

- Lock the case cash flows and dates so they are not retyped by accident.
- Project an undivided portfolio under bull, base, and bear returns you type, and under a seeded Monte Carlo sample.
- Size the operating reserve with several standard methods and roll it forward from 2033 through 2042.
- Apply rules you define to turn post-reserve wealth into a facility contribution and a flexibility balance.
- Build a communication range with an explicit method, and write a draft sentence that names that method.
- Score optional headlines with FinBERT, or with a clearly labeled demo word list, and store the scores as research notes.

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

Draws are independent across years. The same seed repeats the same sample. The portfolio sample uses your seed. The reserve shortfall sample uses that seed plus 917. The two-year conditional range uses that seed plus 7. Quote the seed when you export.

Changing trials, the seed, μ, σ, correlation, the return model, or the glide path changes the sample. Read the new run as a new experiment.

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

3. **Conditional two-year band.** This is the problem as it looks in 2031, once that morning’s wealth is known. You anchor on the bear, base, or bull 2031 wealth, on the sample median, or on a number you type. The app then redraws only 2031 and 2032. Wealth starts the two years invested at the 2031 glide weights, and your rebalance setting applies. From the team’s seat in 2026, this method describes a **rule** for what to say later (“given the portfolio we actually have in 2031, communicate the 10th to 90th percentile of the two-year sample”). The full-horizon band describes the range of gifts implied by today’s assumptions, before 2031 wealth is known. They answer different questions. Report which one you mean.

A draw that cannot fund the reserve contributes $0 to the facility. The range can therefore include zero because the operating commitment comes first, not because the rule is stingy.

The histogram is the full-horizon contribution sample under the marked rule. A spike at zero usually means many draws failed to fund the reserve, or the marked rule retains the entire residual.

## Inflation, and what is deliberately left out

Inflation changes only the real-wealth column. It does not index the $50,000 payments and it does not estimate the facility’s construction cost. The case says not to build that cost.

Also left out, on purpose:

- Taxes, fees beyond what you fold into a net return, and currency.
- Contributions or withdrawals other than the two case contributions and the 2033 decisions.
- Monthly or daily paths. The step is one year.
- Mean reversion, fat tails beyond what a normal or lognormal already has, and any risk you did not type in as μ, σ, or a scenario return.
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

## A small map of the code

| Piece | Role |
| --- | --- |
| `src/core/case.ts` | Locked dates, contributions, payment amount, disclaimer. |
| `src/core/project.ts` | Beginning-of-year projection, rebalance or drift. |
| `src/core/reserve.ts` | Immunization, roll-forward, shortfall order statistic, duration. |
| `src/core/facility.ts` | Rules, scenario envelope, percentile bands, draft wording. |
| `src/core/run.ts` | Validates inputs and runs one consistent pass. |
| `src/core/defaults.ts` | Zero starting point and the opt-in teaching example. |
| `services/finbert/server.py` | Optional local FinBERT scoring. |

`npm test` checks the cash flows, the annuity, the ladder invariant (funded ratio near 1 and a final balance near 0), scenario compounding, drift versus rebalance, seed repeatability, the rule that facility dollars cannot touch the reserve, and the wording of a range. When you change a formula, change the guide in the same edit.

## Limits, stated plainly

Annual independent returns will not reproduce a crash that lasts three months and then reverses, or a decade of below-average real equity returns, unless you put that story into a scenario return or into μ. A lognormal sample has no jumps. Correlation is constant. The reserve shortfall sample is not the same set of random numbers as the portfolio sample, so do not describe them as one shared history. Present value is only as meaningful as the yield you discount at. A funded ratio of 1 means “matched at that yield,” not “safe.” A percentile band is a property of a sample. The draft co-sponsor sentence is a template. The judgment, and the responsibility for it, stays with the team.
