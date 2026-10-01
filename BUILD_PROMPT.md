# Task: Build modeling SOFTWARE + how-to for Wharton Investment Competition (Laura Gao case)

You are Grok Build in this git repo: https://github.com/JohnDoeLexora/Wharton-Modeling-Software (currently nearly empty; `case-materials/` has the official PDFs + extracted text).

## Critical product stance (read carefully)
- This is a **modeling toolkit / software platform** for the team — NOT a finished investment recommendation and NOT “what we think is best.”
- Do **not** hardcode a “recommended” strategy, allocation, facility contribution, or reserve size as the answer. Defaults may prefill **case cash flows and timelines** only; assumptions (returns, vols, allocation paths, certainty rules) must be user-editable inputs with clear labels that they are **assumptions to explore**, not prescriptions.
- The software should help colleagues **run scenarios, stress tests, and method comparisons** so the *team* can decide later.
- Include a substantial **How-To / Modeling Guide** documenting the algorithms and standard practices people use for this kind of long-horizon goal-based financial modeling (liability funding, reserves, Monte Carlo / scenario trees, glide paths, etc.) — educational + practical, tied to the Gao case framing.

## Case facts to encode as defaults (from `case-materials/gao-case.txt` — do not invent)
- Year N = 2026 + N; Year 0 = 2026 (present, before investment).
- Contributions at beginning of year: **+$300,000 in 2027 (Y1)**; **+$150,000 in 2028 (Y2)**; nothing else until 2033.
- Living expenses covered outside the portfolio.
- Beginning of **2033 (Y7)**: (1) set aside an **operating reserve** to fund **ten fixed $50,000** payments at beginning of each year **2033–2042** (not inflation-adjusted) with a **high degree of funding certainty** (user-defined rule); (2) decide a **facility contribution** from remaining wealth (no preset amount) while preserving flexibility.
- In **2031 (Y5)**: communicate a **credible range** for the 2033 facility contribution to co-sponsors, with confidence vs favorable/unfavorable outcomes, without jeopardizing the operating commitment.
- WInS trading P&L must **not** feed long-term projections; projections use case cash flows + user return assumptions.
- Ignore personal taxes / Taiwan legal setup for competition purposes.

## Product requirements (basics MVP — ship runnable)

### A. Modeling software (preferred: TypeScript + Vite + React; pure-TS calc core; `npm install && npm run dev`)
1. **Assumptions workspace** — editable returns/vols (or simpler return assumptions) by sleeve/asset class; inflation for optional purchasing-power views; contribution schedule prefilled from case; allocation / glide-path inputs; certainty / funding rules as selectable methods (not a single locked answer).
2. **Projection engine** — project wealth ~2027–2042 under multiple paths (base / bull / bear and/or Monte Carlo percentiles). Multi-sleeve (e.g. growth vs funding/liquidity) supported.
3. **Operating reserve tools** — several *methods* the user can compare (examples: cash/T-bill ladder matching payment dates; duration/liability matching; probability-of-shortfall / funded-ratio under stress). Show remaining liability vs reserve assets each year 2033–2042. User picks method + parameters.
4. **Facility contribution & 2031 range tools** — given projected 2033 wealth after reserve set-aside under chosen scenarios, help compute **candidate** contribution amounts and a **communication range** with an explicit, documented confidence method. Outputs are exploratory, clearly labeled.
5. **Charts/tables + export** (CSV/JSON) for IPS / Final Report drafting.
6. Unit tests for pure math (projections, reserve sizing helpers, range helpers).

### B. How-to / modeling algorithms guide (in-repo docs, also linkable from the app)
Write `docs/HOW_TO_MODELING.md` (and shorter in-app help) covering, in plain language with formulas where useful:
- Goal-based investing & separating **growth capital** vs **liability / operating reserve** capital
- Discounting / funding certainty concepts for a known nominal liability stream ($50k × 10)
- Scenario analysis vs Monte Carlo; interpreting percentiles without overclaiming
- Glide paths and de-risking as payment dates approach
- Building a co-sponsor **communication range** without promising a point estimate
- How this software’s modules map onto the Gao deliverables (Trading Notes / IPS / Final Report) — as a *workflow*, not a filled-in strategy
- What FinBERT is for (below) and how sentiment scores can feed *optional* research inputs — never auto-trade

### C. FinBERT integration (colleagues requested)
Integrate **FinBERT** (ProsusAI / financial sentiment BERT) in a practical, optional way:
- A **Research / News sentiment** panel: paste headlines or short articles → run FinBERT (or a small local/API wrapper) → show positive/negative/neutral scores.
- Persist scores as **optional qualitative inputs / tags** next to tickers or themes the team is researching — useful for Trading Notes, **not** an automatic portfolio optimizer.
- Prefer a clean architecture: Python microservice **or** a documented notebook/script + UI hook if full in-browser is too heavy. If model download is large, provide `scripts/setup_finbert.py` (or similar), README setup steps, and a graceful UI state when the model isn’t installed yet (mock/sample mode OK for demo).
- Cite the model (FinBERT) in README/docs; no fabricated accuracy claims.

## Git / deliverables
- Commit and **push to `origin/main`** (clear commits; no force-push). Remote already set; git user is configured.
- `README.md` — install, run app, run FinBERT setup, philosophy (“toolkit not advice”).
- `BUILD_STATUS.md` when done — what shipped, how to run, known gaps.

## Done criteria
- App runs locally with Gao cash-flow defaults
- How-to guide present and linked
- FinBERT path works or has clear setup + demo/fallback
- Core math tested; pushed to GitHub `main`

Start now. Prefer a solid MVP toolkit over an unfinished mega-design. Do not invent a “best” portfolio for Laura.
