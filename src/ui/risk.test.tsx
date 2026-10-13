import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import pricesExample from "../../examples/daily-prices-sample.csv?raw";
import bookExample from "../../examples/risk-book.csv?raw";
import { estimateFromCsv } from "../core/risk/assemble";
import { compareMethods } from "../core/risk/compare";
import { bookFromCsv } from "../core/risk/fixture";
import { RiskView } from "./RiskPanel";

const idle = {
  report: null,
  comparison: null,
  selected: "",
  busy: "",
  note: "",
  copyNote: "",
  onSelect: () => {},
  onLoadExample: () => {},
  onImportPrices: () => {},
  onImportBook: () => {},
  onCompare: () => {},
  onCopy: () => {},
  onNote: () => {},
};

describe("risk screen", () => {
  it("keeps the three regions on an empty book", () => {
    const html = renderToStaticMarkup(<RiskView {...idle} />);
    expect(html).toContain('id="risk-card"');
    expect(html).toContain('id="risk-screen"');
    expect(html).toContain('id="risk-backtest"');
    expect(html).toContain('id="load-risk-example"');
    expect(html.toLowerCase()).not.toContain("we recommend");
  });

  it("shows estimators, the divergence banner, and the coverage winner", () => {
    const book = bookFromCsv(bookExample);
    expect(book.find((row) => row.ticker === "GAP")?.weight).toBeCloseTo(0.4);
    const report = estimateFromCsv(pricesExample, book);
    const comparison = compareMethods(report, 50, 42);
    const gap = report.names.find((card) => card.ticker === "GAP");
    const html = renderToStaticMarkup(
      <RiskView
        {...idle}
        report={report}
        comparison={comparison}
        selected="GAP"
        note={gap?.beta?.citation ?? ""}
      />,
    );
    expect(html).toContain('id="vol-divergence-banner"');
    expect(html).toContain("not measured");
    expect(html).toContain("Vasicek shrunk (not measured)");
    expect(html).toMatch(/beta .+ \(SE .+\)/);
    expect(html).toContain("old monthly + Blume + jump class");
    expect(html).toContain("new horizon + Vasicek + fitted jumps");
    expect(html).toContain(report.coverage[0]?.winner ?? "winner");
    expect(html.toLowerCase()).not.toContain("we recommend");
  });
});
