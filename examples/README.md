# Example files

These CSVs are **examples of the file shape**. They are not a portfolio, not a model book, and not loaded when the app starts. The holdings editor starts empty. Import a file only when you want to see the columns.

`example-holdings.csv` uses made-up tickers (`EXA`, `EXB`, `EX-ETF`, `EX-US-NOTE`) so it cannot be mistaken for a competition book.

`example-market.csv` uses round prices and volumes for the same tickers. The as-of date is a label, not a market close.

`curve-snapshot.csv` and `curve-history.csv` are curve shapes for the Curve tab. The yields are round figures, not a Treasury close. The official history is what `scripts/fetch_treasury.py` writes under `data/`.

`govt-buckets.csv`, `bil-buckets.csv`, and `target-fund-buckets.csv` are maturity-bucket shapes for the Instruments tab. The weights and coupons are round. They are not a fund’s holdings.

`fills.csv` is a fills shape for the Tracking tab, on the same made-up tickers. `equity-annual-sample.csv` is a tiny factor file so a backtest window can show an equity column. It is not the Ken French series. That series, when the download succeeds, is `data/french_ff_annual.csv`.
