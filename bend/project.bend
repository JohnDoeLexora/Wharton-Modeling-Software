import Base
import ./fix.bend as Fix
import ./case.bend as Case
import ./glide.bend as Glide

# Beginning-of-year wealth from 2027 through 2042.
# Cash flows land at the start of the year. A return labeled for year Y
# moves that beginning wealth to the beginning of Y+1. No return is applied
# during 2042. The portfolio is not split into a reserve or a facility gift
# here. WInS profit and loss is not added.
#
# Annual rebalance resets both sleeves to that year's growth weight. The
# funding sleeve receives the remainder, so whole dollars are conserved.
# Drift leaves existing balances put and splits only the new contribution.
# The default glide is flat one-half / one-half. That is a starting point,
# not a policy. Returns and the fee are caller inputs. zero_returns is the
# zero-return, zero-fee path.

type Mode is Data:
  Annual{}
  Drift{}

type Bal is Data:
  Bal{growth: U32, funding: U32}

type Returns is Data:
  Returns{growth: Fix.Rate, funding: Fix.Rate, fee_ppm: U32}

type Row is Data:
  Row{year: U32, index: U32, contribution: U32, wealth: U32}

type Points is Data:
  Points{y2027: U32, y2028: U32, y2033: U32, y2042: U32}

type Path is Data:
  Path{rows: List<&2, Row>, y2027: U32, y2028: U32, y2033: U32, y2042: U32}

def zero_returns() -> Returns:
  Returns{Fix.zero_rate(), Fix.zero_rate(), 0}

def returns_of(growth: Fix.Rate, funding: Fix.Rate, fee_ppm: U32) -> Returns:
  Returns{growth, funding, fee_ppm}

def fee_of(r: Returns) -> U32:
  match r:
    case Returns{_, _, fee}:
      fee

def growth_of(r: Returns) -> Fix.Rate:
  match r:
    case Returns{g, _, _}:
      g

def funding_of(r: Returns) -> Fix.Rate:
  match r:
    case Returns{_, f, _}:
      f

def bal_sum(b: Bal) -> U32:
  match b:
    case Bal{+g, +f}:
      (g + f : U32)

def split_total(+total: U32, +ppm: U32) -> Bal:
  +g = Fix.muldiv(total, ppm, Fix.unit())
  Bal{g, (total - g : U32)}

def add_annual(bal: Bal, contrib: U32, +ppm: U32) -> Bal:
  match bal:
    case Bal{+g, +f}:
      split_total((g + f + contrib : U32), ppm)

def add_drift(bal: Bal, +contrib: U32, +ppm: U32) -> Bal:
  match bal:
    case Bal{g, f}:
      +cg = Fix.muldiv(contrib, ppm, Fix.unit())
      Bal{(g + cg : U32), (f + ((contrib - cg : U32)) : U32)}

def allocate(mode: Mode, bal: Bal, contrib: U32, ppm: U32) -> Bal:
  match mode:
    case Annual{}:
      add_annual(bal, contrib, ppm)
    case Drift{}:
      add_drift(bal, contrib, ppm)

def carry_bal(bal: Bal, rets: Returns) -> Bal:
  match bal:
    case Bal{g, f}:
      match rets:
        case Returns{rg, rf, +fee}:
          Bal{
            Fix.apply_fee(Fix.grow(g, rg), fee),
            Fix.apply_fee(Fix.grow(f, rf), fee)
          }

def carry_go(bal: Bal, rets: Returns, last: Bool) -> Bal:
  match last:
    case True{}:
      bal
    case False{}:
      carry_bal(bal, rets)

def carry(+year: Nat, bal: Bal, rets: Returns) -> Bal:
  carry_go(bal, rets, Nat.is_eq(year, 16n))

def note(+prev: U32, wealth: U32, hit: Bool) -> U32:
  match hit:
    case True{}:
      wealth
    case False{}:
      prev

def note_year(+prev: U32, wealth: U32, +year: Nat, +target: Nat) -> U32:
  note(prev, wealth, Nat.is_eq(year, target))

def empty_path(y2027: U32, y2028: U32, y2033: U32, y2042: U32) -> Path:
  Path{Nil{}, y2027, y2028, y2033, y2042}

def cons_path(row: Row, rest: Path) -> Path:
  match rest:
    case Path{rows, a, b, c, d}:
      Path{row <> rows, a, b, c, d}

def walk(
  +left: Nat, +year: Nat, bal: Bal, +mode: Mode, +rets: Returns,
  +lk: Glide.Knot, +rk: Glide.Knot,
  +y2027: U32, +y2028: U32, +y2033: U32, +y2042: U32
) -> Path:
  match left:
    case 0n:
      empty_path(y2027, y2028, y2033, y2042)
    case 1n+p:
      +c = Case.contrib(year)
      +ppm = Glide.growth_ppm(Glide.weights_at(Case.calendar(year), lk, rk))
      +bal1 = allocate(mode, bal, c, ppm)
      +wealth = bal_sum(bal1)
      +next = carry(year, bal1, rets)
      +a = note_year(y2027, wealth, year, 1n)
      +b = note_year(y2028, wealth, year, 2n)
      +c33 = note_year(y2033, wealth, year, 7n)
      +d = note_year(y2042, wealth, year, 16n)
      cons_path(
        Row{Case.calendar(year), U32.from_nat(year), c, wealth},
        walk(p, Nat.add(year, 1n), next, mode, rets, lk, rk, a, b, c33, d)
      )

def project(+mode: Mode, +rets: Returns) -> Path:
  walk(
    16n, 1n, Bal{0, 0}, mode, rets,
    Glide.knot_2027(), Glide.knot_2033(),
    0, 0, 0, 0
  )

def rows_of(p: Path) -> List<&2, Row>:
  match p:
    case Path{rows, _, _, _, _}:
      rows

def points(p: Path) -> Points:
  match p:
    case Path{_, a, b, c, d}:
      Points{a, b, c, d}

def y2027(p: Path) -> U32:
  match p:
    case Path{_, w, _, _, _}:
      w

def y2028(p: Path) -> U32:
  match p:
    case Path{_, _, w, _, _}:
      w

def y2033(p: Path) -> U32:
  match p:
    case Path{_, _, _, w, _}:
      w

def y2042(p: Path) -> U32:
  match p:
    case Path{_, _, _, _, w}:
      w

def show_row(r: Row) -> String:
  match r:
    case Row{+year, +index, +contribution, +wealth}:
      U32.show(year) ++ " " ++ U32.show(index) ++ " " ++ U32.show(contribution) ++ " " ++ U32.show(wealth)
