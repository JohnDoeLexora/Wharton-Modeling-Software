import { OPERATING_PAYMENT, OPERATING_PAYMENTS } from "./case";
import { modifiedDuration } from "./math";
import { bondTotalReturn } from "./bonds";
import { RATE_REGIMES, evolveShortRate, templateParams } from "./rates";
import { reserveToImmunize, flatReturns } from "./reserve";
import type { CurveReserveMethod, RateParams, RegimeFunding, RegimeMethodStatus } from "./types";

export interface YieldCurve {
  short: number;
  intermediate: number;
  long: number;
}

/** Yield used to discount a payment `years` away. Year 0 is the immediate payment and is not discounted here. */
export function yieldForMaturity(curve: YieldCurve, years: number): number {
  if (years <= 1) return curve.short;
  if (years >= 10) return curve.long;
  if (years <= 5) {
    const weight = (years - 1) / 4;
    return curve.short * (1 - weight) + curve.intermediate * weight;
  }
  const weight = (years - 5) / 5;
  return curve.intermediate * (1 - weight) + curve.long * weight;
}

/** Present value of the remaining $50,000 annuity-due on a 3-point curve. */
export function pvAtCurve(curve: YieldCurve, paymentsLeft = OPERATING_PAYMENTS): number {
  let total = 0;
  for (let k = 0; k < paymentsLeft; k++) {
    if (k === 0) {
      total += OPERATING_PAYMENT;
      continue;
    }
    const yieldK = yieldForMaturity(curve, k);
    if (yieldK <= -0.999999) return Number.POSITIVE_INFINITY;
    total += OPERATING_PAYMENT / Math.pow(1 + yieldK, k);
  }
  return total;
}

function shiftCurve(curve: YieldCurve, dy: number): YieldCurve {
  return { short: curve.short + dy, intermediate: curve.intermediate + dy, long: curve.long + dy };
}

interface RollResult {
  minFundedRatio: number | null;
  terminalShortfall: number;
  shockFundedRatio: number | null;
}

function liabilityDuration(curve: YieldCurve, paymentsLeft: number): { modified: number; convexity: number } {
  const flat = curve.intermediate;
  const modified = modifiedDuration(OPERATING_PAYMENT, paymentsLeft, flat);
  const duration = Number.isFinite(modified) ? modified : 4.5;
  return { modified: duration, convexity: duration * duration };
}

/**
 * Roll a reserve from 2033 through 2042.
 * Nominal cash earns nothing. Bills earn the short yield with duration 0.4.
 * The curve ladder and the duration match earn the intermediate yield at the liability's modified duration,
 * reset each year to the payments still ahead. That is immunization, not a CUSIP.
 */
function rollReserveOnCurves(args: {
  initial: number;
  curves: YieldCurve[];
  style: CurveReserveMethod;
}): RollResult {
  let assets = args.initial;
  let minRatio: number | null = null;
  let shortfallSum = 0;
  const years = Math.min(OPERATING_PAYMENTS, args.curves.length);
  for (let k = 0; k < years; k++) {
    const curve = args.curves[k];
    const next = args.curves[k + 1] ?? curve;
    const paymentsLeft = years - k;
    const pv = pvAtCurve(curve, paymentsLeft);
    if (Number.isFinite(pv) && pv > 0) {
      const ratio = assets / pv;
      minRatio = minRatio === null ? ratio : Math.min(minRatio, ratio);
    }
    const funded = Math.max(0, Math.min(OPERATING_PAYMENT, assets));
    shortfallSum += OPERATING_PAYMENT - funded;
    let remaining = assets - funded;
    if (k < years - 1 && remaining > 0) {
      let result = 0;
      if (args.style === "nominal") result = 0;
      else if (args.style === "tbill_ladder") {
        result = bondTotalReturn({
          yieldPrev: curve.short,
          yieldNext: next.short,
          duration: 0.4,
          convexity: 0.15,
        }).mtm;
      } else {
        const { modified, convexity } = liabilityDuration(curve, paymentsLeft - 1);
        result = bondTotalReturn({
          yieldPrev: curve.intermediate,
          yieldNext: next.intermediate,
          duration: modified,
          convexity,
        }).mtm;
      }
      if (result < -0.999) result = -0.999;
      remaining *= 1 + result;
    }
    assets = Math.max(0, remaining);
  }

  const curve0 = args.curves[0];
  const shocked = curve0 ? shiftCurve(curve0, 0.01) : null;
  let shockFundedRatio: number | null = null;
  if (curve0 && shocked) {
    const newPv = pvAtCurve(shocked, years);
    let duration = 0;
    let convexity = 0;
    if (args.style === "tbill_ladder") {
      duration = 0.4;
      convexity = 0.15;
    } else if (args.style === "pv_curve" || args.style === "duration_matched") {
      const matched = liabilityDuration(curve0, years);
      duration = matched.modified;
      convexity = matched.convexity;
    }
    const price = bondTotalReturn({
      yieldPrev: 0,
      yieldNext: 0.01,
      duration,
      convexity,
    }).price;
    const mtmAssets = args.initial * (1 + price);
    shockFundedRatio = Number.isFinite(newPv) && newPv > 0 ? mtmAssets / newPv : null;
  }

  return { minFundedRatio: minRatio, terminalShortfall: shortfallSum, shockFundedRatio };
}

