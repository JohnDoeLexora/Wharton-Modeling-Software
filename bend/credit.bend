import Base
import ./fix.bend as Fix
import ./bond.bend as Bond

# Credit spread, default, and recovery, in parts per million.
# Yield = treasury + spread. A default draws a uniform on stream 5.
# If the draw is below the annual default probability, the loss is
# 1 − recovery. Otherwise the loss is zero. The expected loss is
# probability times loss-given-default, which is what a scenario path uses.
# Spread widening is spreadBeta times the positive part of an equity drop.
# Issuer debt is credit risk. It is not a Treasury bill.

def lgd_ppm(+recovery_ppm: U32) -> U32:
  Fix.sub_sat(Fix.unit(), recovery_ppm)

def expected_loss_ppm(+pd_ppm: U32, +recovery_ppm: U32) -> U32:
  Fix.muldiv(pd_ppm, lgd_ppm(recovery_ppm), Fix.unit())

def loss_go(+recovery_ppm: U32, hit: Bool) -> U32:
  match hit:
    case True{}:
      lgd_ppm(recovery_ppm)
    case False{}:
      0

def loss_if(+draw_ppm: U32, +pd_ppm: U32, +recovery_ppm: U32) -> U32:
  loss_go(recovery_ppm, U32.is_lt(draw_ppm, pd_ppm))

def widen_ppm(+spread_ppm: U32, +beta_ppm: U32, +equity_drop_ppm: U32) -> U32:
  (spread_ppm + Fix.muldiv(beta_ppm, equity_drop_ppm, Fix.unit()) : U32)

def credit_mtm(
  +treasury_ppm: U32, +spread_ppm: U32, +duration_milli: U32, +convexity_milli: U32, +dy_ppm: U32, +loss_ppm: U32
) -> U32:
  Fix.sub_sat(
    Bond.mtm_ppm((treasury_ppm + spread_ppm : U32), duration_milli, convexity_milli, dy_ppm),
    loss_ppm
  )

# Scenario illustration: 3% treasury, 1.2% spread, no yield change,
# 1% default probability, 40% recovery. Expected loss is 60 bp.
def golden_expected_loss() -> U32:
  expected_loss_ppm(10000, 400000)

def golden_loss_hit() -> U32:
  loss_if(5000, 10000, 400000)

def golden_loss_miss() -> U32:
  loss_if(50000, 10000, 400000)

def golden_mtm() -> U32:
  credit_mtm(30000, 12000, 6000, 40000, 0, golden_expected_loss())

def golden_widened_spread() -> U32:
  widen_ppm(12000, 800000, 100000)
