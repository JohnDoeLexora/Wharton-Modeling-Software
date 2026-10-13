import Base
import ./fix.bend as Fix

# Integer checks for the daily risk estimators.
# Parts per million: 1_000_000 is 1. These are arithmetic identities.
# They are not a forecast and not a portfolio.

def ewma_step(+lambda_ppm: U32, +variance: U32, +squared: U32) -> U32:
  (Fix.muldiv(lambda_ppm, variance, Fix.unit()) + Fix.muldiv((Fix.unit() - lambda_ppm : U32), squared, Fix.unit()) : U32)

# RiskMetrics step λ = 0.94, variance 1, squared return 0.25.
def golden_ewma() -> U32:
  ewma_step(940000, 1000000, 250000)

def vasicek_beta(+raw: U32, +prior: U32, +prior_var: U32, +se2: U32) -> U32:
  (Fix.muldiv(raw, prior_var, (prior_var + se2 : U32)) + Fix.muldiv(prior, se2, (prior_var + se2 : U32)) : U32)

# Raw 0.07, prior 1, prior variance 0.04, se² 0.06.
def golden_vasicek() -> U32:
  vasicek_beta(70000, 1000000, 40000, 60000)

def jump_variance(+diffusion: U32, +intensity: U32, +mean_square: U32) -> U32:
  (diffusion + (intensity * mean_square : U32) : U32)

def golden_jump() -> U32:
  jump_variance(8000, 4, 2500)

def keep_weight() -> U32:
  750000

def shrink_weight() -> U32:
  250000

def shrunk_diag(+sample: U32) -> U32:
  (Fix.muldiv(keep_weight(), sample, Fix.unit()) + Fix.muldiv(shrink_weight(), 90, Fix.unit()) : U32)

def shrunk_s11() -> U32:
  shrunk_diag(100)

def shrunk_s22() -> U32:
  shrunk_diag(80)

def shrunk_s12() -> U32:
  Fix.muldiv(keep_weight(), 20, Fix.unit())

def golden_det() -> U32:
  ((shrunk_s11() * shrunk_s22() : U32) - (shrunk_s12() * shrunk_s12() : U32) : U32)

def ewma_positive() -> Bool:
  U32.is_lt(0, golden_ewma())

def vasicek_between() -> Bool:
  Bool.and(U32.is_le(70000, golden_vasicek()), U32.is_le(golden_vasicek(), 1000000))

def jump_covers_diffusion() -> Bool:
  U32.is_le(8000, golden_jump())

def cov_psd() -> Bool:
  Bool.and(U32.is_lt(0, shrunk_s11()), U32.is_lt(0, golden_det()))