function methodNote(method: CurveReserveMethod): string {
  if (method === "nominal") return "Nominal $500,000 cash. It earns nothing. The ten payments sum to $500,000.";
  if (method === "tbill_ladder") return "T-bill ladder sized at the 2033 short rate, then rolled at the path's short yield. Duration 0.4.";
  if (method === "pv_curve") return "Present value of the ten payments on the 2033 three-point curve, then duration-matched to what remains.";
  return "Same present value as the curve ladder. The asset duration is reset each year to the liability's modified duration.";
}

const METHOD_ORDER: CurveReserveMethod[] = ["pv_curve", "nominal", "tbill_ladder", "duration_matched"];

export function fundingForParams(params: RateParams, regimeLabel: RateParams["regime"]): RegimeFunding {
  const path = evolveShortRate(params, () => 0, 0);
  const from2033 = path.filter((row) => row.calendarYear >= 2033);
  const curves: YieldCurve[] = from2033.map((row) => ({
    short: row.short,
    intermediate: row.intermediate,
    long: row.long,
  }));
  const curve = curves[0] ?? { short: params.r0, intermediate: params.r0, long: params.r0 };
  const pv = pvAtCurve(curve);
  const bill = reserveToImmunize(flatReturns(curve.short));
  const sized: Record<CurveReserveMethod, number> = {
    pv_curve: Number.isFinite(pv) ? pv : Number.NaN,
    nominal: OPERATING_PAYMENT * OPERATING_PAYMENTS,
    tbill_ladder: Number.isFinite(bill) ? bill : Number.NaN,
    duration_matched: Number.isFinite(pv) ? pv : Number.NaN,
  };
  const methods: RegimeMethodStatus[] = METHOD_ORDER.map((method) => {
    const reserve = sized[method];
    const rolled = Number.isFinite(reserve)
      ? rollReserveOnCurves({ initial: reserve, curves, style: method })
      : { minFundedRatio: null, terminalShortfall: Number.NaN, shockFundedRatio: null };
    return {
      method,
      reserve,
      minFundedRatio: rolled.minFundedRatio,
      terminalShortfall: rolled.terminalShortfall,
      shockFundedRatio: rolled.shockFundedRatio,
      note: methodNote(method),
    };
  });
  return { regime: regimeLabel, short2033: curve.short, methods };
}

export const REGIME_TABLE_NOTE =
  "Each column uses that regime's drift template and sets short-rate volatility to zero. " +
  "The level, mean reversion, and term premia are the numbers in the rate card. " +
  "The portfolio sample uses the regime and the drifts you left in the card, including volatility. " +
  "Templates are illustrations, not forecasts. A funded ratio is assets divided by the present value of the payments still due.";

/** One row per regime, so the reserve page can show funded status under each template. */
export function fundingByRegime(base: RateParams): RegimeFunding[] {
  return RATE_REGIMES.map((regime) => fundingForParams(templateParams(base, regime), regime));
}
