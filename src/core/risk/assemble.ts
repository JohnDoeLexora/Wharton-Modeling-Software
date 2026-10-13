/** One risk report: data quality, every estimator, flags, covariance, coverage, and book risk. */

import { betaAgainst, finishBeta, isNonsync, sectorPrior, type BetaCard } from "./beta";
import { cleanPrices, parsePriceCsv, type CleanSeries, type PriceRow, type QualityReport } from "./clean";
import { coverSeries, type CoverageReport } from "./coverage";
import { factorCovariance, type FactorModel } from "./factors";
import { trackFund, type FundTrack } from "./funds";
import { detectGaps, fitJumps, type JumpFit, type SectorJumpPool } from "./jumps";
import { bookRisk, type BookRisk } from "./portfolio";
import { fitTail, type TailFit } from "./tails";
import { DISAGREEMENT_RATIO, volCard, type VolCard } from "./vol";

export interface NameCard {
  ticker: string;
  name: string;
  sector: string;
  role: string;
  nonsync: boolean;
  quality: QualityReport;
  vol: VolCard;
  beta: BetaCard | null;
  jumps: JumpFit;
  tails: TailFit;
  fund: FundTrack | null;
  /** Annual vol the new estimators would hand the case model. */
  modelVol: number;
  recentVol: number;
  diverge: boolean;
  flags: string[];
  sparkDates: string[];
  sparkVol: number[];
  sparkBeta: number[];
  factorBeta: number[];
  idioVariance: number;
  proposal: ModelProposal;
}

export interface ModelProposal {
  beta: number;
  betaMeasured: false;
  betaNote: string;
  idioSigma: number;
  studentDf: number;
  jumpProb: number;
  jumpMean: number;
  /** Annual Poisson intensity handed to the engine. The mean is one jump, not the aggregate. */
  jumpLambda: number;
  sectorBeta: number;
  marketSigma: number;
}

export interface RiskReport {
  asOf: string;
  names: NameCard[];
  market: string;
  marketHorizon: number;
  marketMonthly: number;
  marketDf: number;
  factors: FactorModel;
  book: BookRisk | null;
  coverage: CoverageReport[];
  flags: string[];
  note: string;
}

export interface BookRow {
  ticker: string;
  weight: number;
}

function spark(series: CleanSeries, market: CleanSeries | null): { dates: string[]; vol: number[]; beta: number[] } {
  const window = 63;
  const dates: string[] = [];
  const vol: number[] = [];
  const beta: number[] = [];
  const marketAt = market ? new Map(market.returnDates.map((date, index) => [date, market.returns[index]])) : null;
  for (let i = window; i <= series.returns.length; i += 5) {
    const slice = series.returns.slice(i - window, i);
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    let v = 0;
    for (const value of slice) v += (value - mean) ** 2;
    v /= slice.length - 1;
    dates.push(series.returnDates[i - 1]);
    vol.push(Math.sqrt(v * 252));
    if (!marketAt) {
      beta.push(NaN);
      continue;
    }
    const y: number[] = [];
    const x: number[] = [];
    for (let j = i - window; j < i; j++) {
      const m = marketAt.get(series.returnDates[j]);
      if (m === undefined) continue;
      y.push(series.returns[j]);
      x.push(m);
    }
    if (y.length < 10) {
      beta.push(NaN);
      continue;
    }
    const mx = x.reduce((s, v) => s + v, 0) / x.length;
    const my = y.reduce((s, v) => s + v, 0) / y.length;
    let num = 0;
    let den = 0;
    for (let k = 0; k < y.length; k++) {
      num += (x[k] - mx) * (y[k] - my);
      den += (x[k] - mx) ** 2;
    }
    beta.push(den > 0 ? num / den : NaN);
  }
  return { dates, vol, beta };
}

function proposal(vol: VolCard, beta: BetaCard | null, jumps: JumpFit, tails: TailFit, marketSigma: number): { model: ModelProposal; modelVol: number } {
  const raw = beta?.vasicek.beta ?? 1;
  const measured = beta?.preferred;
  const market = Number.isFinite(marketSigma) ? marketSigma : 0;
  const jumpSecond = Math.max(0, jumps.lambdaAnnual) * Math.max(0, jumps.meanSquare);
  const horizon = Number.isFinite(vol.horizon) ? vol.horizon : vol.realizedDaily;
  const idio2 = Math.max(0, horizon * horizon - raw * raw * market * market - jumpSecond);
  const modelVol = Math.sqrt(raw * raw * market * market + idio2 + jumpSecond);
  return {
    modelVol,
    model: {
      beta: raw,
      betaMeasured: false,
      betaNote: measured
        ? `Basket beta is ${beta?.vasicek.label ?? "Vasicek"}. ${measured.window} measured beta ${measured.beta.toFixed(2)} (SE ${measured.se.toFixed(2)}). Prior ${beta?.vasicek.prior.toFixed(2)}.`
        : "No market column, so there is no measured beta.",
      idioSigma: Math.sqrt(idio2),
      studentDf: tails.df,
      jumpProb: 0,
      jumpMean: jumps.mean,
      jumpLambda: Math.max(0, jumps.lambdaAnnual),
      sectorBeta: 0,
      marketSigma: market,
    },
  };
}

