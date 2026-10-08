import Base
import ./fix.bend as Fix
import ./facility.bend as Fac

# 2031 communication range. The low and the high are facility gifts at two
# caller-supplied wealth figures, under one rule, after the same reserve.
# A gift is zero when wealth is below the reserve, and it never exceeds
# the surplus. The band is not a promise to co-sponsors.

type Band is Data:
  Band{low: U32, high: U32}

def low_of(b: Band) -> U32:
  match b:
    case Band{low, _}:
      low

def high_of(b: Band) -> U32:
  match b:
    case Band{_, high}:
      high

def band_retain(+lo_wealth: U32, +hi_wealth: U32, +reserve: U32, +keep_ppm: U32) -> Band:
  Band{
    Fac.contribution_of(Fac.apply_rule(lo_wealth, reserve, Fac.Retain{keep_ppm})),
    Fac.contribution_of(Fac.apply_rule(hi_wealth, reserve, Fac.Retain{keep_ppm}))
  }

def band_cap(+lo_wealth: U32, +hi_wealth: U32, +reserve: U32, +cap: U32) -> Band:
  Band{
    Fac.contribution_of(Fac.apply_rule(lo_wealth, reserve, Fac.Cap{cap})),
    Fac.contribution_of(Fac.apply_rule(hi_wealth, reserve, Fac.Cap{cap}))
  }

# Give the whole surplus (keep none). Wealth 600_000 and 900_000,
# reserve 500_000. Gifts are 100_000 and 400_000.
def golden_band() -> Band:
  band_retain(600000, 900000, 500000, 0)

def golden_low() -> U32:
  low_of(golden_band())

def golden_high() -> U32:
  high_of(golden_band())

def ordered(+lo: U32, +hi: U32) -> Bool:
  U32.is_le(lo, hi)
