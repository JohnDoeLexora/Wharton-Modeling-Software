import Base

# Locked Laura Gao case facts. These are not modeling choices.
# Year N is 2026 + N. Year 0 is 2026, before any investment.
# Contributions land at the beginning of the year.
# Operating payments are ten nominal 50_000 dollars, 2033 through 2042.
# WInS trading profit and loss is not an input to a projection.

type Flow is Data:
  Flow{year: U32, dollars: U32}

type Pay is Data:
  Pay{year: U32, dollars: U32}

def present_year() -> U32:
  2026

def first_projection_year() -> U32:
  2027

def last_projection_year() -> U32:
  2042

def decision_year() -> U32:
  2033

def operating_payment() -> U32:
  50000

def operating_count() -> Nat:
  10n

def operating_first() -> U32:
  2033

def operating_last() -> U32:
  2042

def calendar(+index: Nat) -> U32:
  (2026 + U32.from_nat(index) : U32)

def contrib_year_go(is_2027: Bool, is_2028: Bool) -> U32:
  match is_2027:
    case True{}:
      300000
    case False{}:
      match is_2028:
        case True{}:
          150000
        case False{}:
          0

# External cash into the portfolio. Operating payments are not included.
def contrib_year(+year: U32) -> U32:
  contrib_year_go(U32.is_eq(year, 2027), U32.is_eq(year, 2028))

def contrib(+index: Nat) -> U32:
  contrib_year(calendar(index))

def flow_list(+left: Nat, +index: Nat) -> List<Flow>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      Flow{calendar(index), contrib(index)} <> flow_list(p, Nat.add(index, 1n))

def sum_contrib(+n: Nat) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      (sum_contrib(p) + contrib(p) : U32)

def operating_in_go(ge: Bool, le: Bool) -> U32:
  match ge:
    case False{}:
      0
    case True{}:
      match le:
        case False{}:
          0
        case True{}:
          operating_payment()

# Nominal dollars due at the beginning of `year`. Zero outside 2033..2042.
def operating_in_year(+year: U32) -> U32:
  operating_in_go(U32.is_ge(year, 2033), U32.is_le(year, 2042))

# Payment slot k = 0 is the beginning of 2033. Slot 9 is 2042.
def payment_at(+k: Nat) -> U32:
  operating_in_year(calendar(Nat.add(7n, k)))

def pay_list(+left: Nat, +k: Nat) -> List<Pay>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      Pay{calendar(Nat.add(7n, k)), payment_at(k)} <> pay_list(p, Nat.add(k, 1n))

def sum_pay(+n: Nat) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      (sum_pay(p) + payment_at(p) : U32)

# Sum of time indexes 0+1+...+(n-1). At n = 10 this is 45.
# At a 0% yield every operating payment has the same present value, so
# Macaulay duration is 45/10 = 4.5 years. The k = 0 payment has time weight 0.
def sum_time(+n: Nat) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      (sum_time(p) + U32.from_nat(p) : U32)

# Trading P&L is not added to a projection. The value is zero, not a forecast.
def wins_pnl() -> U32:
  0
