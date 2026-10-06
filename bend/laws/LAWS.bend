import Base
import ../fix.bend as Fix
import ../case.bend as Case
import ../glide.bend as Glide
import ../project.bend as Proj
import ../reserve.bend as Res
import ../facility.bend as Fac
import ../rng.bend as Rng
import ../corr.bend as Corr

# Invariants of the Gao Bend engine.
# Dollars are whole dollars. A weight of 1 is 1_000_000 ppm.
# These laws lock case cash flows, the zero-return path, the 0-yield
# ladder, and the rule that a facility gift comes only from what is left
# after the reserve. They do not recommend a portfolio, a reserve policy,
# a glide, or a facility contribution. Returns in the projection laws are
# the zero input, not a forecast.

law year_zero_is_2026:
  {Case.calendar(0n) == 2026 : U32}

def year_zero_is_2026():
  {==}

law year_one_is_2027:
  {Case.calendar(1n) == 2027 : U32}

def year_one_is_2027():
  {==}

law year_seven_is_2033:
  {Case.calendar(7n) == 2033 : U32}

def year_seven_is_2033():
  {==}

law year_sixteen_is_2042:
  {Case.calendar(16n) == 2042 : U32}

def year_sixteen_is_2042():
  {==}

law contrib_2026_is_zero:
  {Case.contrib_year(2026) == 0 : U32}

def contrib_2026_is_zero():
  {==}

law contrib_2027_is_300000:
  {Case.contrib_year(2027) == 300000 : U32}

def contrib_2027_is_300000():
  {==}

law contrib_2028_is_150000:
  {Case.contrib_year(2028) == 150000 : U32}

def contrib_2028_is_150000():
  {==}

law contrib_2033_is_zero:
  {Case.contrib_year(2033) == 0 : U32}

def contrib_2033_is_zero():
  {==}

# Indexes 0..16 are calendar years 2026..2042.
law contribution_schedule:
  {Case.flow_list(17n, 0n) == [
    Case.Flow{2026, 0},
    Case.Flow{2027, 300000},
    Case.Flow{2028, 150000},
    Case.Flow{2029, 0},
    Case.Flow{2030, 0},
    Case.Flow{2031, 0},
    Case.Flow{2032, 0},
    Case.Flow{2033, 0},
    Case.Flow{2034, 0},
    Case.Flow{2035, 0},
    Case.Flow{2036, 0},
    Case.Flow{2037, 0},
    Case.Flow{2038, 0},
    Case.Flow{2039, 0},
    Case.Flow{2040, 0},
    Case.Flow{2041, 0},
    Case.Flow{2042, 0}
  ] : List<Case.Flow>}

def contribution_schedule():
  {==}

law contributions_sum_to_450000:
  {Case.sum_contrib(17n) == 450000 : U32}

def contributions_sum_to_450000():
  {==}

law pay_2032_is_zero:
  {Case.operating_in_year(2032) == 0 : U32}

def pay_2032_is_zero():
  {==}

law pay_2033_is_50000:
  {Case.operating_in_year(2033) == 50000 : U32}

def pay_2033_is_50000():
  {==}

law pay_2042_is_50000:
  {Case.operating_in_year(2042) == 50000 : U32}

def pay_2042_is_50000():
  {==}

law pay_2043_is_zero:
  {Case.operating_in_year(2043) == 0 : U32}

def pay_2043_is_zero():
  {==}

law slot_0_is_50000:
  {Case.payment_at(0n) == 50000 : U32}

def slot_0_is_50000():
  {==}

law slot_9_is_50000:
  {Case.payment_at(9n) == 50000 : U32}

def slot_9_is_50000():
  {==}

law slot_10_is_outside:
  {Case.payment_at(10n) == 0 : U32}

def slot_10_is_outside():
  {==}

law liability_schedule:
  {Case.pay_list(10n, 0n) == [
    Case.Pay{2033, 50000},
    Case.Pay{2034, 50000},
    Case.Pay{2035, 50000},
    Case.Pay{2036, 50000},
    Case.Pay{2037, 50000},
    Case.Pay{2038, 50000},
    Case.Pay{2039, 50000},
    Case.Pay{2040, 50000},
    Case.Pay{2041, 50000},
    Case.Pay{2042, 50000}
  ] : List<Case.Pay>}

def liability_schedule():
  {==}

law liability_is_ten_times_50000:
  {Case.sum_pay(10n) == (50000 * 10 : U32) : U32}

def liability_is_ten_times_50000():
  {==}

law liability_nominal_is_500000:
  {Case.sum_pay(10n) == 500000 : U32}

def liability_nominal_is_500000():
  {==}

# At a 0% yield the ten equal payments have Macaulay duration 4.5 years.
# sum_time(10) = 0+1+...+9 = 45, and 45/10 = 4.5.
law macaulay_time_weight_at_zero_yield:
  {Case.sum_time(10n) == 45 : U32}

def macaulay_time_weight_at_zero_yield():
  {==}

law wins_is_zero:
  {Case.wins_pnl() == 0 : U32}

