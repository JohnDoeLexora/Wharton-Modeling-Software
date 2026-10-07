import { useState } from "react";
import { satelliteCatalog, blankName } from "../core/basket";
import type { BasketName } from "../core/types";
import { useStore } from "../state";
import { NumberField, PercentField } from "./fields";
import { num } from "./format";

export function BasketEditor() {
  const { assumptions, output, update } = useStore();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = assumptions.basket.filter((name) => {
    if (!needle) return true;
    return (
      name.ticker.toLowerCase().includes(needle) ||
      name.name.toLowerCase().includes(needle) ||
      name.sector.toLowerCase().includes(needle) ||
      name.linkNote.toLowerCase().includes(needle)
    );
  });

  return (
    <section className="card" id="satellite-basket">
      <div className="section-row">
        <h3>Satellite basket</h3>
        <div className="row-actions">
          <button type="button" className="ghost" onClick={() => update((a) => ({ ...a, basket: [...a.basket, blankName()] }))}>
            Add ticker
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => update((a) => ({ ...a, basket: a.basket.map((name) => ({ ...name, weight: 0 })) }))}
          >
            Set weights to 0
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (window.confirm("Replace the basket with the candidate list? Typed weights and parameter edits on those rows are discarded.")) {
                update((a) => ({ ...a, basket: satelliteCatalog() }));
              }
            }}
          >
            Reload candidate list
          </button>
        </div>
      </div>
      <p className="muted">
        Tickers are prefilled from <code>case-materials/satellite_candidates.pdf</code>. Beta, idiosyncratic volatility,
        jumps, FX, and fees are placeholder assumptions, not forecasts and not a holding list. A weight of 0 keeps the
        name on the list and out of the return. The basket affects wealth only through a sleeve whose pricing is
        “Satellite basket” and whose glide weight is positive. Effective N is {num(output.views.basketEffectiveN, 2)}{" "}
        from {output.views.basketHeld} names with a positive weight.
      </p>
      <label className="field wide">
        <span>Filter the list</span>
        <input
          aria-label="Filter basket tickers"
          value={query}
          placeholder="Ticker, name, or sector"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="scroll-box">
        <table>
          <caption>Editable single-name assumptions. Placeholder parameters are not forecasts.</caption>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Sector</th>
              <th>Link</th>
              <th>Weight</th>
              <th>β</th>
              <th>Idio σ</th>
              <th>FX σ</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((name) => {
              const index = assumptions.basket.findIndex((row) => row.id === name.id);
              return (
                <tr key={name.id}>
                  <td>
                    <input
                      aria-label={`${name.ticker} ticker`}
                      value={name.ticker}
                      onChange={(event) => update((a) => ({ ...a, ...patchName(a.basket, index, { ticker: event.target.value }) }))}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${name.ticker} name`}
                      value={name.name}
                      onChange={(event) => update((a) => ({ ...a, ...patchName(a.basket, index, { name: event.target.value }) }))}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${name.ticker} sector`}
                      value={name.sector}
                      onChange={(event) => update((a) => ({ ...a, ...patchName(a.basket, index, { sector: event.target.value }) }))}
                    />
                  </td>
                  <td>{name.linkNote}</td>
                  <td>
                    <NumberField
                      bare
                      label={`${name.ticker} relative weight`}
                      value={name.weight}
                      step="0.1"
                      onChange={(weight) => update((a) => ({ ...a, ...patchName(a.basket, index, { weight }) }))}
                    />
                  </td>
                  <td>
                    <NumberField
                      bare
                      label={`${name.ticker} beta`}
                      value={name.beta}
                      step="0.1"
                      onChange={(beta) => update((a) => ({ ...a, ...patchName(a.basket, index, { beta }) }))}
                    />
                  </td>
                  <td>
                    <PercentField
                      bare
                      label={`${name.ticker} idiosyncratic volatility`}
                      value={name.idioSigma}
                      onChange={(idioSigma) => update((a) => ({ ...a, ...patchName(a.basket, index, { idioSigma }) }))}
                    />
                  </td>
                  <td>
                    <PercentField
                      bare
                      label={`${name.ticker} FX volatility`}
                      value={name.fxSigma}
                      onChange={(fxSigma) => update((a) => ({ ...a, ...patchName(a.basket, index, { fxSigma }) }))}
                    />
                  </td>
                  <td className="note-cell">
                    <input
                      aria-label={`${name.ticker} assumption note`}
                      value={name.assumptionNote}
                      onChange={(event) => update((a) => ({ ...a, ...patchName(a.basket, index, { assumptionNote: event.target.value }) }))}
                    />
                    {name.taiwan ? <span className="sub">Taiwan name: FX and geopolitical jump fields apply.</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Showing {rows.length} of {assumptions.basket.length} rows. Idiosyncratic shocks, jumps, and FX use stream 6.
        Sector shocks use the sector label. The note on each row is stored with the assumptions.
      </p>
    </section>
  );
}

function patchName(basket: BasketName[], index: number, patch: Partial<BasketName>): { basket: BasketName[] } {
  return {
    basket: basket.map((name, nameIndex) => (nameIndex === index ? { ...name, ...patch } : name)),
  };
}
