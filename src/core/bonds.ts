import type { Sleeve, SleeveKind } from "./types";

export interface BondParts {
  carry: number;
  /** −D·dy + ½·C·dy². Negative when yields rise and convexity does not offset it. */
  price: number;
  defaultLoss: number;
  mtm: number;
  htm: number;
  dy: number;
}

/**
 * Annual total return from carry, modified duration, and convexity.
 * Hold-to-maturity drops the price term: the bond earns the yield it was priced at.
 * Default loss is subtracted from both views. A recovery below par is still a loss if held.
 */
export function bondTotalReturn(args: {
  yieldPrev: number;
  yieldNext: number;
  duration: number;
  convexity: number;
  defaultLoss?: number;
}): BondParts {
  const dy = args.yieldNext - args.yieldPrev;
  const carry = args.yieldPrev;
  const price = -args.duration * dy + 0.5 * args.convexity * dy * dy;
  const defaultLoss = args.defaultLoss ?? 0;
  return {
    carry,
    price,
    defaultLoss,
    dy,
    mtm: carry + price - defaultLoss,
    htm: carry - defaultLoss,
  };
}

export function isBondKind(kind: SleeveKind): boolean {
  return kind === "tbill" || kind === "intermediate" || kind === "long_treasury" || kind === "credit";
}

/** Round placeholders copied onto a sleeve when its kind changes. Not a forecast and not a CUSIP. */
export function placeholderBond(kind: SleeveKind): Partial<Sleeve> {
  if (kind === "tbill") {
    return {
      duration: 0.4,
      convexity: 0.15,
      spread: 0,
      defaultProb: 0,
      recovery: 1,
      spreadBeta: 0,
      tradable: true,
      winsEligible: true,
      issuer: "",
    };
  }
  if (kind === "intermediate") {
    return {
      duration: 5,
      convexity: 30,
      spread: 0,
      defaultProb: 0,
      recovery: 1,
      spreadBeta: 0,
      tradable: true,
      winsEligible: true,
      issuer: "",
    };
  }
  if (kind === "long_treasury") {
    return {
      duration: 16,
      convexity: 280,
      spread: 0,
      defaultProb: 0,
      recovery: 1,
      spreadBeta: 0,
      tradable: true,
      winsEligible: true,
      issuer: "",
    };
  }
  if (kind === "credit") {
    return {
      duration: 6,
      convexity: 40,
      spread: 0.012,
      defaultProb: 0.004,
      recovery: 0.4,
      spreadBeta: 0.8,
      tradable: true,
      winsEligible: true,
      issuer: "",
    };
  }
  if (kind === "equity_index") return { studentDf: 5 };
  return {};
}

export function treasuryYield(
  kind: SleeveKind,
  curve: { short: number; intermediate: number; long: number },
): number {
  if (kind === "tbill") return curve.short;
  if (kind === "long_treasury") return curve.long;
  return curve.intermediate;
}

export function creditFlag(sleeve: Sleeve): string | null {
  if (sleeve.kind !== "credit") return null;
  if (sleeve.tradable && sleeve.winsEligible) {
    return "Credit spread, default, and recovery. This is not a Treasury bill.";
  }
  const bits = ["Credit risk, not a Treasury bill."];
  if (!sleeve.tradable) bits.push("Marked not publicly tradable.");
  if (!sleeve.winsEligible) bits.push("Marked not WInS-eligible.");
  return bits.join(" ");
}
