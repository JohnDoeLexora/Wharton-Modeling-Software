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

The in-app **How to model** tab is the same text as [docs/HOW_TO_MODELING.md](docs/HOW_TO_MODELING.md). Read that before treating a chart as a conclusion. It covers liability versus growth capital, discounting the ten $50,000 payments, scenarios versus Monte Carlo, glide paths, communication ranges, how the modules map onto Trading Notes / the IPS / the Final Report, and what FinBERT is for.

## What you can do in the app

- Edit sleeve returns, volatility, a glide path, correlation, inflation (purchasing-power view only), and the Monte Carlo sample size and seed.
- Project beginning-of-year wealth from 2027 through 2042 on bear, base, and bull paths, plus percentiles of a seeded sample.
- Compare four operating-reserve methods: a flat-yield ladder, present value with a surplus margin and duration, a single stress return, and an in-sample shortfall target. Each method rolls remaining liability against reserve assets for 2033–2042.
- Apply facility rules only to wealth left after the reserve, and build a 2031 communication range by scenario envelope, full-horizon percentiles, or a two-year conditional sample.
- Export CSV and JSON for an appendix.
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

## Layout

| Path | What it is |
| --- | --- |
| `src/core/` | Pure TypeScript math. No React. |
| `src/ui/` | The workspace. |
| `docs/HOW_TO_MODELING.md` | Algorithms and how to use them on this case. |
| `services/finbert/` | Optional local scoring service. |
| `case-materials/` | Official competition PDFs and text extracts. They are reference material, not part of the model. |

## Tests

```bash
npm test
```

The tests lock the case contributions, the annuity-due present value, the ladder roll-forward (funded ratio near 1, nothing left after the 2042 payment), scenario compounding, drift versus annual rebalance, seeded Monte Carlo, and the rule that a facility contribution cannot be taken from the operating reserve.

## Starting numbers

On a fresh browser profile every return is 0%. Beginning-of-2033 wealth is $450,000. A 0% reserve for ten $50,000 payments is $500,000, so the residual for a facility gift is $0. That is the case arithmetic before any market assumption. **Load teaching example** overwrites inputs with round placeholders so charts move. Those placeholders are not a strategy.
