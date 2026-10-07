# Gao modeling toolkit

A workspace for the [Wharton Global High School Investment Competition](https://github.com/JohnDoeLexora/Wharton-Modeling-Software) Laura Gao case.

**This is a modeling toolkit, not advice.** It does not recommend a portfolio, an operating reserve, a facility contribution, or a co-sponsor range. Case cash flows and dates are filled in. Returns, volatility, glide paths, certainty rules, and facility rules start at zero (or, if you ask, at a labeled teaching example) and are yours to edit. The team decides later.

WInS trading gains and losses are not an input. Long-term projections use the case contributions plus the return assumptions in the workspace. Personal taxes and the legal setup of a residency in Taiwan are out of scope, as the case says.

## Run the app

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

`npm run build` typechecks and writes a static bundle to `dist/`.

## Run the Bend engine

The interactive workspace above is unchanged. `bend/` is a second engine, written in [Bend 2](https://bend2.dev) (the `bend` compiler, 2.0.x). It locks the same case arithmetic and checks it with `law` proofs. It does not replace `npm run dev`, and it does not load FinBERT.

Install Bend if `bend version` is missing (`curl -fsSL https://bend-lang.com/install.sh | sh`). This repo was checked with Bend 2.0.36.

```bash
bend bend/main.bend          # or: npm run bend:demo
bend bend/laws/LAWS.bend     # or: npm run bend:laws
sh bend/check.sh             # or: npm run bend:check
bend --check-only bend/project.bend
```

`bend bend/main.bend` prints the zero-return, zero-fee scenario table. Beginning-of-2033 wealth is `450000`. The 0-yield ladder is `500000`. The facility residual on that pair is `0`. A counter draw is printed as raw SplitMix64 halves (`draw_hi`, `draw_lo`) for seed 42, stream 1, trial 0, step 2027, dimension 0. That 64-bit word matches `src/core/rng.ts`.

Dollars are whole dollars. Weights and rates are parts per million: `1000000` ppm is 1, so the starter knots `500000 + 500000` sum to 1. The funding sleeve receives the remainder of a rebalance, which keeps the dollar total whole. An F32 shock uses the top 24 bits of the same SplitMix64 word. Quote `draw_hi` and `draw_lo` when a run has to match the TypeScript sample bit for bit.

The Bend projection in the demo uses two sleeves and caller-supplied rates. The flat half-and-half knots are the starting table. Mu, sigma, fees, stress, and facility rules are arguments. The laws in `bend/laws/LAWS.bend` record case facts and arithmetic identities. They do not pick a portfolio.

The in-app **How to model** tab is the same text as [docs/HOW_TO_MODELING.md](docs/HOW_TO_MODELING.md). Read that before treating a chart as a conclusion. It covers liability versus growth capital, discounting the ten $50,000 payments, scenarios versus Monte Carlo, glide paths, communication ranges, how the modules map onto Trading Notes / the IPS / the Final Report, and what FinBERT is for.

## What you can do in the app

- Edit sleeve returns, volatility, a glide path, correlation (with an optional off-diagonal stress), inflation (purchasing-power view only), and the Monte Carlo sample size and seed.
- Choose a sleeve’s pricing: parametric μ/σ, T-bills, intermediate Treasuries, long Treasuries, credit, a fat-tailed equity index, or a satellite basket. Bond and credit placeholders that appear when you switch pricing are labeled assumptions.
- Pick a rate regime. The button copies an illustration into the drift fields and leaves the short-rate level and the mean-reversion speed as you typed them.
- Project beginning-of-year wealth from 2027 through 2042 on bear, base, and bull paths, plus percentiles of a seeded sample, including p1. One master seed feeds six named streams: portfolio, reserve, bootstrap, short rate, credit default, and single-name shocks. The 2031–2033 conditional band reuses the portfolio stream. Compared mixes reuse the same seed.
- Read mark-to-market wealth next to hold-to-maturity wealth, so a rate rise shows up as a price term on a long bond and a small price term on a bill.
- Compare four operating-reserve methods against the ten $50,000 payments, which stay visible as a schedule. A second table shows present-value, nominal $500,000, T-bill, and duration-matched sizes under each rate-regime template.
- Apply facility rules only to wealth left after the reserve, and build a 2031 communication range by scenario envelope, full-horizon percentiles, or a two-year conditional sample.
- Inspect effective weights, the correlation matrix actually used, and the case contribution schedule. Compute local one-at-a-time sensitivities when you ask. Save named runs and compare two of them.
- Export a run package (assumptions, results, CSV, methodology footnote) for an appendix.
- Optionally score headlines and save the scores as research notes. Notes never enter the projection.

The certainty definition box starts empty. The case asks the team to write that sentence.

## FinBERT (optional)

Sentiment is a research tag for Trading Notes. It does not change allocations or place trades.

Model: [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert).
Paper: Araci, D. (2019). *FinBERT: Financial Sentiment Analysis with Pre-trained Language Models.* [arXiv:1908.10063](https://arxiv.org/abs/1908.10063).

This repository does not claim an accuracy number for the model. See the paper and the model card for the authors’ evaluation.

The download is large (PyTorch plus the weights). Skip it if you only want the portfolio tools. The Research tab still offers a **demo lexicon**, which is a word list in the browser and is labeled as not FinBERT.

```bash
python3 scripts/setup_finbert.py   # creates .venv, installs CPU torch + transformers, caches weights
.venv/bin/python services/finbert/server.py
```

The service listens on `http://127.0.0.1:8765`. In dev, the Vite app proxies `/finbert` to that port. `GET /health` reports whether the packages and the cached weights are present. The server will not download the model by itself.

If the service is stopped, the app says so. Projections keep working.

## Reproduce a run

The **Export** tab downloads a run package. **Run package JSON** is one file:

- the assumptions, including `schemaVersion` 3
- the results (scenario paths, Monte Carlo wealth samples, reserve, facility summary)
- the projection, reserve, and facility CSV text
- the liability schedule (ten nominal $50,000 payments, 2033–2042)
- named numerical tolerances
- a methodology footnote: method names, master seed, stream ids, shock model, correlation repair flag, software version, and git commit

**Methodology footnote** is that note as plain text.

The SHA-256 assumptions hash identifies the inputs. The git commit identifies the formulas. A matching hash under a different commit is not the same experiment. WInS profit and loss is not in the file. FinBERT scores are not in the projection. Research notes are stored only as notes.

The **Run ledger** tab saves a named snapshot in this browser (`localStorage` key `gao-toolkit-v3`). A stored `gao-toolkit-v2` or `gao-toolkit-v1` workspace is migrated on open: missing sleeve pricing becomes parametric, a missing rate card becomes a flat zero curve, and a missing basket becomes the candidate list at weight 0. Each row keeps a copy of the assumptions, the hash, and a short output summary. Editing the workspace afterward does not edit the row. Compare two rows to see which fields differ. Load replaces the workspace inputs and leaves the research notes in place.

To rerun someone else’s package: check out the commit named in the file, open the app, and load the assumptions (paste them back by loading a ledger row you saved from those inputs, or set the same fields). The same seed, trial count, and commit reproduce the sample. The hash is of the assumptions only, so compare it after you reload.

## Layout

| Path | What it is |
| --- | --- |
| `src/core/` | Pure TypeScript math. No React. The interactive toolkit runs this. |
| `src/ui/` | The workspace. |
| `bend/` | Bend 2 engine: case facts, glide, projection, reserve, facility, streams. |
| `bend/laws/LAWS.bend` | Proofs for the locked cash flows, the 450,000 path, the 500,000 ladder, and weight sums. |
| `bend/main.bend` | Deterministic scenario table. |
| `docs/HOW_TO_MODELING.md` | Algorithms and how to use them on this case. |
| `services/finbert/` | Optional local scoring service. |
| `case-materials/` | Official competition PDFs and text extracts. They are reference material, not part of the model. |

## Tests

```bash
npm test
bend bend/laws/LAWS.bend
```

`npm test` locks the TypeScript engine. `bend bend/laws/LAWS.bend` locks the Bend engine. The tests lock the case contributions, the annuity-due present value, the ladder roll-forward (funded ratio near 1, nothing left after the 2042 payment), scenario compounding, drift versus annual rebalance, seeded Monte Carlo, and the rule that a facility contribution cannot be taken from the operating reserve. They also lock the shared random streams (the conditional band reuses portfolio shocks; the reserve shortfall is a different stream at the same trial index), correlation repair, the assumptions hash, the run package footnote, and the split between μ and the scenario base return. Schema 3 tests lock the duration identity (no yield change means the bond return is the carry; a long bond loses about duration times the yield change; a bill loses much less), common random numbers across compared mixes, migration from a version-2 object, and the curve-reserve table.

A mix × regime grid lives in `scripts/sweep.ts`:

```bash
npm run sweep -- --trials 200 --seed 42 --out out/sweep
```

The file labels its stress returns as assumptions. `out/` is gitignored.

## Starting numbers

On a fresh browser profile every return is 0%. Beginning-of-2033 wealth is $450,000. A 0% reserve for ten $50,000 payments is $500,000, so the residual for a facility gift is $0. That is the case arithmetic before any market assumption. **Load teaching example** overwrites inputs with round placeholders so charts move. Those placeholders are not a strategy.
