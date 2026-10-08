import Base
import ./fix.bend as Fix
import ./ns.bend as Ns
import ./shock.bend as Shock

# Fixed-point Monte Carlo for one rate, one bond, and one equity sleeve.
# 16 trials, seed 42, years 2027 through 2030.
# The level starts at 4%. The 5-year quote is the Nelson-Siegel yield with a
# fixed -1% slope factor, floored at zero. Equity is a normal simple return
# on stream 1. The rate shock is stream 4. Weights are half and half.
# Contributions are the case amounts in 2027 and 2028.
# F32 shocks are truncated to ppm, then wealth moves in whole dollars.
# The TypeScript mirror in src/core/fanMirror.ts uses the same truncation.
# Mu, sigma, and the slope are caller-style constants for the parity check.
# They are not a forecast and not a portfolio.

type State is Data:
  State{wealth: U32, level: U32}

def trials() -> U32:
  16

def seed_of() -> U32:
  42

def start_level() -> U32:
  40000

def contrib_go(is_2027: Bool, is_2028: Bool) -> U32:
  match is_2027:
    case True{}:
      300000
    case False{}:
      match is_2028:
        case True{}:
          150000
        case False{}:
          0

def contrib(+year: U32) -> U32:
  contrib_go(U32.is_eq(year, 2027), U32.is_eq(year, 2028))

def rate_go(neg: Bool, x: F32) -> Fix.Rate:
  match neg:
    case True{}:
      Fix.Rate{True{}, F32.to_u32(F32.mul(F32.neg(x), 1000000.0))}
    case False{}:
      Fix.Rate{False{}, F32.to_u32(F32.mul(x, 1000000.0))}

def scaled_rate(+seed: U32, +trial: U32, +year: U32) -> Fix.Rate:
  rate_go(
    F32.is_lt(F32.mul(Fix.ppm_f32(10000), Shock.standard_normal(seed, 4, trial, year, 0)), 0.0),
    F32.mul(Fix.ppm_f32(10000), Shock.standard_normal(seed, 4, trial, year, 0))
  )

def equity_rate(+seed: U32, +trial: U32, +year: U32) -> Fix.Rate:
  rate_go(
    F32.is_lt(Shock.normal_simple(60000, 150000, Shock.standard_normal(seed, 1, trial, year, 0), True{}, 990000), 0.0),
    Shock.normal_simple(60000, 150000, Shock.standard_normal(seed, 1, trial, year, 0), True{}, 990000)
  )

def add_floor_go(+level: U32, +ppm: U32, neg: Bool) -> U32:
  match neg:
    case False{}:
      (level + ppm : U32)
    case True{}:
      Fix.sub_sat(level, ppm)

def add_floor(+level: U32, shock: Fix.Rate) -> U32:
  match shock:
    case Fix.Rate{neg, +ppm}:
      add_floor_go(level, ppm, neg)

def dy_go(+prev: U32, +next: U32, up: Bool) -> Fix.Rate:
  match up:
    case True{}:
      Fix.Rate{False{}, (next - prev : U32)}
    case False{}:
      Fix.Rate{True{}, (prev - next : U32)}

def dy_of(+prev: U32, +next: U32) -> Fix.Rate:
  dy_go(prev, next, U32.is_ge(next, prev))

def bond_down(+carry: U32, +loss: U32, ge: Bool) -> Fix.Rate:
  match ge:
    case True{}:
      Fix.Rate{False{}, (carry - loss : U32)}
    case False{}:
      Fix.Rate{True{}, (loss - carry : U32)}

# A negative change in the quote is a price gain. Match the sign constructors.
# A binder named `neg` would swallow both arms and add the duration term either way.
def bond_net(+carry: U32, dy: Fix.Rate) -> Fix.Rate:
  match dy:
    case Fix.Rate{True{}, +ppm}:
      Fix.Rate{False{}, (carry + Fix.muldiv(5000, ppm, 1000) : U32)}
    case Fix.Rate{False{}, +ppm}:
      +loss = Fix.muldiv(5000, ppm, 1000)
      bond_down(carry, loss, U32.is_ge(carry, loss))

def half_grow(+wealth: U32, equity: Fix.Rate, bond: Fix.Rate) -> U32:
  +eq = Fix.muldiv(wealth, 500000, Fix.unit())
  +bd = (wealth - eq : U32)
  (Fix.grow(eq, equity) + Fix.grow(bd, bond) : U32)

