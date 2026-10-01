import { OPERATING_PAYMENT, OPERATING_PAYMENTS, OPERATING_FIRST_YEAR, yearIndex } from "./case";
import { boxMuller, macaulayDuration, modifiedDuration, mulberry32, normalizeSeed, pvAnnuityDue, simpleReturn } from "./math";
import type { ReserveMethod, ReserveParams, ReserveSizing, ReserveYearRow, ReturnModel } from "./types";

/**
 * Smallest reserve that funds every payment on one deterministic return path.
 * `returnsBetween[t]` is earned after payment t and before payment t+1.
 * There is one more payment than there are returns.
 */
export function reserveToImmunize(returnsBetween: number[], payment = OPERATING_PAYMENT): number {
  let needed = payment;
  for (let t = returnsBetween.length - 1; t >= 0; t--) {
    const rate = returnsBetween[t];
    if (rate <= -0.999999) return Number.POSITIVE_INFINITY;
    needed = payment + needed / (1 + rate);
  }
  return needed;
}

export function flatReturns(rate: number, steps = OPERATING_PAYMENTS - 1): number[] {
  return Array(steps).fill(rate);
}

export function rollReserve(args: {
  initial: number;
  returnsBetween: number[];
  discountYield: number;
  payment?: number;
  firstYear?: number;
}): ReserveYearRow[] {
  const payment = args.payment ?? OPERATING_PAYMENT;
  const firstYear = args.firstYear ?? OPERATING_FIRST_YEAR;
  const count = args.returnsBetween.length + 1;
  let balance = args.initial;
  const rows: ReserveYearRow[] = [];

  for (let k = 0; k < count; k++) {
    const paymentsLeft = count - k;
    const pv = pvAnnuityDue(payment, paymentsLeft, args.discountYield);
    const funded = Math.max(0, Math.min(payment, balance));
    const shortfall = payment - funded;
    const after = balance - funded;
    const rate = k < args.returnsBetween.length ? args.returnsBetween[k] : null;
    const grown = rate === null ? after : after * (1 + rate);
    // A long-only reserve cannot be worth less than zero. A return at or below -100% wipes it.
    const eoy = Math.max(0, grown);
    rows.push({
      calendarYear: firstYear + k,
      yearIndex: yearIndex(firstYear + k),
      boyAssets: balance,
      paymentDue: payment,
      paymentFunded: funded,
      shortfall,
      afterPayment: after,
      reinvestmentReturn: rate,
      eoyAssets: eoy,
      paymentsLeftIncludingThis: paymentsLeft,
      undiscountedLiability: payment * paymentsLeft,
      pvLiability: pv,
      fundedRatio: Number.isFinite(pv) && pv > 0 ? balance / pv : null,
    });
    balance = eoy;
  }

  return rows;
}

/**
 * For each simulated reserve-return path, compute the minimum reserve that
 * funds all ten payments. The reported reserve is the smallest amount that
 * covers at least `target` of those path requirements (an order statistic).
 * This is a frequency inside the sample. It is not a market probability.
 */
export function sizeShortfallReserve(args: {
  mu: number;
  sigma: number;
  target: number;
  trials: number;
  seed: number;
  returnModel: ReturnModel;
  normalFloor: number;
  payment?: number;
  steps?: number;
}): ReserveSizing {
  const payment = args.payment ?? OPERATING_PAYMENT;
  const steps = args.steps ?? OPERATING_PAYMENTS - 1;
  const target = Math.min(1, Math.max(0, args.target));
  if (target <= 0) {
    return {
      method: "shortfall",
      reserve: 0,
      attainableProbability: 1,
      achievedProbability: 1,
      macaulayDuration: null,
      modifiedDuration: null,
      message: "Target is 0, so this method sets the reserve to $0. That does not fund the operating payments.",
    };
  }

  const randn = boxMuller(mulberry32(normalizeSeed(args.seed)));
  const requirements: number[] = [];
  for (let trial = 0; trial < args.trials; trial++) {
    const rates: number[] = [];
    for (let step = 0; step < steps; step++) {
      rates.push(simpleReturn(args.mu, args.sigma, randn(), args.returnModel, args.normalFloor));
    }
    requirements.push(reserveToImmunize(rates, payment));
  }

  const finite = requirements.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const attainable = finite.length / requirements.length;
  if (finite.length === 0 || target > attainable + 1e-12) {
    return {
      method: "shortfall",
      reserve: null,
      attainableProbability: attainable,
      achievedProbability: attainable,
      macaulayDuration: null,
      modifiedDuration: null,
      message:
        "In this sample, too many paths destroy the reserve (a return at or below -100%) before later payments. Lower the target or change the reserve return assumption. No finite reserve in the sample hits the target.",
    };
  }

  const index = Math.min(finite.length - 1, Math.max(0, Math.ceil(target * requirements.length) - 1));
  const reserve = finite[index];
  const achieved = requirements.filter((value) => value <= reserve + 1e-6).length / requirements.length;
  return {
    method: "shortfall",
    reserve,
    attainableProbability: attainable,
    achievedProbability: achieved,
    macaulayDuration: null,
    modifiedDuration: null,
    message:
      "Sized from the order statistic of path-by-path immunizing reserves. The achieved share is a count inside this seeded sample, not a forecast.",
  };
}

