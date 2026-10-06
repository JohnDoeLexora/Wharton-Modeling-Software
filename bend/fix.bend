import Base

# Fixed-point money for the Gao engine.
#
# Dollars are whole U32 dollars. A rate or a weight is parts per 1_000_000
# (ppm). 1_000_000 ppm is 1. 500_000 ppm is one half. A negative rate is a
# Rate with neg set; the magnitude is still ppm.
#
# muldiv(a, b, d) is floor(a * b / d) for d in 1 .. 2^31-1. The remainder of
# the long division stays inside a U32 only in that range. Weights and yields
# in this engine use a divisor of 1_000_000, or 1_000_000 plus a small rate.
#
# Exploratory mu and sigma are caller inputs. Nothing here is a portfolio.

type U64 is Data:
  U64{lo: U32, hi: U32}

type Rate is Data:
  Rate{neg: Bool, ppm: U32}

def unit() -> U32:
  1000000

def zero_rate() -> Rate:
  Rate{False{}, 0}

def rate_ppm(r: Rate) -> U32:
  match r:
    case Rate{_, ppm}:
      ppm

def rate_is_neg(r: Rate) -> Bool:
  match r:
    case Rate{neg, _}:
      neg

def ppm_f32(ppm: U32) -> F32:
  F32.div(U32.to_f32(ppm), U32.to_f32(unit()))

def u64_lo(x: U64) -> U32:
  match x:
    case U64{lo, _}:
      lo

def u64_hi(x: U64) -> U32:
  match x:
    case U64{_, hi}:
      hi

def show_u64(x: U64) -> String:
  match x:
    case U64{lo, hi}:
      U32.show(hi) ++ ":" ++ U32.show(lo)

def lo16(a: U32) -> U32:
  (a .&. 65535 : U32)

def hi16(a: U32) -> U32:
  (a >> 16n : U32)

def mul_wide(+a: U32, +b: U32) -> U64:
  +a0 = lo16(a)
  +a1 = hi16(a)
  +b0 = lo16(b)
  +b1 = hi16(b)
  +p00 = (a0 * b0 : U32)
  +p01 = (a0 * b1 : U32)
  +p10 = (a1 * b0 : U32)
  +p11 = (a1 * b1 : U32)
  +col1 = (hi16(p00) + lo16(p01) + lo16(p10) : U32)
  +lo = (lo16(p00) + (lo16(col1) << 16n) : U32)
  +col2 = (hi16(p01) + hi16(p10) + lo16(p11) + hi16(col1) : U32)
  +hi = (lo16(col2) + ((hi16(p11) + hi16(col2) : U32) << 16n) : U32)
  U64{lo, hi}

def shl1_64(x: U64) -> U64:
  match x:
    case U64{+lo, +hi}:
      +c = Bool.to_u32(U32.is_ge(lo, 2147483648))
      U64{(lo << 1n : U32), ((hi << 1n) .|. c : U32)}

# Binary long division. phase False shifts in the next dividend bit.
# phase True subtracts the divisor when ge is true.
# 128 steps cover 64 bits. The quotient must fit in a U32, which it does
# when the dividend is a*b for U32 a, b and the divisor is at least 1.
def div_loop(
  +fuel: Nat, phase: Bool, +rem: U32, +quot: U32, +numer: U64, +d: U32, ge: Bool
) -> U32 & U32:
  match fuel:
    case 0n:
      (quot, rem)
    case 1n+p:
      match phase:
        case False{}:
          +bit = Bool.to_u32(U32.is_ge(u64_hi(numer), 2147483648))
          +numer2 = shl1_64(numer)
          +rem2 = ((rem << 1n) .|. bit : U32)
          +quot2 = (quot << 1n : U32)
          div_loop(p, True{}, rem2, quot2, numer2, d, U32.is_ge(rem2, d))
        case True{}:
          match ge:
            case True{}:
              div_loop(p, False{}, (rem - d : U32), (quot .|. 1 : U32), numer, d, False{})
            case False{}:
              div_loop(p, False{}, rem, quot, numer, d, False{})

def div64(n: U64, d: U32) -> U32:
  Pair.fst(U32, U32, div_loop(128n, False{}, 0, 0, n, d, False{}))

def muldiv_go(+a: U32, +b: U32, +d: U32, zero: Bool) -> U32:
  match zero:
    case True{}:
      0
    case False{}:
      div64(mul_wide(a, b), d)

