import Base
import ./fix.bend as Fix
import ./case.bend as Case

# Operating reserve as backward induction.
# returns_left counts the gaps between the ten payments (9 at the start).
# needed begins at the last payment. Each earlier date is
# payment + discount(next, rate). At a zero yield, discount is identity,
# so the ladder is 10 * 50_000 = 500_000.
# This sizes a reserve. It does not choose an asset.

def immunize(+left: Nat, needed: U32, +rate: Fix.Rate) -> U32:
  match left:
    case 0n:
      needed
    case 1n+p:
      immunize(p, (Case.operating_payment() + Fix.discount(needed, rate) : U32), rate)

# Flat-yield ladder. `rate` is the caller-supplied reinvestment yield.
def ladder_at(+rate: Fix.Rate) -> U32:
  immunize(9n, Case.operating_payment(), rate)

# Roll a reserve forward. Each step pays 50_000, then earns `rate`.
# A long-only balance cannot go below zero. At a matched zero-yield
# ladder the ending balance is zero.
def roll(+left: Nat, bal: U32, +rate: Fix.Rate) -> U32:
  match left:
    case 0n:
      bal
    case 1n+p:
      roll(p, Fix.grow(Fix.sub_sat(bal, Case.operating_payment()), rate), rate)

# Duration method: present value times (1 + margin). Margin is ppm and may
# be zero. A zero margin matches the ladder. The margin is a caller input.
def with_margin(+pv: U32, +margin_ppm: U32) -> U32:
  (pv + Fix.muldiv(pv, margin_ppm, Fix.unit()) : U32)