export function estimateFromSeries(
  series: CleanSeries[],
  book: BookRow[] = [],
  nonsyncExtra: string[] = [],
  options: { coverage?: boolean } = {},
): RiskReport {
  const market = series.find((row) => row.role === "market") ?? null;
  const fx = series.find((row) => row.role === "fx") ?? null;
  const taiwan = series.find((row) => row.role === "taiwan") ?? null;
  const assets = series.filter((row) => row.role === "asset" || row.role === "index");
  const asOf = series.reduce((latest, row) => {
    const end = row.dates[row.dates.length - 1] ?? "";
    return end > latest ? end : latest;
  }, "");

  const partialBetas = new Map<string, ReturnType<typeof betaAgainst>>();
  if (market) {
    for (const asset of assets) partialBetas.set(asset.ticker, betaAgainst(asset, market, isNonsync(asset, nonsyncExtra)));
  }
  const peerBetas = assets.map((asset) => ({
    ticker: asset.ticker,
    sector: asset.sector,
    beta: partialBetas.get(asset.ticker)?.daily.beta ?? NaN,
    se: partialBetas.get(asset.ticker)?.daily.se ?? NaN,
  }));

  const gapSizes = new Map<string, { gaps: boolean[]; sizes: number[] }>();
  for (const asset of assets) {
    const gaps = detectGaps(asset.returns, asset.events);
    gapSizes.set(asset.ticker, { gaps, sizes: asset.returns.filter((_, index) => gaps[index]) });
  }

  const marketVol = market ? volCard(market) : null;
  const marketSigma = marketVol?.horizon ?? marketVol?.realizedDaily ?? 0;
  const marketTail = market ? fitTail(market.returns, null, market.quality.ipoShort) : null;

  const cards: NameCard[] = assets.map((asset) => {
    const vol = volCard(asset);
    const partial = partialBetas.get(asset.ticker) ?? null;
    const beta = partial ? finishBeta(partial, sectorPrior(asset.ticker, asset.sector, peerBetas)) : null;
    const peers = assets.filter((other) => other.ticker !== asset.ticker && other.sector !== "" && other.sector === asset.sector);
    const pool: SectorJumpPool = {
      gaps: peers.reduce((sum, peer) => sum + (gapSizes.get(peer.ticker)?.sizes.length ?? 0), 0),
      sessions: peers.reduce((sum, peer) => sum + peer.returns.length, 0),
      sizes: peers.flatMap((peer) => gapSizes.get(peer.ticker)?.sizes ?? []),
    };
    const jumps = fitJumps({ series: asset, pool, realizedAnnual: vol.realizedDaily });
    const sectorReturns = peers.flatMap((peer) => peer.returns);
    const quietReturns = asset.returns.filter((_, index) => !jumps.isJump[index]);
    const tailSample = quietReturns.length >= 30 ? quietReturns : asset.returns;
    const fittedTail = fitTail(tailSample, sectorReturns, asset.quality.ipoShort);
    const tails =
      quietReturns.length >= 30 && quietReturns.length < asset.returns.length
        ? { ...fittedTail, note: `${fittedTail.note} Jump days were removed before the fit.` }
        : fittedTail;
    const benchmark = asset.benchmark ? series.find((row) => row.ticker === asset.benchmark) ?? market : asset.role === "index" ? market : null;
    const fund = asset.role === "index" || asset.benchmark ? (benchmark ? trackFund(asset, benchmark) : null) : null;
    const built = proposal(vol, beta, jumps, tails, marketSigma);
    const recent = Number.isFinite(vol.realized1y) ? vol.realized1y : vol.realizedDaily;
    const ratio = recent > 0 && built.modelVol > 0 ? Math.max(built.modelVol / recent, recent / built.modelVol) : NaN;
    const diverge = Number.isFinite(ratio) && ratio > DISAGREEMENT_RATIO;
    const flags: string[] = [];
    if (vol.disagreement) flags.push("estimators disagree");
    if (diverge) flags.push("model vol and recent realized vol diverge");
    if (asset.quality.ipoShort) flags.push("IPO-short history");
    if (jumps.volFlag) flags.push(jumps.volFlag);
    if (jumps.source === "class-fallback") flags.push(`jump class fallback: ${jumps.fallbackClass}`);
    if (jumps.source === "sector-pool") flags.push("jumps pooled from the sector");
    if (tails.source === "sector-pool") flags.push("tail pooled from the sector");
    if (asset.nonsync || isNonsync(asset, nonsyncExtra)) flags.push("Dimson lead/lag");
    const trace = spark(asset, market);
    return {
      ticker: asset.ticker,
      name: asset.ticker,
      sector: asset.sector,
      role: asset.role,
      nonsync: asset.nonsync || isNonsync(asset, nonsyncExtra),
      quality: asset.quality,
      vol,
      beta,
      jumps,
      tails,
      fund,
      modelVol: built.modelVol,
      recentVol: recent,
      diverge,
      flags,
      sparkDates: trace.dates,
      sparkVol: trace.vol,
      sparkBeta: trace.beta,
      factorBeta: [],
      idioVariance: jumps.diffusionVariance,
      proposal: built.model,
    };
  });

  const factors = factorCovariance({
    names: assets,
    market,
    fx,
    taiwan,
    jumpVariance: cards.map((card) => card.jumps.jumpVariance),
  });
  cards.forEach((card) => {
    const index = factors.names.indexOf(card.ticker);
    if (index >= 0) {
      card.factorBeta = factors.betas[index] ?? [];
      card.idioVariance = factors.idio[index] ?? card.idioVariance;
    }
  });

  const bookTickers = book.filter((row) => row.weight > 0).map((row) => row.ticker);
  const ordered = bookTickers.map((ticker) => cards.find((card) => card.ticker === ticker)).filter((card): card is NameCard => !!card);
  let portfolio: BookRisk | null = null;
  if (ordered.length > 0) {
    const indexOf = new Map(factors.names.map((ticker, index) => [ticker, index]));
    const indexes = ordered.map((card) => indexOf.get(card.ticker) ?? -1);
    const cov = indexes.map((row) => indexes.map((col) => (row >= 0 && col >= 0 ? factors.shrunk[row][col] : 0)));
    let factorVar = 0;
    const weightsRaw = ordered.map((card) => book.find((row) => row.ticker === card.ticker)?.weight ?? 0);
    const weightSum = weightsRaw.reduce((sum, weight) => sum + weight, 0);
    const weights = weightsRaw.map((weight) => (weightSum > 0 ? weight / weightSum : 0));
    if (factors.factorCov.length > 0) {
      const exposure = factors.factors.map((_, factor) => ordered.reduce((sum, card, i) => sum + weights[i] * (card.factorBeta[factor] ?? 0), 0));
      for (let a = 0; a < exposure.length; a++) {
        for (let b = 0; b < exposure.length; b++) factorVar += exposure[a] * factors.factorCov[a][b] * exposure[b];
      }
    }
    portfolio = bookRisk({
      tickers: ordered.map((card) => card.ticker),
      weights: weightsRaw,
      cov,
      betaRaw: ordered.map((card) => card.beta?.preferred.beta ?? NaN),
      betaWindow: ordered.map((card) => card.beta?.preferred.window ?? ""),
      betaShrunk: ordered.map((card) => card.beta?.vasicek.beta ?? NaN),
      idioVariance: ordered.map((card) => card.idioVariance),
      jumpVariance: ordered.map((card) => card.jumps.jumpVariance),
      factorVariance: Math.max(0, factorVar),
      largestGap: ordered.map((card) => {
        const returns = series.find((row) => row.ticker === card.ticker)?.returns ?? [];
        return returns.length ? Math.min(0, ...returns) : 0;
      }),
    });
  }

  const coverageTargets = options.coverage === false ? [] : ordered.length > 0 ? ordered.map((card) => card.ticker) : cards.map((card) => card.ticker);
  const coverage = coverageTargets.map((ticker) => {
    const row = series.find((item) => item.ticker === ticker);
    return row ? coverSeries(ticker, row.returnDates, row.returns) : coverSeries(ticker, [], []);
  });

  const flags = cards.filter((card) => card.flags.length > 0).map((card) => `${card.ticker}: ${card.flags.join("; ")}`);
  return {
    asOf,
    names: cards,
    market: market?.ticker ?? "",
    marketHorizon: marketSigma,
    marketMonthly: marketVol?.realizedMonthly ?? 0,
    marketDf: marketTail?.df ?? 5,
    factors,
    book: portfolio,
    coverage,
    flags,
    note: "Estimators describe the imported history. A Vasicek or Blume number is not a measured beta. Nothing here is a portfolio recommendation.",
  };
}

export function estimateFromCsv(text: string, book: BookRow[] = [], nonsyncExtra: string[] = []): RiskReport {
  return estimateFromSeries(cleanPrices(parsePriceCsv(text)), book, nonsyncExtra);
}

export function rowsOf(text: string): PriceRow[] {
  return parsePriceCsv(text);
}
