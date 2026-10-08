# Data provenance

Fetched 2026-10-08 by `scripts/fetch_treasury.py`.

These files describe published yields and a published equity factor series.
They are not a forecast, and they are not a portfolio.

## US Treasury par yield curve

Source: U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates.
URL pattern: https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/YEAR/all?type=daily_treasury_yield_curve&field_tdr_date_value=YEAR&page&_format=csv
The published file is percent. `data/treasury_par_yields.csv` stores decimals (a printed 0.50 is 0.005).
Columns: as_of, tenor_years, par_yield. Dates are kept as the Treasury file printed them (M/D/YYYY).
Rows: 99329.

sha256: `670bc2149026bab46e86315a6781f2153fab33c8fe377caaa790930ccfffaf22`

Year log:

- 1990: 2250 tenor rows
- 1991: 2250 tenor rows
- 1992: 2259 tenor rows
- 1993: 2312 tenor rows
- 1994: 2490 tenor rows
- 1995: 2500 tenor rows
- 1996: 2520 tenor rows
- 1997: 2500 tenor rows
- 1998: 2500 tenor rows
- 1999: 2510 tenor rows
- 2000: 2510 tenor rows
- 2001: 2583 tenor rows
- 2002: 2532 tenor rows
- 2003: 2500 tenor rows
- 2004: 2500 tenor rows
- 2005: 2500 tenor rows
- 2006: 2724 tenor rows
- 2007: 2761 tenor rows
- 2008: 2758 tenor rows
- 2009: 2750 tenor rows
- 2010: 2761 tenor rows
- 2011: 2750 tenor rows
- 2012: 2750 tenor rows
- 2013: 2750 tenor rows
- 2014: 2750 tenor rows
- 2015: 2761 tenor rows
- 2016: 2750 tenor rows
- 2017: 2750 tenor rows
- 2018: 2790 tenor rows
- 2019: 3000 tenor rows
- 2020: 3012 tenor rows
- 2021: 3012 tenor rows
- 2022: 3038 tenor rows
- 2023: 3250 tenor rows
- 2024: 3250 tenor rows
- 2025: 3237 tenor rows
- 2026: 2509 tenor rows

## Ken French research factors

URL: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip
The market total return used by the backtest is (Mkt-RF + RF) / 100, from the annual block.
Equity growth in a window is context. It is not a portfolio weight and it does not enter the case projection.

sha256: `d7d7fe37b150b5b15c9c069b3ba101dfe1af568c6d7b5db6e73cd0a6c0c9e5e5`

