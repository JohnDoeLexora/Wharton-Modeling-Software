import Base
import ./fix.bend as Fix

# Nelson-Siegel quotes under the shared floor policy `zero-floor-on-quotes`.
# A quoted annual zero is max(0, the model yield). Discount factors are
# 1/(1+z)^n in floor arithmetic, then a running minimum, so a longer
# maturity never discounts less heavily than a shorter one.
# Loadings are round(L * 1_000_000) at lambda = 0.6.
# L1(t) = (1 - exp(-lambda t)) / (lambda t)
# L2(t) = L1(t) - exp(-lambda t)
# Nothing here is a forecast.

def floor_ppm() -> U32:
  0

def l1_5() -> U32:
  316738

# y = level + signed slope * L1. A negative result quotes zero.
def quote_go(+pos: U32, +neg: U32) -> U32:
  Fix.sub_sat(pos, neg)

def quote_flat(+level_ppm: U32) -> U32:
  level_ppm

# Slope factor fixed at -1% (10_000 ppm). The 5-year quote is level minus that loading.
def quote_5y(+level_ppm: U32) -> U32:
  quote_go(level_ppm, Fix.muldiv(10000, l1_5(), Fix.unit()))

def discount_once(+df: U32, +yield_ppm: U32) -> U32:
  Fix.muldiv(df, Fix.unit(), (Fix.unit() + yield_ppm : U32))

def discount_loop(+fuel: Nat, +df: U32, +yield_ppm: U32) -> U32:
  match fuel:
    case 0n:
      df
    case 1n+p:
      discount_loop(p, discount_once(df, yield_ppm), yield_ppm)

def df_years(+years: Nat, +yield_ppm: U32) -> U32:
  discount_loop(years, Fix.unit(), yield_ppm)

def monotone_go(+prev: U32, +raw: U32, raw_le: Bool) -> U32:
  match raw_le:
    case True{}:
      raw
    case False{}:
      prev

def monotone(+prev: U32, +raw: U32) -> U32:
  monotone_go(prev, raw, U32.is_le(raw, prev))

# Flat 4% Nelson-Siegel curve: beta0 = 4%, slope and curvature zero.
# Quotes are positive, so the raw discount factors already fall with maturity.
# The envelope leaves them unchanged.
def df_1y() -> U32:
  df_years(1n, quote_flat(40000))

def df_2y() -> U32:
  monotone(df_1y(), df_years(2n, quote_flat(40000)))

def df_5y() -> U32:
  monotone(df_2y(), df_years(5n, quote_flat(40000)))

def df_10y() -> U32:
  monotone(df_5y(), df_years(10n, quote_flat(40000)))

# A negative shadow level quotes zero, so every discount factor is 1.
def df_negative_level() -> U32:
  df_years(1n, quote_flat(floor_ppm()))

def positive_and_decreasing() -> Bool:
  Bool.and(
    U32.is_lt(df_10y(), df_5y()),
    Bool.and(
      U32.is_lt(df_5y(), df_2y()),
      Bool.and(U32.is_lt(df_2y(), df_1y()), Bool.and(U32.is_lt(0, df_10y()), U32.is_le(df_1y(), Fix.unit())))
    )
  )
