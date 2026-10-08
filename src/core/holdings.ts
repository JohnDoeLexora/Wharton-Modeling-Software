/**
 * Holdings, competition rules, and a trade sheet.
 * Defaults follow the 2026 WInS Trading Details note the team was given:
 * $300,000 starting capital, stocks at or above $5, any WInS ETF, WInS
 * Treasury bonds for the US, UK, Germany, France, Italy, and the Netherlands,
 * at most 200 trades, each order at most 2× that security's average daily
 * volume, and no shorting or margin. Every one of those is editable.
 * Nothing in this file is a recommended holding.
 */

export type InstrumentKind = "stock" | "etf" | "bond";

export type BondCountry = "US" | "UK" | "DE" | "FR" | "IT" | "NL";

export const BOND_COUNTRIES: BondCountry[] = ["US", "UK", "DE", "FR", "IT", "NL"];

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  sleeve: string;
  /** Share of capital. 0.25 is 25%. Negative is a short and fails the rules. */
  weight: number;
  kind: InstrumentKind;
  country: BondCountry | "";
  rationale: string;
  /** Editable Trading Note draft. Empty until the team writes one. */
  tradeNote?: string;
}

export interface MarketRow {
  ticker: string;
  price: number;
  avgDailyVolume: number | null;
  asOf: string;
  kind: InstrumentKind;
  /** Clean price per 100 face. Bonds only. */
  cleanPrice: number | null;
  /** Accrued interest per 100 face. Bonds only. */
  accrued: number | null;
  coupon: number | null;
  maturity: string;
  name: string;
}

export interface RulesConfig {
  startingCapital: number;
  minStockPrice: number;
  maxTrades: number;
  volumeMultiple: number;
  allowShort: boolean;
  allowMargin: boolean;
  bondCountries: BondCountry[];
  /** Face purchased in this increment. Dirty price is applied per increment. */
  faceIncrement: number;
  etfsAllowed: boolean;
  bondsAllowed: boolean;
  /** Source shown next to the form. Not a second set of rules. */
  source: string;
}

export interface SleeveTotal {
  sleeve: string;
  weight: number;
}

export interface OrderCheck {
  id: string;
  ok: boolean;
  reason: string;
}

export interface TradeOrder {
  order: number;
  action: "BUY";
  ticker: string;
  name: string;
  sleeve: string;
  kind: InstrumentKind;
  targetWeight: number;
  qtyOrFace: string;
  qty: number;
  price: number;
  priceBasis: string;
  amount: number;
  actualWeight: number;
  check: OrderCheck;
  rationale: string;
}

export interface TradeSheet {
  orders: TradeOrder[];
  cash: number;
  total: number;
  capital: number;
  balanced: boolean;
  checks: OrderCheck[];
  bookErrors: string[];
}

export function defaultRules(): RulesConfig {
  return {
    startingCapital: 300_000,
    minStockPrice: 5,
    maxTrades: 200,
    volumeMultiple: 2,
    allowShort: false,
    allowMargin: false,
    bondCountries: [...BOND_COUNTRIES],
    faceIncrement: 1_000,
    etfsAllowed: true,
    bondsAllowed: true,
    source: "2026 WInS Trading Details email. Editable. Not a portfolio.",
  };
}

export function blankHolding(id = "h1"): Holding {
  return { id, ticker: "", name: "", sleeve: "", weight: 0, kind: "stock", country: "", rationale: "" };
}

export function sleeveTotals(holdings: Holding[]): SleeveTotal[] {
  const map = new Map<string, number>();
  for (const row of holdings) {
    const key = row.sleeve.trim() || "(no sleeve)";
    map.set(key, (map.get(key) ?? 0) + (Number.isFinite(row.weight) ? row.weight : 0));
  }
  return [...map.entries()].map(([sleeve, weight]) => ({ sleeve, weight }));
}

