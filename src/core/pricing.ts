import { creditFlag, isBondKind, treasuryYield } from "./bonds";
import { FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR } from "./case";
import { equityKernel, sectorShockAt, singleNameReturn } from "./equity";
import { correlatedShocks, normalizeSeed, simpleReturn } from "./math";
import { ratePath, type EvolvedRate } from "./rates";
import { effectiveDuration, issuerDefaultProbability, kernelEngaged, regimeDragAt, sectorFxReturn, sharedStudentScale, stepIgSpread, IG_DIM } from "./kernel";
import { STREAM, standardNormal, unitInterval } from "./rng";
import { portfolioNormals } from "./shocks";
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
  sharedScale?: number;
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
      sharedScale: args.sharedScale,
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
  /** Overrides the sleeve default probability. Used by the issuer-credit overlay. MODEL_SPEC §7.5. */
  probability?: number;
}): number {
  const lossGivenDefault = 1 - args.sleeve.recovery;
  const probability = args.probability ?? args.sleeve.defaultProb;
  if (!(probability > 0) || !(lossGivenDefault > 0)) return 0;
  if (args.mode === "scenario") return probability * lossGivenDefault;
  const draw = unitInterval(args.seed, STREAM.credit, args.trial, args.year, args.index);
  return draw < probability ? lossGivenDefault : 0;
}

/**
 * One trial's sleeve returns for 2027..2041, plus the rate path through 2042.
 * Bond mark-to-market uses carry − D·dy + ½C·dy² − default loss.
 * Hold-to-maturity keeps the carry and the default loss and drops the price term.
 */
function parametricDraws(assumptions: Assumptions, trial: number, year: number, factor: number[][] | null): number[] {
  if (!factor) return assumptions.sleeves.map(() => Number.NaN);
  const seed = normalizeSeed(assumptions.seed);
  const z = portfolioNormals({
    seed,
    sampling: assumptions.sampling,
    trial,
    year,
    sleeveCount: assumptions.sleeves.length,
  });
  return correlatedShocks(factor, z);
}

export interface PricedColumns {
  mtm: number[][];
  htm: number[][];
  price: number[][];
  cash: (number | null)[];
  rates: EvolvedRate[] | null;
}

function fitColumn(rows: number[][], years: number, sleeves: number): void {
  while (rows.length < years) rows.push(Array(sleeves).fill(0));
  rows.length = years;
  for (let year = 0; year < years; year++) {
    const row = rows[year];
    while (row.length < sleeves) row.push(0);
    row.length = sleeves;
  }
}

/**
 * Write one trial's priced returns into `dest`. Reusing `dest` across trials
 * keeps the same numbers as `priceTrial` without a fresh table per trial.
 * MODEL_SPEC §4.
 */
