import Base
import ./fix.bend as Fix
import ./case.bend as Case
import ./glide.bend as Glide
import ./project.bend as Proj
import ./reserve.bend as Res
import ./facility.bend as Fac
import ./rng.bend as Rng
import ./bond.bend as Bond
import ./corr.bend as Corr
import ./rates.bend as Rates
import ./credit.bend as Credit
import ./names.bend as Names
import ./curve.bend as Curve
import ./htm.bend as Htm
import ./range.bend as Range
import ./trades.bend as Trades
import ./ns.bend as Ns
import ./instruments.bend as Inst
import ./fan.bend as Fan

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
    IO.print("cash_2027 " ++ U32.show(Case.contrib_year(2027)))
    IO.print("cash_2028 " ++ U32.show(Case.contrib_year(2028)))
    IO.print("cash_sum " ++ U32.show(Case.sum_contrib(3n)))
    IO.print("pay_sum " ++ U32.show(Case.sum_pay(10n)))
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
    IO.print("stream_rates " ++ U32.show(Rng.stream_id(Rng.Rates{})))
    IO.print("stream_credit " ++ U32.show(Rng.stream_id(Rng.Credit{})))
    IO.print("stream_idio " ++ U32.show(Rng.stream_id(Rng.Idio{})))
    IO.print("conditional_stream " ++ U32.show(Rng.conditional_stream()))
    IO.print("bond_zero_dy " ++ U32.show(Bond.mtm_ppm(50000, 16000, 300000, 0)))
    IO.print("draw_seed 42")
    IO.print("draw_stream 1")
    IO.print("draw_trial 0")
    IO.print("draw_step 2027")
    IO.print("draw_dim 0")
    IO.print("draw_hi " ++ U32.show(Fix.u64_hi(word)))
    IO.print("draw_lo " ++ U32.show(Fix.u64_lo(word)))
    IO.print("rising_short_2033 " ++ U32.show(Rates.rising_short_2033()))
    IO.print("flat_short_2033 " ++ U32.show(Rates.flat_short_2033()))
    IO.print("falling_short_2030 " ++ U32.show(Rates.falling_short_2030()))
    IO.print("shock_short_2028 " ++ U32.show(Rates.shock_short_2028()))
    IO.print("stagflation_short_2029 " ++ U32.show(Rates.stagflation_short_2029()))
    IO.print("revert_one_step " ++ U32.show(Rates.revert_one_step()))
    IO.print("vol_step " ++ U32.show(Rates.vol_step(0, 10000, 1000000)))
    IO.print("curve_intermediate_2033 " ++ U32.show(Rates.curve_intermediate(Rates.curve_of(Rates.rising_short_2033(), 5000, 15000, 0))))
    IO.print("curve_long_2033 " ++ U32.show(Rates.curve_long(Rates.curve_of(Rates.rising_short_2033(), 5000, 15000, 0))))
    IO.print("credit_expected_loss " ++ U32.show(Credit.golden_expected_loss()))
    IO.print("credit_loss_hit " ++ U32.show(Credit.golden_loss_hit()))
    IO.print("credit_loss_miss " ++ U32.show(Credit.golden_loss_miss()))
    IO.print("credit_mtm " ++ U32.show(Credit.golden_mtm()))
    IO.print("credit_widened " ++ U32.show(Credit.golden_widened_spread()))
    IO.print("name_plain " ++ U32.show(Names.golden_plain()))
    IO.print("name_jump " ++ U32.show(Names.golden_jump()))
    IO.print("name_fx_fee " ++ U32.show(Names.golden_fx_fee()))
    IO.print("reserve_pv0 " ++ U32.show(Curve.pv_zero()))
    IO.print("reserve_nominal " ++ U32.show(Curve.nominal_zero()))
    IO.print("reserve_bill0 " ++ U32.show(Curve.bill_zero()))
    IO.print("reserve_dur0 " ++ U32.show(Curve.duration_zero()))
    IO.print("reserve_pv_1pct " ++ U32.show(Curve.pv_at_one_percent()))
    IO.print("htm_marked " ++ U32.show(Htm.terminal_golden(10000, 20000, 30000)))
    IO.print("htm_unmarked " ++ U32.show(Htm.terminal_golden(0, 0, 0)))
    IO.print("htm_wealth " ++ U32.show(Htm.wealth_htm(100000, 50000, 10000)))
    IO.print("mtm_wealth_zero_dy " ++ U32.show(Bond.wealth_after(100000, 50000, 16000, 300000, 0)))
    IO.print("mtm_dy_lo " ++ U32.show(Bond.mtm_ppm(400000, 5000, 0, 10000)))
    IO.print("mtm_dy_hi " ++ U32.show(Bond.mtm_ppm(400000, 5000, 0, 20000)))
    IO.print("range_low " ++ U32.show(Range.golden_low()))
    IO.print("range_high " ++ U32.show(Range.golden_high()))
    IO.print("trade_spent " ++ U32.show(Trades.spent_of(Trades.golden_shares())))
    IO.print("trade_left " ++ U32.show(Trades.left_of(Trades.golden_shares())))
    IO.print("trade_qty " ++ U32.show(Trades.qty_of(Trades.golden_shares())))
    IO.print("trade_two_spent " ++ U32.show(Trades.spent_of(Trades.golden_two())))
    IO.print("trade_two_left " ++ U32.show(Trades.left_of(Trades.golden_two())))
    IO.print("trade_bond_spent " ++ U32.show(Trades.spent_of(Trades.golden_bond())))
    IO.print("trade_bond_left " ++ U32.show(Trades.left_of(Trades.golden_bond())))
    IO.print("weight_sum " ++ U32.show(Proj.weight_sum(350000)))
    IO.print("rebalance_dollars " ++ U32.show(Proj.bal_sum(Proj.add_annual(Proj.Bal{100000, 50000}, 150000, 350000))))
    IO.print("floor_ppm " ++ U32.show(Ns.floor_ppm()))
    IO.print("ns_df_1y " ++ U32.show(Ns.df_1y()))
    IO.print("ns_df_2y " ++ U32.show(Ns.df_2y()))
    IO.print("ns_df_5y " ++ U32.show(Ns.df_5y()))
    IO.print("ns_df_10y " ++ U32.show(Ns.df_10y()))
    IO.print("dirty_zero " ++ U32.show(Inst.dirty_zero()))
    IO.print("dirty_5pct " ++ U32.show(Inst.dirty_5pct()))
    IO.print("nav_fee_0 " ++ U32.show(Inst.nav_fee_0()))
    IO.print("nav_fee_low " ++ U32.show(Inst.nav_fee_low()))
    IO.print("nav_fee_high " ++ U32.show(Inst.nav_fee_high()))
    IO.print("target_one_year " ++ U32.show(Inst.target_one_year(10000, 40000)))
    IO.print("fan_trial0 " ++ U32.show(Fan.one_trial(0)))
    IO.print(Fan.show_fan())
