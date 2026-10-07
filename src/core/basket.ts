import type { BasketName } from "./types";

/**
 * Tickers and names from case-materials/satellite_candidates.pdf.
 * Every parameter below the name is a placeholder assumption, not a forecast and not a holding.
 * Weights start at 0, so the list does not enter the portfolio until the team types weights
 * and gives a sleeve the kind `basket`.
 */
const PLACEHOLDER =
  "Placeholder assumption, not a forecast. The ticker is from satellite_candidates.pdf. Beta, volatility, jumps, and FX are round numbers for the editor.";

type Seed = [ticker: string, name: string, sector: string, link: string, taiwan: boolean, fee?: number];

const SEEDS: Seed[] = [
  ["EWT", "iShares MSCI Taiwan ETF", "region", "Direct", true, 0.0059],
  ["FLTW", "Franklin FTSE Taiwan ETF", "region", "Direct", true, 0.0019],
  ["AAXJ", "iShares MSCI All Country Asia ex Japan ETF", "region", "Related", false, 0.0072],
  ["EWJ", "iShares MSCI Japan ETF", "region", "Related", false, 0.0049],
  ["TSM", "Taiwan Semiconductor Manufacturing (ADR)", "chips", "Direct", true],
  ["UMC", "United Microelectronics (ADR)", "chips", "Direct", true],
  ["ASX", "ASE Technology Holding (ADR)", "chips", "Direct", true],
  ["AAPL", "Apple", "chips", "Related", false],
  ["SONY", "Sony Group (ADR)", "chips", "Related", false],
  ["ADBE", "Adobe", "software", "Direct", false],
  ["FIG", "Figma", "software", "Direct", false],
  ["ADSK", "Autodesk", "software", "Related", false],
  ["U", "Unity Software", "software", "Related", false],
  ["WIX", "Wix.com", "software", "Related", false],
  ["NWSA", "News Corp (Class A)", "media", "Direct", false],
  ["WBTN", "WEBTOON Entertainment", "media", "Direct", false],
  ["SCHL", "Scholastic", "media", "Direct", false],
  ["WLY", "John Wiley & Sons", "media", "Related", false],
  ["DIS", "Walt Disney", "media", "Related", false],
  ["NFLX", "Netflix", "media", "Related", false],
  ["SPOT", "Spotify", "media", "Related", false],
  ["HAS", "Hasbro", "media", "Related", false],
  ["LYV", "Live Nation Entertainment", "media", "Related", false],
  ["GOOGL", "Alphabet", "internet", "Related", false],
  ["AMZN", "Amazon", "internet", "Related", false],
  ["PINS", "Pinterest", "internet", "Related", false],
  ["ETSY", "Etsy", "internet", "Direct", false],
  ["SHOP", "Shopify", "internet", "Direct", false],
  ["DUOL", "Duolingo", "education", "Direct", false],
  ["COUR", "Coursera", "education", "Direct", false],
  ["PSO", "Pearson (ADR)", "education", "Related", false],
  ["LRN", "Stride", "education", "Related", false],
  ["BFAM", "Bright Horizons", "education", "Related", false],
  ["ABNB", "Airbnb", "travel", "Related", false],
  ["MAR", "Marriott International", "travel", "Related", false],
  ["BKNG", "Booking Holdings", "travel", "Related", false],
  ["V", "Visa", "payments", "Related", false],
  ["PYPL", "PayPal", "payments", "Related", false],
  ["XYZ", "Block (formerly SQ)", "payments", "Related", false],
  ["INTU", "Intuit", "payments", "Related", false],
  ["XLF", "Financial Select Sector SPDR", "financials", "Diversifier", false, 0.0008],
  ["CHT", "Chunghwa Telecom (ADR)", "telecom", "Direct", true],
  ["XLU", "Utilities Select Sector SPDR", "utilities", "Diversifier", false, 0.0008],
  ["NWL", "Newell Brands", "staples", "Direct", false],
  ["XLP", "Consumer Staples Select Sector SPDR", "staples", "Diversifier", false, 0.0008],
  ["VNQ", "Vanguard Real Estate ETF", "real_estate", "Related", false, 0.0013],
  ["XLV", "Health Care Select Sector SPDR", "health", "Diversifier", false, 0.0008],
  ["XLE", "Energy Select Sector SPDR", "energy", "Diversifier", false, 0.0008],
  ["XLI", "Industrial Select Sector SPDR", "industrials", "Diversifier", false, 0.0008],
  ["XLB", "Materials Select Sector SPDR", "industrials", "Diversifier", false, 0.0008],
  ["GM", "General Motors", "industrials", "Diversifier", false],
  ["LOPE", "Grand Canyon Education", "education", "Related", false],
  ["NVDA", "NVIDIA", "chips", "Related", false],
  ["MU", "Micron Technology", "chips", "Related", false],
  ["SNDK", "SanDisk", "chips", "Diversifier", false],
  ["DELL", "Dell Technologies", "chips", "Diversifier", false],
  ["MSFT", "Microsoft", "software", "Related", false],
  ["JPM", "JPMorgan Chase", "financials", "Diversifier", false],
  ["BAC", "Bank of America", "financials", "Diversifier", false],
  ["WFC", "Wells Fargo", "financials", "Diversifier", false],
  ["BRK-B", "Berkshire Hathaway (Class B)", "financials", "Diversifier", false],
  ["AWK", "American Water Works", "utilities", "Diversifier", false],
  ["XYL", "Xylem", "utilities", "Diversifier", false],
  ["PHO", "Invesco Water Resources ETF", "utilities", "Diversifier", false],
  ["BUD", "Anheuser-Busch InBev (ADR)", "staples", "Diversifier", false],
  ["CSCO", "Cisco Systems", "telecom", "Diversifier", false],
  ["NOK", "Nokia (ADR)", "telecom", "Diversifier", false],
  ["SPYM", "State Street SPDR Portfolio S&P 500 ETF", "broad", "Diversifier", false],
];