function finiteOrNull(method: ReserveMethod, reserve: number, message: string, yieldForDuration: number | null): ReserveSizing {
  if (!Number.isFinite(reserve)) {
    return {
      method,
      reserve: null,
      attainableProbability: null,
      achievedProbability: null,
      macaulayDuration: null,
      modifiedDuration: null,
      message: "The rate is at or below -100%, so later payments cannot be prefunded by investing the remainder. No finite reserve works.",
    };
  }
  const duration =
    yieldForDuration === null
      ? null
      : macaulayDuration(OPERATING_PAYMENT, OPERATING_PAYMENTS, yieldForDuration);
  const modified =
    yieldForDuration === null
      ? null
      : modifiedDuration(OPERATING_PAYMENT, OPERATING_PAYMENTS, yieldForDuration);
  return {
    method,
    reserve,
    attainableProbability: null,
    achievedProbability: null,
    macaulayDuration: Number.isFinite(duration) ? duration : null,
    modifiedDuration: Number.isFinite(modified) ? modified : null,
    message,
  };
}

export function sizeReserve(
  method: ReserveMethod,
  params: ReserveParams,
  sample: { trials: number; seed: number; returnModel: ReturnModel; normalFloor: number },
): ReserveSizing {
  if (method === "ladder") {
    const reserve = reserveToImmunize(flatReturns(params.discountYield));
    return finiteOrNull(
      "ladder",
      reserve,
      "Flat-yield ladder: backward induction at the discount yield. If that yield is locked and each payment date is matched, the schedule ends with about $0 left.",
      params.discountYield,
    );
  }
  if (method === "duration") {
    const pv = reserveToImmunize(flatReturns(params.discountYield));
    const reserve = Number.isFinite(pv) ? pv * (1 + params.surplusMargin) : pv;
    return finiteOrNull(
      "duration",
      reserve,
      "Present value at the discount yield, multiplied by (1 + surplus margin). Duration describes the liability; it does not pick a bond.",
      params.discountYield,
    );
  }
  if (method === "stress") {
    const reserve = reserveToImmunize(flatReturns(params.stressReturn));
    return finiteOrNull(
      "stress",
      reserve,
      "Smallest reserve that completes every payment if the reserve earns the stress return every year. This is one path, not a probability.",
      params.discountYield,
    );
  }
  return sizeShortfallReserve({
    mu: params.shortfallMu,
    sigma: params.shortfallSigma,
    target: params.shortfallTarget,
    trials: sample.trials,
    seed: sample.seed,
    returnModel: sample.returnModel,
    normalFloor: sample.normalFloor,
  });
}

export function scheduleReturnsFor(params: ReserveParams, sizingRate: number): number[] {
  if (params.useCustomSchedule) return params.customReturns.slice();
  return flatReturns(sizingRate);
}

export function sizingRate(method: ReserveMethod, params: ReserveParams): number {
  if (method === "stress") return params.stressReturn;
  if (method === "shortfall") return params.shortfallMu;
  return params.discountYield;
}

export function scheduleFullyFunds(rows: ReserveYearRow[]): boolean {
  return rows.every((row) => row.shortfall <= 1e-4);
}
