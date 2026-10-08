import Base
import ./fix.bend as Fix

# Trade-sheet rounding. Prices and capital are whole dollars.
# A line buys min(requested, floor(budget / price)) shares.
# Spent dollars are qty × price. Leftover cash is capital − spent.
# Spent is never above the capital that line was given, and
# spent + leftover = capital. Bonds use the same rule with the
# dirty-price cost of one face lot in place of a share price.
# This does not choose an order. It checks the rounding.

type Sheet is Data:
  Sheet{qty: U32, spent: U32, left: U32, capital: U32}

def qty_of(s: Sheet) -> U32:
  match s:
    case Sheet{qty, _, _, _}:
      qty

def spent_of(s: Sheet) -> U32:
  match s:
    case Sheet{_, spent, _, _}:
      spent

def left_of(s: Sheet) -> U32:
  match s:
    case Sheet{_, _, left, _}:
      left

def capital_of(s: Sheet) -> U32:
  match s:
    case Sheet{_, _, _, capital}:
      capital

def qty_for(+budget: U32, +price: U32, +requested: U32) -> U32:
  U32.min(requested, Fix.muldiv(budget, 1, price))

def fill_one(+capital: U32, +price: U32, +requested: U32) -> Sheet:
  +qty = qty_for(capital, price, requested)
  +spent = (qty * price : U32)
  Sheet{qty, spent, (capital - spent : U32), capital}

def fill_bond(+budget: U32, +cost_per_lot: U32) -> Sheet:
  +lots = Fix.muldiv(budget, 1, cost_per_lot)
  +spent = (lots * cost_per_lot : U32)
  Sheet{lots, spent, (budget - spent : U32), budget}

def join_second(+capital: U32, +spent1: U32, second: Sheet) -> Sheet:
  match second:
    case Sheet{_, +spent2, +left2, _}:
      Sheet{0, (spent1 + spent2 : U32), left2, capital}

def from_first(+capital: U32, +p2: U32, +q2: U32, first: Sheet) -> Sheet:
  match first:
    case Sheet{_, +spent1, +left1, _}:
      join_second(capital, spent1, fill_one(left1, p2, q2))

def fill_two(+capital: U32, +p1: U32, +q1: U32, +p2: U32, +q2: U32) -> Sheet:
  from_first(capital, p2, q2, fill_one(capital, p1, q1))

def balanced_go(+spent: U32, +left: U32, +capital: U32, fits: Bool) -> Bool:
  match fits:
    case False{}:
      False{}
    case True{}:
      U32.is_eq((spent + left : U32), capital)

def balanced(s: Sheet) -> Bool:
  match s:
    case Sheet{_, +spent, +left, +capital}:
      balanced_go(spent, left, capital, U32.is_le(spent, capital))

# floor(300_000 / 381) = 787 shares. 787 × 381 = 299_847. Leftover 153.
def golden_shares() -> Sheet:
  fill_one(300000, 381, 1000)

# 500 shares at 100, then as many 250-dollar lots as the rest allows.
def golden_two() -> Sheet:
  fill_two(300000, 100, 500, 250, 10000)

# 1_018 dollars of dirty price per 1_000 face. Budget 20_000 buys 19 lots.
def golden_bond() -> Sheet:
  fill_bond(20000, 1018)
