import Base
import ../fan.bend as Fan

# Integer contract of the fixed-point fan. The proven kernel rechecks these
# closed values. It does not recheck the 16-trial F32 reduction: that net
# passed 7 GB on this machine and the kernel was killed. The dollar band
# (trial 0, mean, min, max) is the executed parity check in bend/main.bend
# against src/core/fanMirror.ts. These constants are not a portfolio.

law fan_trials_are_sixteen:
  {Fan.trials() == 16 : U32}

def fan_trials_are_sixteen():
  {==}

law fan_seed_is_42:
  {Fan.seed_of() == 42 : U32}

def fan_seed_is_42():
  {==}

law fan_start_level_is_4pct:
  {Fan.start_level() == 40000 : U32}

def fan_start_level_is_4pct():
  {==}

law fan_contribution_2027_is_the_case_amount:
  {Fan.contrib(2027) == 300000 : U32}

def fan_contribution_2027_is_the_case_amount():
  {==}

law fan_contribution_2028_is_the_case_amount:
  {Fan.contrib(2028) == 150000 : U32}

def fan_contribution_2028_is_the_case_amount():
  {==}

law fan_later_contribution_is_zero:
  {Fan.contrib(2029) == 0 : U32}

def fan_later_contribution_is_zero():
  {==}
