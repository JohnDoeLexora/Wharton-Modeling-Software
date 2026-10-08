import Base
import ./fix.bend as Fix
import ./case.bend as Case
import ./reserve.bend as Res

# Four reserve sizes at the beginning of 2033.
# pv_curve and duration_matched discount the ten payments on a yield.
# At a zero curve both equal the nominal sum, 500_000.
# nominal is always 10 × 50_000, whatever the curve says.
# The bill ladder is the same backward induction at the short yield.
# At a zero short yield it is also 500_000. A positive yield makes the
# discounted ladders smaller than the nominal sum. None of these is a
# chosen policy. The caller picks the method.

type Method is Data:
  PvCurve{}
  Nominal{}
  Bill{}
  DurationMatched{}

def nominal() -> U32:
  Case.sum_pay(10n)

def pv_at(rate: Fix.Rate) -> U32:
  Res.ladder_at(rate)

def bill_at(rate: Fix.Rate) -> U32:
  Res.ladder_at(rate)

def duration_matched_at(rate: Fix.Rate) -> U32:
  pv_at(rate)

def size_at_zero(method: Method) -> U32:
  match method:
    case PvCurve{}:
      pv_at(Fix.zero_rate())
    case Nominal{}:
      nominal()
    case Bill{}:
      bill_at(Fix.zero_rate())
    case DurationMatched{}:
      duration_matched_at(Fix.zero_rate())

def pv_zero() -> U32:
  size_at_zero(PvCurve{})

def nominal_zero() -> U32:
  size_at_zero(Nominal{})

def bill_zero() -> U32:
  size_at_zero(Bill{})

def duration_zero() -> U32:
  size_at_zero(DurationMatched{})

# Flat 1% yield. The ladder is the discounted annuity-due, which is below par.
def pv_at_one_percent() -> U32:
  pv_at(Fix.Rate{False{}, 10000})
