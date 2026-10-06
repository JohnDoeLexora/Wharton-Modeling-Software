import Base
import ./fix.bend as Fix

# Facility dollars come only from wealth left after the operating reserve.
# If wealth is below the reserve, the contribution is zero and the gap is
# the unpaid part of the reserve. The three rules are arithmetic the caller
# can apply. None of them is a recommended gift.

type Rule is Data:
  Retain{keep_ppm: U32}
  Keep{dollars: U32}
  Cap{dollars: U32}

type Split is Data:
  Split{
    funded: U32,
    gap: U32,
    residual: U32,
    contribution: U32,
    flexibility: U32
  }

def funded_of(s: Split) -> U32:
  match s:
    case Split{funded, _, _, _, _}:
      funded

def gap_of(s: Split) -> U32:
  match s:
    case Split{_, gap, _, _, _}:
      gap

def residual_of(s: Split) -> U32:
  match s:
    case Split{_, _, residual, _, _}:
      residual

def contribution_of(s: Split) -> U32:
  match s:
    case Split{_, _, _, contribution, _}:
      contribution

def flexibility_of(s: Split) -> U32:
  match s:
    case Split{_, _, _, _, flexibility}:
      flexibility

def funded_plus_gap(s: Split) -> U32:
  match s:
    case Split{+funded, +gap, _, _, _}:
      (funded + gap : U32)

def funded_plus_residual(s: Split) -> U32:
  match s:
    case Split{+funded, _, +residual, _, _}:
      (funded + residual : U32)

def contribution_plus_flexibility(s: Split) -> U32:
  match s:
    case Split{_, _, _, +contribution, +flexibility}:
      (contribution + flexibility : U32)

def gift_retain_go(+residual: U32, +keep_ppm: U32, ok: Bool) -> U32:
  match ok:
    case True{}:
      Fix.muldiv(residual, (Fix.unit() - keep_ppm : U32), Fix.unit())
    case False{}:
      0

def gift_retain(+residual: U32, +keep_ppm: U32) -> U32:
  gift_retain_go(residual, keep_ppm, U32.is_le(keep_ppm, Fix.unit()))

def finish(+funded: U32, +gap: U32, +residual: U32, +contribution: U32) -> Split:
  Split{funded, gap, residual, contribution, Fix.sub_sat(residual, contribution)}

def apply_go(+funded: U32, +gap: U32, +residual: U32, rule: Rule) -> Split:
  match rule:
    case Retain{keep_ppm}:
      finish(funded, gap, residual, gift_retain(residual, keep_ppm))
    case Keep{dollars}:
      finish(funded, gap, residual, Fix.sub_sat(residual, dollars))
    case Cap{dollars}:
      finish(funded, gap, residual, U32.min(residual, dollars))

def apply_rule(+wealth: U32, +reserve: U32, rule: Rule) -> Split:
  apply_go(U32.min(wealth, reserve), Fix.sub_sat(reserve, wealth), Fix.sub_sat(wealth, reserve), rule)