def one_year(+wealth: U32, +level: U32, +year: U32, +trial: U32) -> State:
  +with_cash = (wealth + contrib(year) : U32)
  +quote = Ns.quote_5y(level)
  +shock = scaled_rate(seed_of(), trial, year)
  +next_level = add_floor(level, shock)
  +next_quote = Ns.quote_5y(next_level)
  +bond = bond_net(quote, dy_of(quote, next_quote))
  +equity = equity_rate(seed_of(), trial, year)
  State{half_grow(with_cash, equity, bond), next_level}

def year_loop(+fuel: Nat, +year: U32, state: State, +trial: U32) -> U32:
  match fuel:
    case 0n:
      match state:
        case State{+wealth, +level}:
          wealth
    case 1n+p:
      match state:
        case State{+wealth, +level}:
          year_loop(p, (year + 1 : U32), one_year(wealth, level, year, trial), trial)

def one_trial(+trial: U32) -> U32:
  year_loop(4n, 2027, State{0, start_level()}, trial)

def wealth_after(+years: Nat, +trial: U32) -> U32:
  year_loop(years, 2027, State{0, start_level()}, trial)

def pick_lo_go(+lo: U32, +value: U32, less: Bool) -> U32:
  match less:
    case True{}:
      value
    case False{}:
      lo

def pick_hi_go(+hi: U32, +value: U32, more: Bool) -> U32:
  match more:
    case True{}:
      value
    case False{}:
      hi

def pick_lo(+lo: U32, +value: U32) -> U32:
  pick_lo_go(lo, value, U32.is_lt(value, lo))

def pick_hi(+hi: U32, +value: U32) -> U32:
  pick_hi_go(hi, value, U32.is_lt(hi, value))

type Acc is Data:
  Acc{sum: U32, lo: U32, hi: U32}

def absorb(acc: Acc, +value: U32) -> Acc:
  match acc:
    case Acc{+sum, +lo, +hi}:
      Acc{(sum + value : U32), pick_lo(lo, value), pick_hi(hi, value)}

def acc_loop(+fuel: Nat, +trial: U32, acc: Acc) -> Acc:
  match fuel:
    case 0n:
      acc
    case 1n+p:
      match acc:
        case Acc{+sum, +lo, +hi}:
          acc_loop(p, (trial + 1 : U32), absorb(Acc{sum, lo, hi}, one_trial(trial)))

# One walk over the 16 trials. Mean, min, and max come from this accumulator.
def totals() -> Acc:
  +first = one_trial(0)
  acc_loop(15n, 1, Acc{first, first, first})

def acc_sum(acc: Acc) -> U32:
  match acc:
    case Acc{+sum, +lo, +hi}:
      sum

def acc_lo(acc: Acc) -> U32:
  match acc:
    case Acc{+sum, +lo, +hi}:
      lo

def acc_hi(acc: Acc) -> U32:
  match acc:
    case Acc{+sum, +lo, +hi}:
      hi

def total_sum() -> U32:
  acc_sum(totals())

def total_lo() -> U32:
  acc_lo(totals())

def total_hi() -> U32:
  acc_hi(totals())

def mean_wealth() -> U32:
  Fix.muldiv(total_sum(), 1, trials())

def ordered_go(acc: Acc) -> Bool:
  match acc:
    case Acc{+sum, +lo, +hi}:
      Bool.and(U32.is_le(lo, Fix.muldiv(sum, 1, trials())), U32.is_le(Fix.muldiv(sum, 1, trials()), hi))

def ordered() -> Bool:
  ordered_go(totals())

# Trial 0, the mean, the minimum, and the maximum of the 16-trial fan.
# The dollars are the parity band against src/core/fanMirror.ts.
# bend/main.bend prints them. The proven kernel does not reduce this F32
# net: one trial passed 6 GB and the process was killed. FAN.bend therefore
# rechecks the integer contract only.
def fan_matches_go(acc: Acc) -> Bool:
  match acc:
    case Acc{+sum, +lo, +hi}:
      Bool.and(
        U32.is_eq(one_trial(0), 570859),
        Bool.and(
          U32.is_eq(Fix.muldiv(sum, 1, trials()), 515116),
          Bool.and(U32.is_eq(lo, 414380), U32.is_eq(hi, 684805))
        )
      )

def fan_matches() -> Bool:
  fan_matches_go(totals())

def show_fan_go(acc: Acc) -> String:
  match acc:
    case Acc{+sum, +lo, +hi}:
      "fan_trials " ++ U32.show(trials())
        ++ "\nfan_mean " ++ U32.show(Fix.muldiv(sum, 1, trials()))
        ++ "\nfan_min " ++ U32.show(lo)
        ++ "\nfan_max " ++ U32.show(hi)

def show_fan() -> String:
  show_fan_go(totals())
