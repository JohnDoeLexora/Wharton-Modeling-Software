# Independent Python cross-check

`sim.py` is a copy of the team's analysis harness. It is **not** the app, and it is **not** a portfolio. The file uses NumPy Philox streams and its own rate model. Importing it needs the analysis `params` package, which is not in this repository. `parity_check.py` does not import the module. It reads `bond_price`, `par_dur_conv`, and `curve_y` out of the source with the AST, and it implements SplitMix64 and the lognormal wealth path on its own.

`parity_check.py` asserts:

- Locked cash flows and a zero-yield reserve of 500,000.
- The 1% annuity-due ladder, using the same truncating division as Bend.
- The fixed-point bond return at a zero yield change, and a monotone mark-to-market move.
- The SplitMix64 word for seed 42, stream 1, trial 0, step 2027, dimension 0.
- The extracted curve and par-bond helpers return finite prices.
- P(funded), p5, and p50 of a 200-trial parametric book agree with the TypeScript engine inside the stated bands. The TypeScript side writes `/tmp/gao-parity-ts.json`. Bend does not run that sample; its job is the deterministic goldens.

This directory does not choose holdings.
