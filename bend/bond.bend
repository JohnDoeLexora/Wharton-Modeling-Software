import Base
import ./fix.bend as Fix

# Annual bond total return in parts per million.
# R = carry - duration * dy + 0.5 * convexity * dy^2.
#
# duration_milli: 1 year of modified duration is 1000. A 15-year bond is 15000.
# convexity_milli: 1 unit of convexity is 1000. The 0.5 is in the divisor below.
# dy_ppm and carry_ppm: 1 is 1000000 ppm, so 1% is 10000 ppm.
#
# A zero yield change makes both the duration term and the convexity term 0,
# so the return is the carry. Dollars and yields here are caller inputs.
# Nothing in this file is a portfolio.

def duration_loss_ppm(+duration_milli: U32, +dy_ppm: U32) -> U32:
  Fix.muldiv(duration_milli, dy_ppm, 1000)

def convexity_gain_ppm(+convexity_milli: U32, +dy_ppm: U32) -> U32:
  +step = Fix.muldiv(convexity_milli, dy_ppm, 1000)
  Fix.muldiv(step, dy_ppm, 2000000)

def mtm_ppm(
  +carry_ppm: U32, +duration_milli: U32, +convexity_milli: U32, +dy_ppm: U32
) -> U32:
  +gain = convexity_gain_ppm(convexity_milli, dy_ppm)
  +loss = duration_loss_ppm(duration_milli, dy_ppm)
  Fix.sub_sat((carry_ppm + gain : U32), loss)

# True when the mark-to-market return at dy_hi is at or below the return at dy_lo.
# With convexity 0 and duration above 0, a larger yield change removes more carry.
def mtm_falls(+carry_ppm: U32, +duration_milli: U32, +convexity_milli: U32, +dy_lo: U32, +dy_hi: U32) -> Bool:
  U32.is_le(
    mtm_ppm(carry_ppm, duration_milli, convexity_milli, dy_hi),
    mtm_ppm(carry_ppm, duration_milli, convexity_milli, dy_lo)
  )

# A yield decline (neg = true) adds the duration term instead of subtracting it.
def mtm_signed(
  +carry_ppm: U32, +duration_milli: U32, +convexity_milli: U32, +dy_ppm: U32, neg: Bool
) -> U32:
  match neg:
    case False{}:
      mtm_ppm(carry_ppm, duration_milli, convexity_milli, dy_ppm)
    case True{}:
      (carry_ppm + duration_loss_ppm(duration_milli, dy_ppm) + convexity_gain_ppm(convexity_milli, dy_ppm) : U32)

def wealth_after(
  +wealth: U32, +carry_ppm: U32, +duration_milli: U32, +convexity_milli: U32, +dy_ppm: U32
) -> U32:
  Fix.grow(wealth, Fix.Rate{False{}, mtm_ppm(carry_ppm, duration_milli, convexity_milli, dy_ppm)})