def wins_is_zero():
  {==}

law wins_does_not_change_450000:
  {(450000 + Case.wins_pnl() : U32) == 450000 : U32}

def wins_does_not_change_450000():
  {==}

# Starter knots are equal halves. That is the initial table, not a policy.
# The law required by the engine is that each knot sums to 1_000_000 ppm.
law knot_2027_sums_to_one:
  {Glide.knot_sum(Glide.knot_2027()) == 1000000 : U32}

def knot_2027_sums_to_one():
  {==}

law knot_2033_sums_to_one:
  {Glide.knot_sum(Glide.knot_2033()) == 1000000 : U32}

def knot_2033_sums_to_one():
  {==}

law weights_2027_sum_to_one:
  {Glide.knot_sum(Glide.weights_at(2027, Glide.knot_2027(), Glide.knot_2033())) == 1000000 : U32}

def weights_2027_sum_to_one():
  {==}

law weights_2030_sum_to_one:
  {Glide.knot_sum(Glide.weights_at(2030, Glide.knot_2027(), Glide.knot_2033())) == 1000000 : U32}

def weights_2030_sum_to_one():
  {==}

law weights_2033_sum_to_one:
  {Glide.knot_sum(Glide.weights_at(2033, Glide.knot_2027(), Glide.knot_2033())) == 1000000 : U32}

def weights_2033_sum_to_one():
  {==}

law weights_2042_sum_to_one:
  {Glide.knot_sum(Glide.weights_at(2042, Glide.knot_2027(), Glide.knot_2033())) == 1000000 : U32}

def weights_2042_sum_to_one():
  {==}

law half_split_conserves_dollars:
  {Proj.bal_sum(Proj.split_total(450000, 500000)) == 450000 : U32}

def half_split_conserves_dollars():
  {==}

law zero_scenario_fee_is_zero:
  {Proj.fee_of(Proj.zero_returns()) == 0 : U32}

def zero_scenario_fee_is_zero():
  {==}

law zero_scenario_growth_is_zero:
  {Fix.rate_ppm(Proj.growth_of(Proj.zero_returns())) == 0 : U32}

def zero_scenario_growth_is_zero():
  {==}

law zero_scenario_funding_is_zero:
  {Fix.rate_ppm(Proj.funding_of(Proj.zero_returns())) == 0 : U32}

def zero_scenario_funding_is_zero():
  {==}

# Points are beginning-of-year wealth. 2033 is after both contributions
# and six zero-return years. 2027 is the first contribution alone.
law annual_zero_points:
  {Proj.points(Proj.project(Proj.Annual{}, Proj.zero_returns())) == Proj.Points{300000, 450000, 450000, 450000} : Proj.Points}

def annual_zero_points():
  {==}

law drift_zero_points:
  {Proj.points(Proj.project(Proj.Drift{}, Proj.zero_returns())) == Proj.Points{300000, 450000, 450000, 450000} : Proj.Points}

def drift_zero_points():
  {==}

law annual_boy_2033_is_450000:
  {Proj.y2033(Proj.project(Proj.Annual{}, Proj.zero_returns())) == 450000 : U32}

def annual_boy_2033_is_450000():
  {==}

law annual_boy_2033_equals_contributions:
  {Proj.y2033(Proj.project(Proj.Annual{}, Proj.zero_returns())) == Case.sum_contrib(17n) : U32}

def annual_boy_2033_equals_contributions():
  {==}

law ladder_at_zero_is_500000:
  {Res.ladder_at(Fix.zero_rate()) == 500000 : U32}

def ladder_at_zero_is_500000():
  {==}

law ladder_matches_nominal_sum:
  {Res.ladder_at(Fix.zero_rate()) == Case.sum_pay(10n) : U32}

def ladder_matches_nominal_sum():
  {==}

law matched_ladder_ends_at_zero:
  {Res.roll(10n, Res.ladder_at(Fix.zero_rate()), Fix.zero_rate()) == 0 : U32}

def matched_ladder_ends_at_zero():
  {==}

law zero_margin_matches_ladder:
  {Res.with_margin(Res.ladder_at(Fix.zero_rate()), 0) == 500000 : U32}

def zero_margin_matches_ladder():
  {==}

law retain_underfunded_gives_nothing:
  {Fac.apply_rule(450000, 500000, Fac.Retain{1000000}) == Fac.Split{450000, 50000, 0, 0, 0} : Fac.Split}

def retain_underfunded_gives_nothing():
  {==}

law keep_underfunded_gives_nothing:
  {Fac.apply_rule(450000, 500000, Fac.Keep{0}) == Fac.Split{450000, 50000, 0, 0, 0} : Fac.Split}

def keep_underfunded_gives_nothing():
  {==}

law cap_underfunded_gives_nothing:
  {Fac.apply_rule(450000, 500000, Fac.Cap{100000}) == Fac.Split{450000, 50000, 0, 0, 0} : Fac.Split}

def cap_underfunded_gives_nothing():
  {==}

law reserve_splits_into_funded_and_gap:
  {Fac.funded_plus_gap(Fac.apply_rule(450000, 500000, Fac.Retain{0})) == 500000 : U32}

