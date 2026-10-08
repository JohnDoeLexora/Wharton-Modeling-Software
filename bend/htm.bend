import Base
import ./fix.bend as Fix
import ./bond.bend as Bond

# Hold-to-maturity cash. Coupons are received. The bond is not sold, so a
# mark along the way does not change the cash. At maturity the face is paid.
# Terminal cash is face + coupons. Two different mark paths match.
# The annual hold-to-maturity return is the carry. A yield change is ignored.

def absorb(+cash: U32, +coupon: U32, +mark: U32) -> U32:
  +ignored = Fix.muldiv(mark, 0, 1)
  (cash + coupon + ignored : U32)

def hold3(+coupon: U32, +face: U32, +m1: U32, +m2: U32, +m3: U32) -> U32:
  +c1 = absorb(0, coupon, m1)
  +c2 = absorb(c1, coupon, m2)
  +c3 = absorb(c2, coupon, m3)
  (c3 + face : U32)

def par_plus_coupons(+face: U32, +coupon: U32, +years: U32) -> U32:
  (face + (coupon * years : U32) : U32)

def terminal_golden(+m1: U32, +m2: U32, +m3: U32) -> U32:
  hold3(5000, 100000, m1, m2, m3)

# Annual wealth if the bond is held rather than marked. `dy` is accepted
# and dropped. The return is the carry.
def wealth_htm(+wealth: U32, +carry_ppm: U32, +dy_ppm: U32) -> U32:
  +ignored = Fix.muldiv(dy_ppm, 0, 1)
  Fix.grow(wealth, Fix.Rate{False{}, (carry_ppm + ignored : U32)})

def wealth_mtm(+wealth: U32, +carry_ppm: U32, +duration_milli: U32, +convexity_milli: U32, +dy_ppm: U32) -> U32:
  Fix.grow(wealth, Fix.Rate{False{}, Bond.mtm_ppm(carry_ppm, duration_milli, convexity_milli, dy_ppm)})
