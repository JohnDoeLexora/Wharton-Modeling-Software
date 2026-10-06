import Base
import ./fix.bend as Fix

# Glide knots in ppm. A knot sums to Fix.unit (1_000_000), which is the
# discrete convention for "weights sum to 1". The engine has two sleeves,
# growth and funding. Those names are roles, not an asset pick.
# Outside the knots the nearest knot is held. Between knots the weights
# move in a straight line. Integer division can drop a ppm when the two
# knots differ; the last sleeve is not used to patch that. The default
# knots are equal, so every year between them is exact.

type Knot is Data:
  Knot{year: U32, growth: U32, funding: U32}

def half() -> U32:
  500000

def knot_at(year: U32) -> Knot:
  Knot{year, half(), half()}

def knot_2027() -> Knot:
  knot_at(2027)

def knot_2033() -> Knot:
  knot_at(2033)

def growth_ppm(k: Knot) -> U32:
  match k:
    case Knot{_, g, _}:
      g

def funding_ppm(k: Knot) -> U32:
  match k:
    case Knot{_, _, f}:
      f

def knot_sum(k: Knot) -> U32:
  match k:
    case Knot{_, +g, +f}:
      (g + f : U32)

def lerp_arm(+a: U32, +b: U32, +t: U32, +span: U32, up: Bool) -> U32:
  match up:
    case True{}:
      (a + Fix.muldiv((b - a : U32), t, span) : U32)
    case False{}:
      Fix.sub_sat(a, Fix.muldiv((a - b : U32), t, span))

def lerp_go(+a: U32, +b: U32, +t: U32, +span: U32, bad: Bool, same: Bool, up: Bool) -> U32:
  match bad:
    case True{}:
      a
    case False{}:
      match same:
        case True{}:
          a
        case False{}:
          lerp_arm(a, b, t, span, up)

def lerp(+a: U32, +b: U32, +t: U32, +span: U32) -> U32:
  lerp_go(a, b, t, span, U32.is_zero(span), U32.is_eq(a, b), U32.is_ge(b, a))

def weights_between(
  +year: U32, +ly: U32, +lg: U32, +lf: U32, +ry: U32, +rg: U32, +rf: U32
) -> Knot:
  +span = (ry - ly : U32)
  +t = (year - ly : U32)
  Knot{year, lerp(lg, rg, t, span), lerp(lf, rf, t, span)}

def weights_after(year: U32, rg: U32, rf: U32, after: Bool, between: Knot) -> Knot:
  match after:
    case True{}:
      Knot{year, rg, rf}
    case False{}:
      between

def weights_at_go(
  +year: U32, +ly: U32, +lg: U32, +lf: U32, +ry: U32, +rg: U32, +rf: U32,
  before: Bool, after: Bool
) -> Knot:
  match before:
    case True{}:
      Knot{year, lg, lf}
    case False{}:
      weights_after(year, rg, rf, after, weights_between(year, ly, lg, lf, ry, rg, rf))

def weights_at(+year: U32, left: Knot, right: Knot) -> Knot:
  match left:
    case Knot{+ly, +lg, +lf}:
      match right:
        case Knot{+ry, +rg, +rf}:
          weights_at_go(year, ly, lg, lf, ry, rg, rf, U32.is_le(year, ly), U32.is_ge(year, ry))