def reserve_splits_into_funded_and_gap():
  {==}

law wealth_splits_into_funded_and_residual:
  {Fac.funded_plus_residual(Fac.apply_rule(450000, 500000, Fac.Retain{0})) == 450000 : U32}

def wealth_splits_into_funded_and_residual():
  {==}

# Rule arithmetic on a caller-supplied wealth figure. Not a suggested gift.
law retain_fraction_splits_residual:
  {Fac.apply_rule(800000, 500000, Fac.Retain{400000}) == Fac.Split{500000, 0, 300000, 180000, 120000} : Fac.Split}

def retain_fraction_splits_residual():
  {==}

law keep_dollars_splits_residual:
  {Fac.apply_rule(800000, 500000, Fac.Keep{100000}) == Fac.Split{500000, 0, 300000, 200000, 100000} : Fac.Split}

def keep_dollars_splits_residual():
  {==}

law cap_dollars_splits_residual:
  {Fac.apply_rule(800000, 500000, Fac.Cap{100000}) == Fac.Split{500000, 0, 300000, 100000, 200000} : Fac.Split}

def cap_dollars_splits_residual():
  {==}

law gift_plus_flexibility_is_residual:
  {Fac.contribution_plus_flexibility(Fac.apply_rule(800000, 500000, Fac.Cap{100000})) == 300000 : U32}

def gift_plus_flexibility_is_residual():
  {==}

law zero_path_has_no_facility_residual:
  {Fac.residual_of(Fac.apply_rule(
    Proj.y2033(Proj.project(Proj.Annual{}, Proj.zero_returns())),
    Res.ladder_at(Fix.zero_rate()),
    Fac.Retain{0}
  )) == 0 : U32}

def zero_path_has_no_facility_residual():
  {==}

law portfolio_stream_is_1:
  {Rng.stream_id(Rng.Portfolio{}) == 1 : U32}

def portfolio_stream_is_1():
  {==}

law reserve_stream_is_2:
  {Rng.stream_id(Rng.Reserve{}) == 2 : U32}

def reserve_stream_is_2():
  {==}

law bootstrap_stream_is_3:
  {Rng.stream_id(Rng.Bootstrap{}) == 3 : U32}

def bootstrap_stream_is_3():
  {==}

law conditional_reuses_portfolio_stream:
  {Rng.conditional_stream() == 1 : U32}

def conditional_reuses_portfolio_stream():
  {==}

# Frozen SplitMix64 word for (seed 42, stream 1, trial 0, step 2027, dim 0).
# The same coordinates in src/core/rng.ts produce this word.
law audit_draw_portfolio_2027_dim0:
  {Rng.draw(42, 1, 0, 2027, 0) == Fix.U64{1420824054, 2195427346} : Fix.U64}

def audit_draw_portfolio_2027_dim0():
  {==}

law audit_draw_portfolio_2027_dim1:
  {Rng.draw(42, 1, 0, 2027, 1) == Fix.U64{367191874, 2040421663} : Fix.U64}

def audit_draw_portfolio_2027_dim1():
  {==}

law audit_draw_reserve_step0:
  {Rng.draw(42, 2, 0, 0, 0) == Fix.U64{1738958519, 2739167920} : Fix.U64}

def audit_draw_reserve_step0():
  {==}

law diagonal_is_one:
  {Corr.diag_ppm() == 1000000 : U32}

def diagonal_is_one():
  {==}

law identity_off_diagonal_is_zero:
  {Corr.off_ppm(Corr.identity_corr()) == 0 : U32}

def identity_off_diagonal_is_zero():
  {==}

law identity_is_symmetric:
  {Corr.off_01(Corr.identity_corr()) == Corr.off_10(Corr.identity_corr()) : U32}

def identity_is_symmetric():
  {==}

law zero_stress_keeps_identity:
  {Corr.stress_corr(Corr.identity_corr(), Fix.zero_rate()) == Corr.identity_corr() : Corr.Corr}

def zero_stress_keeps_identity():
  {==}

law clip_of_zero_is_zero:
  {Corr.clip_off(0) == 0 : U32}

def clip_of_zero_is_zero():
  {==}

law clip_caps_at_999000:
  {Corr.clip_off(2000000) == 999000 : U32}

def clip_caps_at_999000():
  {==}

law stress_clips_at_999000:
  {Corr.off_ppm(Corr.stress_corr(Corr.Corr{False{}, 600000}, Fix.Rate{False{}, 500000})) == 999000 : U32}

def stress_clips_at_999000():
  {==}

law opposite_off_diagonals_cancel:
  {Corr.add_corr(Corr.Corr{False{}, 100000}, Corr.Corr{True{}, 100000}) == Corr.Corr{False{}, 0} : Corr.Corr}

def opposite_off_diagonals_cancel():
  {==}

law correlation_is_symmetric:
  for c: Corr.Corr
  {Corr.off_01(c) == Corr.off_10(c) : U32}

def correlation_is_symmetric(c):
  {==}
