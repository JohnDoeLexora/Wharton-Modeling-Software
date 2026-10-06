import Base
import ./fix.bend as Fix
import ./case.bend as Case
import ./glide.bend as Glide
import ./project.bend as Proj
import ./reserve.bend as Res
import ./facility.bend as Fac
import ./rng.bend as Rng
import ./corr.bend as Corr

# Deterministic case table. Returns, fees, and the glide are inputs.
# This run uses the zero-return, zero-fee path and the flat half / half
# knots. Those knots are a starting point, not a policy. The ladder is
# the 0-yield reserve. Nothing printed here is a recommendation.

def print_rows(rows: List<&2, Proj.Row>) -> IO(Unit):
  match rows:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      IO.bind(Unit, Unit, IO.print(Proj.show_row(h)), u => print_rows(t))

def show_points(label: String, p: Proj.Points) -> String:
  match p:
    case Proj.Points{+a, +b, +c, +d}:
      label ++ " 2027 " ++ U32.show(a) ++ " 2028 " ++ U32.show(b)
        ++ " 2033 " ++ U32.show(c) ++ " 2042 " ++ U32.show(d)

def show_split(s: Fac.Split) -> String:
  match s:
    case Fac.Split{+funded, +gap, +residual, +contribution, +flexibility}:
      "funded " ++ U32.show(funded)
        ++ " gap " ++ U32.show(gap)
        ++ " residual " ++ U32.show(residual)
        ++ " contribution " ++ U32.show(contribution)
        ++ " flexibility " ++ U32.show(flexibility)

def main() -> IO(Unit):
  +annual = Proj.project(Proj.Annual{}, Proj.zero_returns())
  +drift = Proj.project(Proj.Drift{}, Proj.zero_returns())
  +ladder = Res.ladder_at(Fix.zero_rate())
  +boy = Proj.y2033(annual)
  +word = Rng.draw(42, Rng.stream_id(Rng.Portfolio{}), 0, 2027, 0)
  do IO<Unit>:
    IO.print("Gao Bend engine")
    IO.print("Exploratory case arithmetic. Not an investment recommendation.")
    IO.print("weight_unit_ppm " ++ U32.show(Fix.unit()))
    IO.print("wins_pnl " ++ U32.show(Case.wins_pnl()))
    IO.print("year index contribution boy_wealth")
    u : Unit <- print_rows(Proj.rows_of(annual))
    IO.print(show_points("annual_zero", Proj.points(annual)))
    IO.print(show_points("drift_zero", Proj.points(drift)))
    IO.print("boy_2033_annual " ++ U32.show(boy))
    IO.print("boy_2033_drift " ++ U32.show(Proj.y2033(drift)))
    IO.print("ladder_yield_0 " ++ U32.show(ladder))
    IO.print("roll_end_yield_0 " ++ U32.show(Res.roll(10n, ladder, Fix.zero_rate())))
    IO.print("facility_zero_path " ++ show_split(Fac.apply_rule(boy, ladder, Fac.Retain{Fix.unit()})))
    IO.print("glide_2027_ppm " ++ U32.show(Glide.knot_sum(Glide.knot_2027())))
    IO.print("glide_2030_ppm " ++ U32.show(Glide.knot_sum(Glide.weights_at(2030, Glide.knot_2027(), Glide.knot_2033()))))
    IO.print("glide_2033_ppm " ++ U32.show(Glide.knot_sum(Glide.knot_2033())))
    IO.print("corr_diag_ppm " ++ U32.show(Corr.diag_ppm()))
    IO.print("corr_off_ppm " ++ U32.show(Corr.off_ppm(Corr.identity_corr())))
    IO.print("stream_portfolio " ++ U32.show(Rng.stream_id(Rng.Portfolio{})))
    IO.print("stream_reserve " ++ U32.show(Rng.stream_id(Rng.Reserve{})))
    IO.print("stream_bootstrap " ++ U32.show(Rng.stream_id(Rng.Bootstrap{})))
    IO.print("conditional_stream " ++ U32.show(Rng.conditional_stream()))
    IO.print("draw_seed 42")
    IO.print("draw_stream 1")
    IO.print("draw_trial 0")
    IO.print("draw_step 2027")
    IO.print("draw_dim 0")
    IO.print("draw_hi " ++ U32.show(Fix.u64_hi(word)))
    IO.print("draw_lo " ++ U32.show(Fix.u64_lo(word)))