function isFund(ticker: string, sector: string): boolean {
  return sector === "region" || sector === "broad" || ticker.startsWith("XL") || ticker === "VNQ" || ticker === "PHO" || ticker === "SPYM";
}

export function satelliteCatalog(): BasketName[] {
  return SEEDS.map(([ticker, name, sector, link, taiwan, fee]) => {
    const fund = isFund(ticker, sector);
    return {
      id: ticker.toLowerCase(),
      ticker,
      name,
      sector,
      linkNote: link,
      taiwan,
      alpha: 0,
      beta: 1,
      idioSigma: fund ? 0.18 : 0.35,
      studentDf: 5,
      jumpProb: fund ? 0.01 : 0.02,
      jumpMean: -0.25,
      fxSigma: taiwan ? 0.08 : 0,
      geoJumpProb: taiwan ? 0.01 : 0,
      geoJumpMean: -0.15,
      sectorBeta: 1,
      weight: 0,
      expenseRatio: fee ?? 0,
      assumptionNote: fee
        ? `${PLACEHOLDER} Expense ratio ${fee} is the fee cited for this fund in that list.`
        : PLACEHOLDER,
    };
  });
}

export function blankName(ticker = "NEW"): BasketName {
  return {
    id: `name-${ticker.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`,
    ticker,
    name: "Name (label only)",
    sector: "broad",
    linkNote: "Team",
    taiwan: false,
    alpha: 0,
    beta: 1,
    idioSigma: 0,
    studentDf: 5,
    jumpProb: 0,
    jumpMean: 0,
    fxSigma: 0,
    geoJumpProb: 0,
    geoJumpMean: 0,
    sectorBeta: 0,
    weight: 0,
    expenseRatio: 0,
    assumptionNote: "Team-added row. Parameters are assumptions, not forecasts.",
  };
}
