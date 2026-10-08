import Base
import ./fix.bend as Fix

# One-factor single-name return, in parts per million.
# r = α + β r_m + sectorBeta × sector + an expected jump,
# then a USD factor (1+r)(1+fx)−1, then an expense-ratio drag.
# The jump term here is the scenario expectation, probability times loss.
# A Monte Carlo path replaces that expectation with a stream-6 draw:
# a Student-t residual, a jump uniform, an FX normal, and a geopolitical
# uniform. Those draws are caller inputs. This file does not pick a name.

def jump_ppm(+prob_ppm: U32, +loss_ppm: U32) -> U32:
  Fix.muldiv(prob_ppm, loss_ppm, Fix.unit())

def gross_ppm(
  +alpha: U32, +beta_ppm: U32, +market_ppm: U32, +sector_beta_ppm: U32, +sector_ppm: U32, +jump: U32
) -> U32:
  +mkt = Fix.muldiv(beta_ppm, market_ppm, Fix.unit())
  +sec = Fix.muldiv(sector_beta_ppm, sector_ppm, Fix.unit())
  Fix.sub_sat((alpha + mkt + sec : U32), jump)

def with_fx(+gross: U32, +fx_ppm: U32) -> U32:
  (gross + fx_ppm + Fix.muldiv(gross, fx_ppm, Fix.unit()) : U32)

def after_fee(+gross: U32, +expense_ppm: U32) -> U32:
  Fix.sub_sat(gross, (expense_ppm + Fix.muldiv(gross, expense_ppm, Fix.unit()) : U32))

def name_return(
  +alpha: U32, +beta_ppm: U32, +market_ppm: U32,
  +sector_beta_ppm: U32, +sector_ppm: U32,
  +jump_prob_ppm: U32, +jump_loss_ppm: U32,
  +fx_ppm: U32, +expense_ppm: U32
) -> U32:
  after_fee(
    with_fx(
      gross_ppm(alpha, beta_ppm, market_ppm, sector_beta_ppm, sector_ppm, jump_ppm(jump_prob_ppm, jump_loss_ppm)),
      fx_ppm
    ),
    expense_ppm
  )

# α 1%, β 1, market 5%, sector beta 0.5, sector shock 2%, no jump, no FX, no fee.
def golden_plain() -> U32:
  name_return(10000, 1000000, 50000, 500000, 20000, 0, 0, 0, 0)

# Same factor, plus a 20% chance of a 10% jump loss.
def golden_jump() -> U32:
  name_return(10000, 1000000, 50000, 0, 0, 200000, 100000, 0, 0)

# Gross 5% from the market, then +1% FX and a 1% expense ratio.
def golden_fx_fee() -> U32:
  name_return(0, 1000000, 50000, 0, 0, 0, 0, 10000, 10000)
