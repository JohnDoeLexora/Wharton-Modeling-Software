import Base
import ./fix.bend as Fix
import ./ns.bend as Ns

# Cash-flow identities in whole dollars.
# A coupon bond's dirty price is the sum of its discounted cash flows.
# A target-maturity fund at its maturity date is cash.
# A higher expense ratio never raises the net asset value.
# These are arithmetic checks. They are not a holding.

def leg(+cash: U32, +df: U32) -> U32:
  Fix.muldiv(cash, df, Fix.unit())

# 2-year annual 5% coupon on 10_000 face. Cash flows 500 and 10_500.
def dirty_zero() -> U32:
  (500 + 10500 : U32)

def leg_5_a() -> U32:
  leg(500, Ns.df_years(1n, 50000))

def leg_5_b() -> U32:
  leg(10500, Ns.df_years(2n, 50000))

def dirty_5pct() -> U32:
  (leg_5_a() + leg_5_b() : U32)

# 2-year 4% semiannual coupon on 10_000 face, valued at a zero yield.
# Four coupons of 200 plus the face.
def semiannual_dirty_zero() -> U32:
  (200 + 200 + 200 + 10200 : U32)

# At maturity the position is the face in cash, whatever the yield was.
def target_at_maturity(+face: U32) -> U32:
  face

def target_one_year(+face: U32, +yield_ppm: U32) -> U32:
  Fix.muldiv(face, Ns.df_years(1n, yield_ppm), Fix.unit())

def nav_after(+start: U32, +gross_ppm: U32, +expense_ppm: U32) -> U32:
  Fix.muldiv(
    Fix.muldiv(start, (Fix.unit() + gross_ppm : U32), Fix.unit()),
    (Fix.unit() - expense_ppm : U32),
    Fix.unit()
  )

def nav_fee_0() -> U32:
  nav_after(1000000, 50000, 0)

def nav_fee_low() -> U32:
  nav_after(1000000, 50000, 1000)

def nav_fee_high() -> U32:
  nav_after(1000000, 50000, 5000)

def expense_is_monotone() -> Bool:
  Bool.and(U32.is_lt(nav_fee_high(), nav_fee_low()), U32.is_lt(nav_fee_low(), nav_fee_0()))

def target_is_below_par() -> Bool:
  U32.is_lt(target_one_year(10000, 40000), target_at_maturity(10000))
