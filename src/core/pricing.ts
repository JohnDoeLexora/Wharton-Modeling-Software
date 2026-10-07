import { bondTotalReturn, creditFlag, isBondKind, treasuryYield } from "./bonds";
import { LAST_PROJECTION_YEAR } from "./case";
import { equityKernel, sectorShockAt, singleNameReturn } from "./equity";
import { correlatedShocks, normalizeSeed, simpleReturn } from "./math";
import { ratePath, type EvolvedRate } from "./rates";
import { STREAM, standardNormal, unitInterval } from "./rng";
import type { Assumptions, BasketName, ScenarioName, Sleeve, SleeveKind } from "./types";

export interface YearSlice {
  mtm: number[];
  htm: number[];
  price: number[];
  cashYield: number;
}

export function sleeveKindOf(sleeve: Sleeve): SleeveKind {
  return sleeve.kind ?? "parametric";
}

export function usesPricedModel(sleeves: Sleeve[]): boolean {
  return sleeves.some((sleeve) => sleeveKindOf(sleeve) !== "parametric");
}

function floorReturn(value: number, floor: number): number {
  if (!Number.isFinite(value)) return floor;
  return value < floor ? floor : value;
}

function applyExpense(value: number, expenseRatio: number): number {
  if (expenseRatio === 0) return value;
  return (1 + value) * (1 - expenseRatio) - 1;
}

function marketReturn(args: {
  assumptions: Assumptions;
  kernel: number;
  equitySleeve: Sleeve | undefined;
}): number {
  const { assumptions, kernel, equitySleeve } = args;
  const drag = assumptions.equity.regimeDrag;
  if (equitySleeve) {
    return simpleReturn(
      equitySleeve.mu + drag,
      equitySleeve.sigma,
      kernel,
      assumptions.returnModel,
      assumptions.normalFloor,
    );
  }
  return simpleReturn(
    assumptions.equity.marketMu + drag,
    assumptions.equity.marketSigma,
    kernel,
    assumptions.returnModel,
    assumptions.normalFloor,
  );
}

function basketPortfolioReturn(args: {
  names: BasketName[];
  market: number;
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
  seed: number;
  trial: number;
  year: number;
  sectorSigma: number;
}): number {
  let total = 0;
  for (const name of args.names) if (name.weight > 0) total += name.weight;
  if (total <= 0) return 0;
  const shocks = new Map<string, number>();
  let result = 0;
  args.names.forEach((name, index) => {
    if (!(name.weight > 0)) return;
    let sector = shocks.get(name.sector);
    if (sector === undefined) {
      sector = sectorShockAt({
        sector: name.sector,
        sigma: args.sectorSigma,
        mode: args.mode,
        scenario: args.scenario,
        seed: args.seed,
        trial: args.trial,
        year: args.year,
      });
      shocks.set(name.sector, sector);
    }
    const single = singleNameReturn({
      name,
      index,
      market: args.market,
      sectorShock: sector,
      mode: args.mode,
      seed: args.seed,
      trial: args.trial,
      year: args.year,
    });
    result += (name.weight / total) * single;
  });
  return result;
}

function defaultLoss(args: {
  sleeve: Sleeve;
  index: number;
  mode: "mc" | "scenario";
  seed: number;
  trial: number;
  year: number;
}): number {
  const lossGivenDefault = 1 - args.sleeve.recovery;
  if (!(args.sleeve.defaultProb > 0) || !(lossGivenDefault > 0)) return 0;
  if (args.mode === "scenario") return args.sleeve.defaultProb * lossGivenDefault;
  const draw = unitInterval(args.seed, STREAM.credit, args.trial, args.year, args.index);
  return draw < args.sleeve.defaultProb ? lossGivenDefault : 0;
}

/**
 * One trial's sleeve returns for 2027..2041, plus the rate path through 2042.
 * Bond mark-to-market uses carry − D·dy + ½C·dy² − default loss.
 * Hold-to-maturity keeps the carry and the default loss and drops the price term.
 */
function parametricDraws(assumptions: Assumptions, trial: number, year: number, factor: number[][] | null): number[] {
  const seed = normalizeSeed(assumptions.seed);
  const z = assumptions.sleeves.map((_, index) => standardNormal(seed, STREAM.portfolio, trial, year, index));
  return factor ? correlatedShocks(factor, z) : z;
}