def muldiv(+a: U32, +b: U32, +d: U32) -> U32:
  muldiv_go(a, b, d, U32.is_zero(d))

def sub_sat_go(+a: U32, +b: U32, ge: Bool) -> U32:
  match ge:
    case True{}:
      (a - b : U32)
    case False{}:
      0

def sub_sat(+a: U32, +b: U32) -> U32:
  sub_sat_go(a, b, U32.is_ge(a, b))

def xor64(a: U64, b: U64) -> U64:
  match a:
    case U64{+alo, +ahi}:
      match b:
        case U64{blo, bhi}:
          U64{(alo .^. blo : U32), (ahi .^. bhi : U32)}

def add64_go(+lo: U32, +hi: U32, carry: Bool) -> U64:
  match carry:
    case False{}:
      U64{lo, hi}
    case True{}:
      U64{lo, (hi + 1 : U32)}

def add64(a: U64, b: U64) -> U64:
  match a:
    case U64{+alo, +ahi}:
      match b:
        case U64{+blo, +bhi}:
          +sum = (alo + blo : U32)
          +hi = (ahi + bhi : U32)
          add64_go(sum, hi, U32.is_lt(sum, alo))

# n must be less than 32. SplitMix shifts are 11, 27, 30, and 31.
def shr64_go(+lo: U32, +hi: U32, +n: Nat) -> U64:
  +moved = U32.shln(hi, Nat.sub(32n, n))
  U64{((U32.shrn(lo, n)) .|. moved : U32), U32.shrn(hi, n)}

def shr64(+x: U64, +n: Nat) -> U64:
  match x:
    case U64{lo, hi}:
      shr64_go(lo, hi, n)

def mul64(a: U64, b: U64) -> U64:
  match a:
    case U64{+alo, +ahi}:
      match b:
        case U64{+blo, +bhi}:
          +p = mul_wide(alo, blo)
          +cross = ((u64_lo(mul_wide(alo, bhi)) + u64_lo(mul_wide(ahi, blo)) : U32) + u64_hi(p) : U32)
          U64{u64_lo(p), cross}

def grow_slow(+wealth: U32, +ppm: U32, neg: Bool) -> U32:
  match neg:
    case False{}:
      (wealth + muldiv(wealth, ppm, unit()) : U32)
    case True{}:
      sub_sat(wealth, muldiv(wealth, ppm, unit()))

def grow_go(+wealth: U32, +ppm: U32, neg: Bool, zero: Bool) -> U32:
  match zero:
    case True{}:
      wealth
    case False{}:
      grow_slow(wealth, ppm, neg)

# Simple return. A zero magnitude leaves wealth unchanged, either sign.
def grow(+wealth: U32, rate: Rate) -> U32:
  match rate:
    case Rate{neg, +ppm}:
      grow_go(wealth, ppm, neg, U32.is_zero(ppm))

def apply_fee_go(+wealth: U32, +fee_ppm: U32, zero: Bool) -> U32:
  match zero:
    case True{}:
      wealth
    case False{}:
      sub_sat(wealth, muldiv(wealth, fee_ppm, unit()))

# Fee is a haircut on wealth after the year's return. Zero is identity.
def apply_fee(+wealth: U32, +fee_ppm: U32) -> U32:
  apply_fee_go(wealth, fee_ppm, U32.is_zero(fee_ppm))

# Discount one period: future / (1 + rate). At a zero rate this is future.
# A rate at or below -100% cannot prefund a later payment. The stand-in is
# the maximum U32, which is this engine's finite "no finite reserve" flag.
def discount_neg_go(+future: U32, +ppm: U32, ok: Bool) -> U32:
  match ok:
    case True{}:
      muldiv(future, unit(), (unit() - ppm : U32))
    case False{}:
      4294967295

def discount_go(+future: U32, +ppm: U32, zero: Bool, neg: Bool) -> U32:
  match zero:
    case True{}:
      future
    case False{}:
      match neg:
        case False{}:
          muldiv(future, unit(), (unit() + ppm : U32))
        case True{}:
          discount_neg_go(future, ppm, U32.is_lt(ppm, unit()))

def discount(+future: U32, rate: Rate) -> U32:
  match rate:
    case Rate{neg, +ppm}:
      discount_go(future, ppm, U32.is_zero(ppm), neg)
