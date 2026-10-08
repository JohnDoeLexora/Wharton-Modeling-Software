import Base
import ./fix.bend as Fix

# Short-rate regimes and a three-point curve, in parts per million.
# 1_000_000 ppm is a rate of 1. A pace of 7_500 ppm is 75 basis points.
# The integer short rate does not go below zero. The TypeScript engine
# floors at -5%. Paths used by the laws stay non-negative, so the two
# engines agree on those paths. A regime is an illustration the caller
# selects. Nothing here is a forecast or a portfolio.

type Regime is Data:
  Rising{}
  Flat{}
  Falling{}
  ShockUp{}
  Stagflation{}

type Curve is Data:
  Curve{short: U32, intermediate: U32, long: U32}

def pace_if(on: Bool, +ppm: U32, neg: Bool) -> Fix.Rate:
  match on:
    case False{}:
      Fix.zero_rate()
    case True{}:
      Fix.Rate{neg, ppm}

# Rising and stagflation add `pace` while index < years.
# Falling subtracts it. Shock-up adds `level_shock` in index 0 only.
# Flat adds nothing. Index 0 is the year that ends at the start of 2028.
def drift_of(+index: U32, regime: Regime, +pace: U32, +years: U32, +level_shock: U32) -> Fix.Rate:
  match regime:
    case Flat{}:
      Fix.zero_rate()
    case Rising{}:
      pace_if(U32.is_lt(index, years), pace, False{})
    case Falling{}:
      pace_if(U32.is_lt(index, years), pace, True{})
    case ShockUp{}:
      pace_if(U32.is_zero(index), level_shock, False{})
    case Stagflation{}:
      pace_if(U32.is_lt(index, years), pace, False{})

def add_signed(+base: U32, +ppm: U32, neg: Bool) -> U32:
  match neg:
    case False{}:
      (base + ppm : U32)
    case True{}:
      Fix.sub_sat(base, ppm)

def mean_go(+short: U32, +kappa: U32, +theta: U32, up: Bool) -> U32:
  match up:
    case True{}:
      (short + Fix.muldiv(kappa, (theta - short : U32), Fix.unit()) : U32)
    case False{}:
      Fix.sub_sat(short, Fix.muldiv(kappa, (short - theta : U32), Fix.unit()))

# r + κ(θ − r). A zero kappa leaves the short rate where it is.
def mean_revert(+short: U32, +kappa: U32, +theta: U32) -> U32:
  mean_go(short, kappa, theta, U32.is_ge(theta, short))

# One annual step: mean reversion, then the regime drift, then σ z.
# z is a caller-supplied shock in ppm (1_000_000 ppm is one standard deviation).
# A zero sigma drops the shock. The draw itself is rng.bend stream 4.
def step_short(
  +short: U32, +kappa: U32, +theta: U32, drift: Fix.Rate, +sigma: U32, +z: U32, zneg: Bool
) -> U32:
  match drift:
    case Fix.Rate{neg, +ppm}:
      add_signed(add_signed(mean_revert(short, kappa, theta), ppm, neg), Fix.muldiv(sigma, z, Fix.unit()), zneg)

# phase False reads whether index has reached the target.
# phase True either returns that short rate or takes one annual step.
# Fuel only bounds the walk. A reached target burns the remaining fuel
# and still returns that short rate.
def short_loop(
  +fuel: Nat, phase: Bool, +index: U32, +target: U32, +short: U32,
  +regime: Regime, +pace: U32, +years: U32, +shock: U32, +kappa: U32, +theta: U32, done: Bool
) -> U32:
  match fuel:
    case 0n:
      short
    case 1n+p:
      match phase:
        case False{}:
          short_loop(p, True{}, index, target, short, regime, pace, years, shock, kappa, theta, U32.is_eq(index, target))
        case True{}:
          match done:
            case True{}:
              short_loop(p, True{}, index, target, short, regime, pace, years, shock, kappa, theta, True{})
            case False{}:
              short_loop(
                p, False{}, (index + 1 : U32), target,
                step_short(short, kappa, theta, drift_of(index, regime, pace, years, shock), 0, 0, False{}),
                regime, pace, years, shock, kappa, theta, False{}
              )

# Short rate at a beginning-of-year index. 0 is the start of 2027. 6 is the start of 2033.
def short_at(
  +index: U32, +r0: U32, regime: Regime, +pace: U32, +years: U32, +shock: U32, +kappa: U32, +theta: U32
) -> U32:
  short_loop(40n, False{}, 0, index, r0, regime, pace, years, shock, kappa, theta, False{})

def curve_of(+short: U32, +intermediate_premium: U32, +long_premium: U32, +slope: U32) -> Curve:
  Curve{short, (short + intermediate_premium : U32), ((short + long_premium : U32) + slope : U32)}

def curve_short(c: Curve) -> U32:
  match c:
    case Curve{s, _, _}:
      s

def curve_intermediate(c: Curve) -> U32:
  match c:
    case Curve{_, m, _}:
      m

def curve_long(c: Curve) -> U32:
  match c:
    case Curve{_, _, l}:
      l

# Template illustrations. The numbers match src/core/rates.ts. They are not forecasts.
def rising_short_2033() -> U32:
  short_at(6, 0, Rising{}, 7500, 3, 0, 0, 0)

def flat_short_2033() -> U32:
  short_at(6, 0, Flat{}, 0, 0, 0, 0, 0)

def falling_short_2030() -> U32:
  short_at(3, 30000, Falling{}, 5000, 3, 0, 0, 0)

def shock_short_2028() -> U32:
  short_at(1, 0, ShockUp{}, 0, 0, 20000, 0, 0)

def stagflation_short_2029() -> U32:
  short_at(2, 0, Stagflation{}, 10000, 2, 0, 0, 0)

def revert_one_step() -> U32:
  short_at(1, 0, Flat{}, 0, 0, 0, 500000, 100000)

def vol_step(+short: U32, +sigma: U32, +z: U32) -> U32:
  step_short(short, 0, 0, Fix.zero_rate(), sigma, z, False{})