export function priceTrial(args: {
  assumptions: Assumptions;
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
  trial: number;
  factor: number[][] | null;
}): { byYear: Map<number, YearSlice>; rates: EvolvedRate[] } {
  const { assumptions, mode, trial } = args;
  const rates = ratePath({
    params: assumptions.rates,
    seed: assumptions.seed,
    trial,
    mode,
    scenario: args.scenario,
  });
  const byYear = new Map<number, YearSlice>();
  const equitySleeve = assumptions.sleeves.find((sleeve) => sleeveKindOf(sleeve) === "equity_index");
  const kernels = new Map<number, number>();
  const markets = new Map<number, number>();

  for (let index = 0; index < rates.length - 1; index++) {
    const row = rates[index];
    const kernel = equityKernel({
      mode,
      scenario: args.scenario,
      seed: assumptions.seed,
      trial,
      year: row.calendarYear,
      df: equitySleeve?.studentDf ?? assumptions.equity.studentDf,
      rho: assumptions.rates.equityRateCorr,
      rateShock: row.shock,
    });
    kernels.set(row.calendarYear, kernel);
    markets.set(row.calendarYear, marketReturn({ assumptions, kernel, equitySleeve }));
  }

  for (let index = 0; index < rates.length - 1; index++) {
    const row = rates[index];
    const next = rates[index + 1];
    const year = row.calendarYear;
    if (year >= LAST_PROJECTION_YEAR) break;
    const market = markets.get(year) ?? 0;
    const draws = mode === "mc" ? parametricDraws(assumptions, trial, year, args.factor) : [];
    const mtm: number[] = [];
    const htm: number[] = [];
    const price: number[] = [];
    assumptions.sleeves.forEach((sleeve, sleeveIndex) => {
      const kind = sleeveKindOf(sleeve);
      let mtmReturn = 0;
      let htmReturn = 0;
      let priceTerm = 0;
      if (kind === "parametric") {
        mtmReturn =
          mode === "scenario"
            ? sleeve[args.scenario ?? "base"]
            : simpleReturn(sleeve.mu, sleeve.sigma, draws[sleeveIndex] ?? 0, assumptions.returnModel, assumptions.normalFloor);
        htmReturn = mtmReturn;
      } else if (kind === "equity_index") {
        mtmReturn = market;
        htmReturn = market;
      } else if (kind === "basket") {
        const basket = basketPortfolioReturn({
          names: assumptions.basket,
          market,
          mode,
          scenario: args.scenario,
          seed: assumptions.seed,
          trial,
          year,
          sectorSigma: assumptions.equity.sectorSigma,
        });
        mtmReturn = basket;
        htmReturn = basket;
      } else if (isBondKind(kind)) {
        const treasuryPrev = treasuryYield(kind, row);
        const treasuryNext = treasuryYield(kind, next);
        const spreadNow = sleeve.spread;
        const spreadNext = kind === "credit" ? sleeve.spread + sleeve.spreadBeta * Math.max(0, -market) : sleeve.spread;
        const loss = kind === "credit" ? defaultLoss({ sleeve, index: sleeveIndex, mode, seed: assumptions.seed, trial, year }) : 0;
        const parts = bondTotalReturn({
          yieldPrev: treasuryPrev + (kind === "credit" ? spreadNow : 0),
          yieldNext: treasuryNext + (kind === "credit" ? spreadNext : 0),
          duration: sleeve.duration,
          convexity: sleeve.convexity,
          defaultLoss: loss,
        });
        mtmReturn = parts.mtm;
        htmReturn = parts.htm;
        priceTerm = parts.price;
      }
      mtmReturn = applyExpense(mtmReturn, sleeve.expenseRatio);
      htmReturn = applyExpense(htmReturn, sleeve.expenseRatio);
      mtm.push(floorReturn(mtmReturn, assumptions.normalFloor));
      htm.push(floorReturn(htmReturn, assumptions.normalFloor));
      price.push(priceTerm);
    });
    byYear.set(year, { mtm, htm, price, cashYield: row.short });
  }

  return { byYear, rates };
}

export function flagText(sleeve: Sleeve): string | null {
  return creditFlag(sleeve);
}