export function weightSum(holdings: Holding[]): number {
  return holdings.reduce((sum, row) => sum + (Number.isFinite(row.weight) ? row.weight : 0), 0);
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

function dollars(centsValue: number): number {
  return centsValue / 100;
}

export function dirtyPerHundred(row: MarketRow): number | null {
  if (row.cleanPrice === null || !Number.isFinite(row.cleanPrice)) return null;
  const accrued = row.accrued ?? 0;
  if (!Number.isFinite(accrued)) return null;
  return row.cleanPrice + accrued;
}

export interface HoldingDiff {
  ticker: string;
  kind: "added" | "removed" | "changed" | "same";
  before: number | null;
  after: number | null;
  sleeve: string;
}

export function diffHoldings(before: Holding[], after: Holding[]): HoldingDiff[] {
  const key = (row: Holding) => row.ticker.trim().toUpperCase() || row.id;
  const left = new Map(before.map((row) => [key(row), row]));
  const right = new Map(after.map((row) => [key(row), row]));
  const keys = [...new Set([...left.keys(), ...right.keys()])];
  return keys.map((id) => {
    const a = left.get(id);
    const b = right.get(id);
    if (a && !b) return { ticker: a.ticker || id, kind: "removed" as const, before: a.weight, after: null, sleeve: a.sleeve };
    if (!a && b) return { ticker: b.ticker || id, kind: "added" as const, before: null, after: b.weight, sleeve: b.sleeve };
    const changed = Math.abs((a?.weight ?? 0) - (b?.weight ?? 0)) > 1e-8 || a?.sleeve !== b?.sleeve || a?.kind !== b?.kind;
    return {
      ticker: b?.ticker || a?.ticker || id,
      kind: changed ? ("changed" as const) : ("same" as const),
      before: a?.weight ?? null,
      after: b?.weight ?? null,
      sleeve: b?.sleeve || a?.sleeve || "",
    };
  });
}

function marketFor(ticker: string, market: MarketRow[]): MarketRow | undefined {
  const want = ticker.trim().toUpperCase();
  return market.find((row) => row.ticker.trim().toUpperCase() === want);
}

function fail(id: string, reason: string): OrderCheck {
  return { id, ok: false, reason };
}

function pass(id: string, reason: string): OrderCheck {
  return { id, ok: true, reason };
}

export function checkOrder(args: {
  holding: Holding;
  qty: number;
  price: number;
  amount: number;
  rules: RulesConfig;
  market: MarketRow | undefined;
  orderCount: number;
}): OrderCheck {
  const { holding, qty, price, amount, rules, market, orderCount } = args;
  const id = holding.id;
  if (!holding.ticker.trim()) return fail(id, "Ticker is empty.");
  if (holding.weight < 0 || qty < 0) return fail(id, "Shorting is not allowed.");
  if (!rules.allowShort && holding.weight < 0) return fail(id, "Shorting is not allowed.");
  if (holding.kind === "stock") {
    if (!(price >= rules.minStockPrice)) return fail(id, `Stock price is below the $${rules.minStockPrice} minimum.`);
  } else if (holding.kind === "etf") {
    if (!rules.etfsAllowed) return fail(id, "ETFs are turned off in the rules.");
  } else {
    if (!rules.bondsAllowed) return fail(id, "Bonds are turned off in the rules.");
    if (!rules.bondCountries.includes(holding.country as BondCountry)) {
      return fail(id, "Bond is not a WInS treasury (US, UK, DE, FR, IT, NL).");
    }
  }
  if (!(price > 0)) return fail(id, "Missing price.");
  if (orderCount > rules.maxTrades) return fail(id, `More than the trade limit of ${rules.maxTrades}.`);
  if (amount - rules.startingCapital > 0.001) return fail(id, "Notional exceeds capital. No margin.");
  if (holding.kind !== "bond") {
    const volume = market?.avgDailyVolume;
    if (volume === null || volume === undefined || !(volume > 0)) return fail(id, "No average daily volume on the snapshot.");
    const limit = rules.volumeMultiple * volume;
    if (qty > limit + 1e-9) return fail(id, `Order exceeds ${rules.volumeMultiple}× average daily volume.`);
    return pass(id, `PASS: ${qty} sh vs ${rules.volumeMultiple}× volume = ${Math.round(limit).toLocaleString("en-US")} sh.`);
  }
  return pass(id, "PASS: WInS treasury. Face is in the increment set on the rules. Volume rule is for listed shares.");
}

export function buildTradeSheet(holdings: Holding[], market: MarketRow[], rules: RulesConfig): TradeSheet {
  const bookErrors: string[] = [];
  const capitalCents = cents(rules.startingCapital);
  if (!(rules.startingCapital > 0) || capitalCents <= 0) bookErrors.push("Starting capital must be positive.");
  const sum = weightSum(holdings);
  if (sum > 1 + 1e-6 && !rules.allowMargin) bookErrors.push("Weights sum to more than 100%. No margin. Orders are capped at capital.");
  if (holdings.filter((row) => row.weight > 0 && row.ticker.trim()).length > rules.maxTrades) {
    bookErrors.push(`More than ${rules.maxTrades} trades.`);
  }

  const active = holdings.filter((row) => row.ticker.trim() && row.weight > 0);
  const positive = active.reduce((total, row) => total + row.weight, 0);
  let spent = 0;
  const orders: TradeOrder[] = [];
  active.forEach((holding, index) => {
    const quote = marketFor(holding.ticker, market);
    const share = positive > 0 ? holding.weight / positive : 0;
    const targetCents = index === active.length - 1 ? capitalCents - spent : Math.min(capitalCents - spent, Math.round(share * capitalCents));
    const budgetCents = Math.max(0, Math.min(targetCents, capitalCents - spent));
    let qty = 0;
    let spentCents = 0;
    let price = quote?.price ?? Number.NaN;
    let priceBasis = quote?.asOf ? quote.asOf : "No snapshot row.";
    let qtyLabel = "0";
    if (holding.kind === "bond") {
      const dirty = quote ? dirtyPerHundred(quote) : null;
      const lot = rules.faceIncrement > 0 ? rules.faceIncrement : 1_000;
      const lotCents = dirty === null ? 0 : Math.round((dirty * lot) / 100 * 100);
      price = dirty === null ? Number.NaN : (lotCents / 100) * (100 / lot);
      const lots = lotCents > 0 ? Math.floor(budgetCents / lotCents) : 0;
      qty = lots * lot;
      spentCents = lots * lotCents;
      qtyLabel = `$${qty.toLocaleString("en-US")} face`;
      priceBasis = dirty === null ? "Missing clean price or accrued interest." : `Dirty ${dirty.toFixed(2)} per 100 face.`;
      price = dirty ?? Number.NaN;
    } else {
      const priceCents = Number.isFinite(price) ? cents(price) : 0;
      qty = priceCents > 0 ? Math.floor(budgetCents / priceCents) : 0;
      spentCents = qty * priceCents;
      qtyLabel = String(qty);
      if (!quote) priceBasis = "Missing snapshot row.";
    }
    spent += spentCents;
    const amount = dollars(spentCents);
    const check = checkOrder({
      holding,
      qty,
      price: Number.isFinite(price) ? price : 0,
      amount,
      rules,
      market: quote,
      orderCount: index + 1,
    });
    orders.push({
      order: index + 1,
      action: "BUY",
      ticker: holding.ticker.trim(),
      name: holding.name || quote?.name || "",
      sleeve: holding.sleeve,
      kind: holding.kind,
      targetWeight: holding.weight,
      qtyOrFace: qtyLabel,
      qty,
      price: Number.isFinite(price) ? price : 0,
      priceBasis,
      amount,
      actualWeight: capitalCents > 0 ? spentCents / capitalCents : 0,
      check,
      rationale: holding.rationale,
    });
  });

  const cash = dollars(capitalCents - spent);
  const total = dollars(spent) + cash;
  const balanced = Math.abs(total - rules.startingCapital) < 0.001 && cash >= -0.001 && dollars(spent) <= rules.startingCapital + 0.001;
  if (!balanced) bookErrors.push("Trade sheet does not add up to the starting capital.");
  if (cash < -0.001) bookErrors.push("Leftover cash is negative. That would be margin.");
  return {
    orders,
    cash,
    total,
    capital: rules.startingCapital,
    balanced,
    checks: orders.map((order) => order.check),
    bookErrors,
  };
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function holdingsToCsv(holdings: Holding[]): string {
  const header = "ticker,name,sleeve,weight,kind,country,rationale,trade_note";
  const rows = holdings.map((row) =>
    [row.ticker, row.name, row.sleeve, row.weight, row.kind, row.country, row.rationale, row.tradeNote ?? ""].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

function headerIndex(header: string[], names: string[]): number {
  const lowered = header.map((cell) => cell.trim().toLowerCase());
  return names.map((name) => lowered.indexOf(name)).find((index) => index >= 0) ?? -1;
}

export function holdingsFromCsv(text: string): Holding[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const ticker = headerIndex(header, ["ticker", "ticker_or_bond"]);
  const name = headerIndex(header, ["name"]);
  const sleeve = headerIndex(header, ["sleeve"]);
  const weight = headerIndex(header, ["weight", "target_weight", "target_weight_pct"]);
  const kind = headerIndex(header, ["kind"]);
  const country = headerIndex(header, ["country"]);
  const rationale = headerIndex(header, ["rationale"]);
  const tradeNote = headerIndex(header, ["trade_note", "note"]);
  const body = ticker >= 0 ? rows.slice(1) : rows;
  const weightCol = ticker >= 0 ? weight : 3;
  const numbers = body.map((row) => Number(row[weightCol] ?? "")).filter((value) => Number.isFinite(value));
  const asPercent = numbers.some((value) => Math.abs(value) > 1);
  return body
    .map((row, index) => {
      const rawWeight = Number(row[ticker >= 0 ? weight : 3] ?? "0");
      const parsedKind = (row[ticker >= 0 ? kind : 4] ?? "stock").trim().toLowerCase();
      const instrument: InstrumentKind = parsedKind === "bond" ? "bond" : parsedKind === "etf" ? "etf" : "stock";
      const rawCountry = (row[ticker >= 0 ? country : 5] ?? "").trim().toUpperCase();
      const countryCode: BondCountry | "" = (BOND_COUNTRIES as readonly string[]).includes(rawCountry)
        ? (rawCountry as BondCountry)
        : "";
      return {
        id: `h${index + 1}`,
        ticker: (row[ticker >= 0 ? ticker : 0] ?? "").trim(),
        name: (row[ticker >= 0 ? name : 1] ?? "").trim(),
        sleeve: (row[ticker >= 0 ? sleeve : 2] ?? "").trim(),
        weight: Number.isFinite(rawWeight) ? (asPercent ? rawWeight / 100 : rawWeight) : 0,
        kind: instrument,
        country: countryCode,
        rationale: (row[ticker >= 0 ? rationale : 6] ?? "").trim(),
        tradeNote: tradeNote >= 0 ? (row[tradeNote] ?? "").trim() : "",
      };
    })
    .filter((row) => row.ticker !== "" || row.name !== "");
}

export function marketFromCsv(text: string): MarketRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const body = idx("ticker") >= 0 ? rows.slice(1) : rows;
  const col = (row: string[], name: string, fallback: number) => row[(idx(name) >= 0 ? idx(name) : fallback)] ?? "";
  return body
    .map((row) => {
      const kindRaw = col(row, "kind", 4).trim().toLowerCase();
      const kind: InstrumentKind = kindRaw === "bond" ? "bond" : kindRaw === "etf" ? "etf" : "stock";
      const volume = Number(col(row, "avg_daily_volume", 2));
      const clean = Number(col(row, "clean_price", 5));
      const accrued = Number(col(row, "accrued", 6));
      const coupon = Number(col(row, "coupon", 7));
      return {
        ticker: col(row, "ticker", 0).trim(),
        price: Number(col(row, "price", 1)),
        avgDailyVolume: Number.isFinite(volume) && volume > 0 ? volume : null,
        asOf: col(row, "as_of", 3).trim(),
        kind,
        cleanPrice: Number.isFinite(clean) ? clean : null,
        accrued: Number.isFinite(accrued) ? accrued : null,
        coupon: Number.isFinite(coupon) ? coupon : null,
        maturity: col(row, "maturity", 8).trim(),
        name: col(row, "name", 9).trim(),
      };
    })
    .filter((row) => row.ticker !== "");
}

export function tradeSheetToCsv(sheet: TradeSheet): string {
  const header = "order,action,ticker_or_bond,name,sleeve,target_weight_pct,qty_or_face,est_price,price_basis,est_amount_usd,actual_weight_pct,volume_rule_check,rationale";
  const lines = sheet.orders.map((order) =>
    [
      order.order,
      order.action,
      order.ticker,
      order.name,
      order.sleeve,
      (order.targetWeight * 100).toFixed(2),
      order.qtyOrFace,
      order.price ? order.price.toFixed(2) : "",
      order.priceBasis,
      order.amount.toFixed(2),
      (order.actualWeight * 100).toFixed(2),
      order.check.ok ? order.check.reason : `FAIL: ${order.check.reason}`,
      order.rationale,
    ]
      .map(csvEscape)
      .join(","),
  );
  lines.push(["", "", "CASH", "Leftover cash", "Cash", "", "", "", "", sheet.cash.toFixed(2), ((sheet.cash / sheet.capital) * 100).toFixed(2), "", ""].join(","));
  lines.push(["", "", "TOTAL", "", "", "", "", "", "", sheet.total.toFixed(2), "100.00", "", ""].join(","));
  return [header, ...lines].join("\n") + "\n";
}

export function standardErrorProbability(p: number, n: number): number | null {
  if (!(n > 0) || !Number.isFinite(p)) return null;
  return Math.sqrt((p * (1 - p)) / n);
}
