import Base
import ./fix.bend as Fix

# 2x2 correlation. The diagonal is Fix.unit (1) by construction and is not
# stored. One off-diagonal is stored, so the matrix is symmetric.
# Magnitude is ppm. 0 is uncorrelated. The clip is 999_000 ppm, which is 0.999.
# Stress is a caller-supplied shift of that off-diagonal. It is not a view
# about what the correlation should be.

type Corr is Data:
  Corr{neg: Bool, off_ppm: U32}

def diag_ppm() -> U32:
  Fix.unit()

def identity_corr() -> Corr:
  Corr{False{}, 0}

def off_ppm(c: Corr) -> U32:
  match c:
    case Corr{_, off}:
      off

def off_neg(c: Corr) -> Bool:
  match c:
    case Corr{neg, _}:
      neg

# Both triangles read the same field.
def off_01(c: Corr) -> U32:
  off_ppm(c)

def off_10(c: Corr) -> U32:
  off_ppm(c)

def clip_off(ppm: U32) -> U32:
  U32.min(ppm, 999000)

def add_same(an: Bool, +am: U32, +bm: U32) -> Corr:
  Corr{an, clip_off((am + bm : U32))}

def add_diff(+an: Bool, +am: U32, bn: Bool, +bm: U32, am_ge: Bool) -> Corr:
  match am_ge:
    case True{}:
      Corr{an, clip_off((am - bm : U32))}
    case False{}:
      Corr{bn, clip_off((bm - am : U32))}

def add_corr_go(an: Bool, +am: U32, bn: Bool, +bm: U32, differ: Bool) -> Corr:
  match differ:
    case False{}:
      add_same(an, am, bm)
    case True{}:
      add_diff(an, am, bn, bm, U32.is_ge(am, bm))

def add_corr(a: Corr, b: Corr) -> Corr:
  match a:
    case Corr{+an, +am}:
      match b:
        case Corr{+bn, +bm}:
          add_corr_go(an, am, bn, bm, Bool.xor(an, bn))

def stress_corr(c: Corr, stress: Fix.Rate) -> Corr:
  match stress:
    case Fix.Rate{neg, ppm}:
      add_corr(c, Corr{neg, ppm})

def rho_sign(mag: F32, neg: Bool) -> F32:
  match neg:
    case False{}:
      mag
    case True{}:
      F32.neg(mag)

def rho_f32(c: Corr) -> F32:
  match c:
    case Corr{neg, off}:
      rho_sign(Fix.ppm_f32(off), neg)

# Gaussian copula for two standard normals. Identity leaves both shocks put.
# z0 is shared by both results, so the caller passes a reusable F32.
def copula(+z0: F32, z1: F32, c: Corr) -> F32 & F32:
  +rho = rho_f32(c)
  +mix = F32.sqrt(F32.sub(1.0, F32.mul(rho, rho)))
  (z0, F32.add(F32.mul(rho, z0), F32.mul(mix, z1)))
