import Base
import ./fix.bend as Fix
import ./rng.bend as Rng

# Exploratory return map. mu and sigma are caller inputs, in ppm.
# A simple return of 0.07 is 70_000 ppm. This file does not supply a
# capital-market assumption. The scenario path in project.bend does not
# read these functions. It reads the Rate values the caller passes.
#
# Lognormal is calibrated so the F32 map follows the same formula as the
# TypeScript engine: E[1+r] = 1+mu and Var(1+r) = sigma^2, with the
# correlation applied to the normal shocks first. F32 is not the f64 path.

def signed_f32(neg: Bool, ppm: U32) -> F32:
  match neg:
    case False{}:
      Fix.ppm_f32(ppm)
    case True{}:
      F32.neg(Fix.ppm_f32(ppm))

def floor_f32(neg: Bool, ppm: U32) -> F32:
  signed_f32(neg, ppm)

# r = max(floor, mu + sigma * z). mu and sigma are non-negative ppm.
# The floor carries its own sign. The TypeScript default floor is -0.999,
# which the caller would pass as neg = True and ppm = 999_000.
def normal_simple(+mu_ppm: U32, +sigma_ppm: U32, +z: F32, floor_neg: Bool, +floor_ppm: U32) -> F32:
  +linear = F32.add(Fix.ppm_f32(mu_ppm), F32.mul(Fix.ppm_f32(sigma_ppm), z))
  F32.max(floor_f32(floor_neg, floor_ppm), linear)

def log_ok_go(+mu: F32, +vol: F32, +z: F32, broken: Bool) -> F32:
  match broken:
    case True{}:
      F32.neg(1.0)
    case False{}:
      +mean_rel = F32.add(1.0, mu)
      +s2 = F32.log(F32.add(1.0, F32.div(F32.mul(vol, vol), F32.mul(mean_rel, mean_rel))))
      +m = F32.sub(F32.log(mean_rel), F32.div(s2, 2.0))
      +s = F32.sqrt(s2)
      F32.sub(F32.exp(F32.add(m, F32.mul(s, z))), 1.0)

# A negative mu at or below -100% returns -1, matching the TypeScript guard.
def lognormal_simple(+mu_neg: Bool, +mu_ppm: U32, +sigma_ppm: U32, +z: F32) -> F32:
  +mu = signed_f32(mu_neg, mu_ppm)
  log_ok_go(mu, Fix.ppm_f32(sigma_ppm), z, Bool.and(mu_neg, U32.is_ge(mu_ppm, Fix.unit())))

def box_muller(u: F32, v: F32) -> F32 & F32:
  +mag = F32.sqrt(F32.mul(F32.neg(2.0), F32.log(u)))
  +ang = F32.mul(F32.mul(2.0, F32.pi()), v)
  (F32.mul(mag, F32.cos(ang)), F32.mul(mag, F32.sin(ang)))

def normal_pick(pair: F32 & F32, even: Bool) -> F32:
  match even:
    case True{}:
      Pair.fst(F32, F32, pair)
    case False{}:
      Pair.snd(F32, F32, pair)

# Standard normal at dimension `dim` from the counter stream.
# Dimensions 2k and 2k+1 are one Box-Muller pair. The spare is not kept.
def standard_normal(
  +seed: U32, +stream: U32, +trial: U32, +step: U32, +dim: U32
) -> F32:
  +even = (dim .&. 4294967294 : U32)
  normal_pick(
    box_muller(
      Rng.uniform_f32(Rng.draw(seed, stream, trial, step, even)),
      Rng.uniform_f32(Rng.draw(seed, stream, trial, step, (even + 1 : U32)))
    ),
    U32.is_zero((dim .&. 1 : U32))
  )
