import { weightsAtYear } from "../core/glide";
import type { Assumptions, MixSpec } from "../core/types";
import { useStore } from "../state";
import { PercentField } from "./fields";

export function MixEditor() {
  const { assumptions, update } = useStore();
  return (
    <section className="card" id="compare-mixes">
      <div className="section-row">
        <h3>Mixes to compare</h3>
        <div className="row-actions">
          <button type="button" className="ghost" disabled={assumptions.mixes.length >= 8} onClick={() => update(addMix)}>
            Add the current glide as a mix
          </button>
        </div>
      </div>
      <p className="muted">
        Each mix is a two-knot glide, scored with this master seed and the same streams as the workspace. That is
        common random numbers: the shocks do not get a fresh seed because you added a row. At most 8 mixes. An empty
        list leaves the main sample unchanged.
      </p>
      {assumptions.mixes.length === 0 ? (
        <p className="muted">No comparison mixes yet. The projection tab will show a table once you add one.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption>Comparison glides. Weights are shares of the portfolio at that date.</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Year</th>
                {assumptions.sleeves.map((sleeve) => (
                  <th key={sleeve.id}>{sleeve.name}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assumptions.mixes.map((mix, mixIndex) => (
                <MixRows key={mix.id} mix={mix} mixIndex={mixIndex} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MixRows({ mix, mixIndex }: { mix: MixSpec; mixIndex: number }) {
  const { assumptions, update } = useStore();
  const years: { label: string; key: "weights2027" | "weights2033" }[] = [
    { label: "2027", key: "weights2027" },
    { label: "2033", key: "weights2033" },
  ];
  return (
    <>
      {years.map((year, yearIndex) => (
        <tr key={`${mix.id}-${year.key}`}>
          <td>
            {yearIndex === 0 ? (
              <input
                aria-label={`Mix ${mixIndex + 1} name`}
                value={mix.name}
                onChange={(event) =>
                  update((a) => ({
                    ...a,
                    mixes: a.mixes.map((item, index) => (index === mixIndex ? { ...item, name: event.target.value } : item)),
                  }))
                }
              />
            ) : null}
          </td>
          <td>{year.label}</td>
          {assumptions.sleeves.map((sleeve, sleeveIndex) => (
            <td key={sleeve.id}>
              <PercentField
                bare
                label={`${mix.name} ${year.label} ${sleeve.name}`}
                value={mix[year.key][sleeveIndex] ?? 0}
                onChange={(next) =>
                  update((a) => ({
                    ...a,
                    mixes: a.mixes.map((item, index) => {
                      if (index !== mixIndex) return item;
                      const weights = item[year.key].slice();
                      weights[sleeveIndex] = next;
                      return { ...item, [year.key]: weights };
                    }),
                  }))
                }
              />
            </td>
          ))}
          <td>
            {yearIndex === 0 ? (
              <button
                type="button"
                className="text"
                onClick={() => update((a) => ({ ...a, mixes: a.mixes.filter((_, index) => index !== mixIndex) }))}
              >
                Remove
              </button>
            ) : null}
          </td>
        </tr>
      ))}
    </>
  );
}

function addMix(assumptions: Assumptions): Assumptions {
  if (assumptions.mixes.length >= 8) return assumptions;
  const id = `mix-${Math.random().toString(36).slice(2, 7)}`;
  return {
    ...assumptions,
    mixes: [
      ...assumptions.mixes,
      {
        id,
        name: "Comparison mix",
        weights2027: weightsAtYear(assumptions.glide, 2027),
        weights2033: weightsAtYear(assumptions.glide, 2033),
      },
    ],
  };
}