export function fillPricedSchedule(
  args: {
    assumptions: Assumptions;
    mode: "mc" | "scenario";
    scenario?: ScenarioName;
    trial: number;
    factor: number[][] | null;
  },
  dest: PricedColumns,
): void {
  const { assumptions, mode, trial } = args;
  if (!dest.rates) dest.rates = [];
  const rates = ratePath(
    {
      params: assumptions.rates,
      seed: assumptions.seed,
      trial,
      mode,
      scenario: args.scenario,
    },
    dest.rates,
  );
  const equitySleeve = assumptions.sleeves.find((sleeve) => sleeveKindOf(sleeve) === "equity_index");
  const wantParametric = mode === "mc" && assumptions.sleeves.some((sleeve) => sleeveKindOf(sleeve) === "parametric");
  const flags = assumptions.kernel;
  const engaged = kernelEngaged(flags);
  let regimeState = 0;
  const igState = assumptions.sleeves.map((sleeve) => sleeve.spread);
  const sleeves = assumptions.sleeves;
  const n = sleeves.length;
  let years = 0;
  for (let index = 0; index < rates.length - 1; index++) {
    if (rates[index].calendarYear >= LAST_PROJECTION_YEAR) break;
    years += 1;
  }
  fitColumn(dest.mtm, years, n);
  fitColumn(dest.htm, years, n);
  fitColumn(dest.price, years, n);
  while (dest.cash.length < years) dest.cash.push(null);
  dest.cash.length = years;

  let written = 0;
  for (let index = 0; index < rates.length - 1; index++) {
    const row = rates[index];
    const next = rates[index + 1];
    const year = row.calendarYear;
    if (year >= LAST_PROJECTION_YEAR) break;
    const kernel = equityKernel({
      mode,
      scenario: args.scenario,
      seed: assumptions.seed,
      trial,
      year,
      df: equitySleeve?.studentDf ?? assumptions.equity.studentDf,
      rho: assumptions.rates.equityRateCorr,
      rateShock: row.shock,
    });
    const market = marketReturn({ assumptions, kernel, equitySleeve });
    let drag = 0;
    if (engaged && flags?.markovRegimes) {
      const stepped = regimeDragAt({ flags, seed: assumptions.seed, trial, year, state: regimeState });
      regimeState = stepped.state;
      drag = stepped.drag;
    }
    const sharedScale =
      engaged && flags?.sharedStudent
        ? sharedStudentScale(assumptions.seed, trial, year, equitySleeve?.studentDf ?? assumptions.equity.studentDf)
        : undefined;
    const draws = wantParametric ? parametricDraws(assumptions, trial, year, args.factor) : [];
    const mtm = dest.mtm[written];
    const htm = dest.htm[written];
    const price = dest.price[written];
    for (let sleeveIndex = 0; sleeveIndex < n; sleeveIndex++) {
      const sleeve = sleeves[sleeveIndex];
      const kind = sleeveKindOf(sleeve);
      let mtmReturn = 0;
      let htmReturn = 0;
      let priceTerm = 0;
      if (kind === "parametric") {
        mtmReturn =
          mode === "scenario"
            ? sleeve[args.scenario ?? "base"]
            : simpleReturn(
                sleeve.mu,
                sleeve.sigma,
                draws[sleeveIndex] ?? 0,
                assumptions.returnModel,
                assumptions.normalFloor,
                assumptions.correctNormalFloor === true,
              );
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
          sharedScale,
        });
        mtmReturn = basket;
        htmReturn = basket;
      } else if (isBondKind(kind)) {
        const treasuryPrev = treasuryYield(kind, row);
        const treasuryNext = treasuryYield(kind, next);
        let spreadNow = sleeve.spread;
        let spreadNext = kind === "credit" ? sleeve.spread + sleeve.spreadBeta * Math.max(0, -market) : sleeve.spread;
        if (engaged && flags?.igSpread && kind === "credit") {
          spreadNow = igState[sleeveIndex];
          const shock = standardNormal(assumptions.seed, STREAM.credit, trial, year, IG_DIM + sleeveIndex);
          spreadNext = stepIgSpread({
            spread: spreadNow,
            kappa: flags.igKappa ?? 0.3,
            theta: flags.igTheta ?? sleeve.spread,
            sigma: flags.igSigma ?? 0.005,
            shock,
            equity: market,
            spreadBeta: sleeve.spreadBeta,
          });
          igState[sleeveIndex] = spreadNext;
        }
        const probability =
          engaged && flags?.issuerCredit && kind === "credit"
            ? issuerDefaultProbability(sleeve.defaultProb, flags.issuerBeta ?? 1, market)
            : undefined;
        const loss = kind === "credit" ? defaultLoss({ sleeve, index: sleeveIndex, mode, seed: assumptions.seed, trial, year, probability }) : 0;
        const yieldPrev = treasuryPrev + (kind === "credit" ? spreadNow : 0);
        const yieldNext = treasuryNext + (kind === "credit" ? spreadNext : 0);
        const dy = yieldNext - yieldPrev;
        const duration = engaged ? effectiveDuration(sleeve, year, flags, FIRST_PROJECTION_YEAR) : sleeve.duration;
        priceTerm = -duration * dy + 0.5 * sleeve.convexity * dy * dy;
        mtmReturn = yieldPrev + priceTerm - loss;
        htmReturn = yieldPrev - loss;
      }
      if (engaged && flags?.markovRegimes && (kind === "equity_index" || kind === "basket")) {
        mtmReturn += drag;
        htmReturn += drag;
      }
      if (engaged && flags?.sectorFx && kind === "equity_index") {
        mtmReturn = sectorFxReturn({ base: mtmReturn, flags, seed: assumptions.seed, trial, year });
        htmReturn = mtmReturn;
      }
      if (assumptions.crashYear != null && assumptions.crashYear === year && !isBondKind(kind)) {
        const shock = assumptions.crashShock ?? 0;
        mtmReturn += shock;
        htmReturn += shock;
      }
      mtmReturn = applyExpense(mtmReturn, sleeve.expenseRatio);
      htmReturn = applyExpense(htmReturn, sleeve.expenseRatio);
      mtm[sleeveIndex] = floorReturn(mtmReturn, assumptions.normalFloor);
      htm[sleeveIndex] = floorReturn(htmReturn, assumptions.normalFloor);
      price[sleeveIndex] = priceTerm;
    }
    dest.cash[written] = row.short;
    written += 1;
  }
}

export function priceTrial(args: {
  assumptions: Assumptions;
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
  trial: number;
  factor: number[][] | null;
}): { byYear: Map<number, YearSlice>; rates: EvolvedRate[] } {
  const dest: PricedColumns = { mtm: [], htm: [], price: [], cash: [], rates: [] };
  fillPricedSchedule(args, dest);
  const byYear = new Map<number, YearSlice>();
  const rates = dest.rates ?? [];
  for (let index = 0; index < dest.mtm.length; index++) {
    const year = rates[index]?.calendarYear ?? FIRST_PROJECTION_YEAR + index;
    byYear.set(year, {
      mtm: dest.mtm[index],
      htm: dest.htm[index],
      price: dest.price[index],
      cashYield: dest.cash[index] ?? 0,
    });
  }
  return { byYear, rates };
}

const priceCache = new WeakMap<Assumptions, Map<string, { byYear: Map<number, YearSlice>; rates: EvolvedRate[] }>>();
const factorKeys = new WeakMap<number[][], string>();

function factorKeyOf(factor: number[][] | null): string {
  if (!factor) return "none";
  const hit = factorKeys.get(factor);
  if (hit !== undefined) return hit;
  const key = factor.map((row) => row.join(",")).join(";");
  factorKeys.set(factor, key);
  return key;
}

/** One priced path per assumptions object, scenario, and trial. Mixes and the 2031 range reuse it. */
export function cachedPriceTrial(args: {
  assumptions: Assumptions;
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
  trial: number;
  factor: number[][] | null;
}): { byYear: Map<number, YearSlice>; rates: EvolvedRate[] } {
  let bucket = priceCache.get(args.assumptions);
  if (!bucket) {
    bucket = new Map();
    priceCache.set(args.assumptions, bucket);
  }
  const factorKey = factorKeyOf(args.factor);
  const key = `${args.mode}|${args.scenario ?? ""}|${args.trial}|${factorKey}`;
  const hit = bucket.get(key);
  if (hit) return hit;
  const table = priceTrial(args);
  bucket.set(key, table);
  return table;
}

export function flagText(sleeve: Sleeve): string | null {
  return creditFlag(sleeve);
}
