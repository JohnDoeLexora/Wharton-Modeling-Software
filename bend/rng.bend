import Base
import ./fix.bend as Fix

# Counter-based SplitMix64. One draw is a pure function of
# (master seed, stream id, trial, step, dimension).
# Call order does not matter. Trial 0 does not change when the trial count changes.
#
# The 64-bit word matches the TypeScript generator in src/core/rng.ts.
# Stream 1, portfolio: step is the calendar year of the return, dimension is the sleeve.
# Stream 2, reserve: step is the interval after operating payment k (0..8), dimension 0.
# Stream 3, bootstrap: step is the block index, dimension 0.
# The 2031-2033 conditional band is not a fourth stream. It reuses stream 1
# at calendar years 2031 and 2032.
#
# F32 uniforms use the top 24 bits of that word. The TypeScript uniform uses
# 53 bits in a 64-bit float. Quote the raw word when a run has to match
# the TypeScript engine bit for bit. F32 is the exploratory shock map.

type Stream is Data:
  Portfolio{}
  Reserve{}
  Bootstrap{}

def stream_id(s: Stream) -> U32:
  match s:
    case Portfolio{}:
      1
    case Reserve{}:
      2
    case Bootstrap{}:
      3

def conditional_stream() -> U32:
  stream_id(Portfolio{})

def conditional_year_a() -> U32:
  2031

def conditional_year_b() -> U32:
  2032

# 0x9e3779b97f4a7c15
def golden() -> Fix.U64:
  Fix.U64{2135587861, 2654435769}

# 0xbf58476d1ce4e5b9
def mul_a() -> Fix.U64:
  Fix.U64{484763065, 3210233709}

# 0x94d049bb133111eb
def mul_b() -> Fix.U64:
  Fix.U64{321982955, 2496678331}

def splitmix(+z: Fix.U64) -> Fix.U64:
  +z1 = Fix.add64(z, golden())
  +z2 = Fix.mul64(Fix.xor64(z1, Fix.shr64(z1, 30n)), mul_a())
  +z3 = Fix.mul64(Fix.xor64(z2, Fix.shr64(z2, 27n)), mul_b())
  Fix.xor64(z3, Fix.shr64(z3, 31n))

def mix(+z: Fix.U64, part: U32) -> Fix.U64:
  splitmix(Fix.xor64(z, Fix.U64{part, 0}))

def draw(+seed: U32, +stream: U32, +trial: U32, +step: U32, +dim: U32) -> Fix.U64:
  +z1 = mix(golden(), seed)
  +z2 = mix(z1, stream)
  +z3 = mix(z2, trial)
  +z4 = mix(z3, step)
  mix(z4, dim)

def draw_stream(
  +seed: U32, stream: Stream, +trial: U32, +step: U32, +dim: U32
) -> Fix.U64:
  draw(seed, stream_id(stream), trial, step, dim)

# Top 24 bits of the SplitMix word. (word >> 40) fits in those bits of `hi >> 8`.
def top24(z: Fix.U64) -> U32:
  match z:
    case Fix.U64{_, hi}:
      (hi >> 8n : U32)

# Uniform on (0, 1) in F32, from the top 24 bits, plus half an ulp, over 2^24.
def uniform_f32(z: Fix.U64) -> F32:
  F32.div(F32.add(U32.to_f32(top24(z)), 0.5), 16777216.0)
