# Build status

Version 2 of the Gao modeling toolkit is in this repository. It is a workspace for exploring the Laura Gao case. It does not contain a recommended portfolio, reserve, facility contribution, or co-sponsor range.

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
