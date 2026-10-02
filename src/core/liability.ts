import {
  OPERATING_FIRST_YEAR,
  OPERATING_LAST_YEAR,
  OPERATING_PAYMENT,
  OPERATING_PAYMENTS,
  yearIndex,
} from "./case";
import { pvAnnuityDue } from "./math";

export interface LiabilityPayment {
  calendarYear: number;
  yearIndex: number;
  /** Years after the first payment. The first payment has k = 0 and is not discounted. */
  k: number;
  payment: number;
}

/** The case operating liability. Ten fixed nominal payments. Not a modeling choice. */
export interface LiabilitySchedule {
  name: string;
  payment: number;
  count: number;
  firstYear: number;
  lastYear: number;
  inflationLinked: false;
  nominalSum: number;
  payments: LiabilityPayment[];
}

export function caseLiabilitySchedule(): LiabilitySchedule {
  const payments: LiabilityPayment[] = [];
  for (let k = 0; k < OPERATING_PAYMENTS; k++) {
    const calendarYear = OPERATING_FIRST_YEAR + k;
    payments.push({
      calendarYear,
      yearIndex: yearIndex(calendarYear),
      k,
      payment: OPERATING_PAYMENT,
    });
  }
  return {
    name: "Gao operating liability",
    payment: OPERATING_PAYMENT,
    count: OPERATING_PAYMENTS,
    firstYear: OPERATING_FIRST_YEAR,
    lastYear: OPERATING_LAST_YEAR,
    inflationLinked: false,
    nominalSum: OPERATING_PAYMENT * OPERATING_PAYMENTS,
    payments,
  };
}

export function discountFactor(yieldPerYear: number, k: number): number {
  if (k === 0) return 1;
  if (yieldPerYear <= -0.999999) return Number.POSITIVE_INFINITY;
  return 1 / Math.pow(1 + yieldPerYear, k);
}

/** Present value of the case liability at a flat yield. Same number as the flat-yield ladder with no surplus. */
export function caseLiabilityPv(yieldPerYear: number): number {
  return pvAnnuityDue(OPERATING_PAYMENT, OPERATING_PAYMENTS, yieldPerYear);
}
