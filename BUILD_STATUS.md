# Build status

MVP toolkit is in this repository. It is a workspace for exploring the Laura Gao case. It does not contain a recommended portfolio, reserve, facility contribution, or co-sponsor range.

Checked on 2026-10-01.

## What shipped

- React + Vite + TypeScript app. `npm install`, `npm test`, and `npm run dev` are the path in.
- Assumptions workspace. Case contributions and the 2026–2042 timeline are locked. Returns, volatility, inflation, glide path, correlation, rebalance mode, Monte Carlo settings, and funding rules are editable and labeled as assumptions. A fresh profile starts at 0% returns. **Load teaching example** is opt-in and labeled as not a strategy.
- Projection engine for beginning-of-year wealth, 2027–2042, with bear / base / bull paths and seeded Monte Carlo percentiles. Two sleeves to start (growth and funding / liquidity). Annual rebalance or drift.
- Operating reserve comparison: flat-yield ladder, present value with a surplus margin and duration, one stress return, and an in-sample shortfall target. Each method can roll remaining liability against reserve assets for 2033–2042.
- Facility rules applied only to wealth left after the reserve, plus three communication-range methods (scenario envelope, full-horizon percentiles, conditional two-year sample from 2031). Draft wording is exploratory and editable.
- Charts, tables, and CSV / JSON export for IPS and Final Report drafting.
- `docs/HOW_TO_MODELING.md`, rendered in the **How to model** tab.
- Optional FinBERT helper at `services/finbert/server.py`, setup script `scripts/setup_finbert.py`, and a Research tab. If the model is absent, the tab says so and a separate demo lexicon still scores text. Saved notes stay in the browser and never enter the projection.

## How to run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints, usually `http://127.0.0.1:5173`.

Optional sentiment service (large download; skip it if you only want the portfolio tools):

```bash
python scripts/setup_finbert.py
python services/finbert/server.py
```

`GET http://127.0.0.1:8765/health` reports whether packages and cached weights are present. The server does not download the model. Dev mode proxies `/finbert` to port 8765. `npm run preview` talks to `http://127.0.0.1:8765` directly.

Read [docs/HOW_TO_MODELING.md](docs/HOW_TO_MODELING.md) before treating a chart as a conclusion.

## Verification done here

- `npm test`: 27 tests passed (26 engine, 1 guide render).
- `npx tsc --noEmit && npm run build` succeeded.
- Headless Chrome walked Assumptions, Projections, Operating reserve, Facility & range, Research, Export, and How to model at 1280×900 and at 390×844. Zero-default wealth is $450,000. Setting both sleeve base returns to 5% shows beginning-of-2033 wealth of $593,471. A $500,000 reserve with the retain-fraction set to 0 shows a residual contribution of $93,471. The draft range sentence contains “Exploratory” and does not contain “recommend”. The demo lexicon scored sample headlines and saved a note. Mobile pages did not widen the document (`scrollWidth` matched the viewport on every tab).
- `python services/finbert/server.py` answered `GET /health` with `ready: false` and `POST /score` with HTTP 503 and the install message, because `transformers` and `torch` are not installed in this environment. The model weights were not downloaded.

The browser check used headless Chrome, not a physical phone. CSV and JSON download buttons were not clicked in the browser; the CSV helpers are covered by unit tests.

## Known gaps

- No connection to WInS. Trading profit and loss cannot be entered, and the app does not place trades.
- Annual steps only. Returns are independent across years, normal (with a floor) or lognormal, with a constant Gaussian-copula correlation.
- The reserve shortfall sample uses `seed + 917`. The conditional two-year range uses `seed + 7`. Those draws are not the same history as the portfolio sample.
- A custom reinvestment path redraws the reserve schedule. Sizing still uses the method’s rate unless that path happens to match.
- No bond CUSIPs, no tax model, no optimizer, and no inflation adjustment of the $50,000 payments.
- Workspace state is `localStorage` in this browser only.
- FinBERT is optional and not preinstalled. The demo lexicon is a word list, not the model.
- `npm audit` reports 2 moderate findings, both in the Vitest dev dependency (`@vitest/mocker` path traversal). They were left as-is. `npm audit fix --force` was not run.
