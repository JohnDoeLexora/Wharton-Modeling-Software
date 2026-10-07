# Gao model V3 spec — rates, duration, credit, single names (shared by app engine + analysis harness)

Case locks (never change): Year N = 2026+N. +$300,000 BOY 2027, +$150,000 BOY 2028. No other flows before 2033.
BOY 2033: carve operating reserve for 10 x $50,000 nominal payments BOY 2033..2042 (high certainty, portfolio-only).
Facility contribution = remainder after reserve (team-chosen rule). 2031: communicate credible facility range + confidence.
WInS trading P&L never enters long-term projections. Not investment advice; team analysis.

## 1. Rate model (path-based, annual steps 2027..2042)
- Short rate r_t follows a mean-reverting process (Vasicek/Hull-White style, annual discretization) with an explicit DRIFT REGIME overlay:
  - rising (e.g. +50-100bp/yr for 3 yrs then plateau), flat, falling (cuts), shock-up (+200bp in one year), stagflation (rates up + equity down, correlated).
- Simple 3-point curve: short (T-bill), intermediate (~5y), long (~10y+) yields = r_t + term premia (editable), parallel + slope shocks.
- Same rate path drives: T-bill yield, bond pricing, reserve discount/reinvestment, and (via correlation) equity shocks.

## 2. Fixed income must be priced, not given a flat mu
Annual total return for a bond sleeve with modified duration D and convexity C:
  R = y_{t-1} (carry) - D * dy + 0.5 * C * dy^2  (- default loss for credit)
- T-bills: D ~ 0.25-0.5, rolled annually -> essentially no mark-to-market loss; reinvest at new higher yield when rates rise.
- Intermediate Treasuries D ~ 4-6; long Treasuries D ~ 15+ -> visible "underwater" losses when rates rise.
- Hold-to-maturity view vs mark-to-market view both reported (a bond held to maturity returns par; underwater is an MTM / opportunity-cost issue).
- Credit / corporate (incl. "SpaceX debt"-style issuer bonds): yield = treasury + spread; spread widens in equity drawdowns; annual default prob with recovery; label issuer debt as credit risk, NOT T-bill-equivalent. If an instrument is not publicly tradable / not WInS-eligible, flag it.

## 3. Equity
- Broad equity (S&P-like): fat tails (Student-t, df ~5) with editable mu/sigma; negative correlation to rate shock-up in stagflation regime.
- Single names / satellites: one-factor model  r_i = alpha_i + beta_i * r_mkt + eps_i (idiosyncratic sigma_i, fat-tailed), optional jump/crash. Group/sector factors (Taiwan/semis, AI/tech, media/education, financials, staples/utilities).
- Basket of N names: report diversification (effective N), not just one stock.
- Taiwan-exposure names (EWT/FLTW/TSM...) also carry USD/TWD currency risk and geopolitical jump risk — editable.

## 4. Portfolio mechanics
- Sleeves weights with glide path; annual rebalance or drift; transaction cost bps and ETF expense ratios as drag.
- Reserve at BOY 2033: method choices (PV ladder at curve, nominal $500k cash, T-bill ladder, duration-matched treasuries). Reserve immunization: duration-match reserve vs liability duration (~4.5y) and show what happens to funded status under rate paths.
- Metrics: BOY-2033 wealth percentiles (p1,p5,p10,p50,p90,p95), P(reserve fully funded), expected shortfall (CVaR5) of 2033 wealth, max drawdown along path, funded ratio, facility gift distribution, 2031-conditional facility range + coverage confidence, MTM loss of bond sleeves under rising rates, Sharpe/Sortino, sensitivities.

## 5. Rigor
- Counter-based seeded RNG streams (portfolio, rates, credit, idio) so runs reproduce; common random numbers across compared mixes.
- Convergence check (standard error of key metrics; increase trials until SE small).
- Every assumption in one table with source/justification; scenario sweeps written to CSV/JSON.
