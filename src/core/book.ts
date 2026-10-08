/**
 * Turn a holdings list into assumption weights.
 * Sleeve names that match an existing sleeve keep that sleeve's assumptions.
 * Other sleeves are new parametric rows at zero μ and σ. This does not
 * invent a portfolio. An empty list leaves the assumptions alone.
 */

import { newSleeve } from "./defaults";
import type { Assumptions, Sleeve } from "./types";
import type { Holding } from "./holdings";
import { weightSum } from "./holdings";

function slug(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "sleeve";
}

function matchSleeve(name: string, sleeves: Sleeve[]): Sleeve | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return sleeves.find((sleeve) => {
    const id = sleeve.id.toLowerCase();
    const label = sleeve.name.toLowerCase();
    return id === needle || label === needle || label.includes(needle) || needle.includes(id);
  });
}

export function assumptionsFromHoldings(base: Assumptions, holdings: Holding[]): Assumptions {
  const usable = holdings.filter((row) => row.sleeve.trim() && Number.isFinite(row.weight) && row.weight > 0);
  if (usable.length === 0 || !(weightSum(usable) > 0)) return base;
  const names: string[] = [];
  for (const row of usable) {
    if (!names.some((name) => name.toLowerCase() === row.sleeve.trim().toLowerCase())) names.push(row.sleeve.trim());
  }
  const sleeves = names.map((name) => {
    const existing = matchSleeve(name, base.sleeves);
    if (existing) return { ...existing, name: existing.name };
    return newSleeve(slug(name), name);
  });
  const raw = names.map((name) =>
    usable.filter((row) => row.sleeve.trim().toLowerCase() === name.toLowerCase()).reduce((sum, row) => sum + row.weight, 0),
  );
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  const weights = raw.map((weight) => (total > 0 ? weight / total : 0));
  const correlation = sleeves.map((_, i) => sleeves.map((__, j) => (i === j ? 1 : 0)));
  return {
    ...base,
    tag: "edited",
    sleeves,
    glide: [
      { year: 2027, weights: weights.slice() },
      { year: 2033, weights: weights.slice() },
    ],
    correlation,
    correlationStress: 0,
    mixes: [],
  };
}
