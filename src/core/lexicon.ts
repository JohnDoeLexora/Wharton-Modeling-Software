/** Demo bag-of-words scorer. This is not FinBERT and not a financial model. */

const POSITIVE = new Set([
  "beat",
  "beats",
  "beating",
  "growth",
  "grew",
  "surge",
  "surged",
  "record",
  "upgrade",
  "upgraded",
  "strong",
  "stronger",
  "profit",
  "profits",
  "gain",
  "gains",
  "bullish",
  "outperform",
  "optimistic",
  "expand",
  "expanded",
  "expansion",
  "recovery",
  "rebound",
  "rose",
  "rises",
  "higher",
  "improves",
  "improved",
  "improvement",
]);

const NEGATIVE = new Set([
  "miss",
  "missed",
  "misses",
  "loss",
  "losses",
  "decline",
  "declined",
  "declines",
  "fraud",
  "weak",
  "weaker",
  "weakness",
  "downgrade",
  "downgraded",
  "default",
  "defaulted",
  "bearish",
  "recession",
  "layoff",
  "layoffs",
  "lawsuit",
  "plunge",
  "plunged",
  "bankruptcy",
  "warning",
  "cut",
  "cuts",
  "softer",
  "softened",
  "lower",
  "fell",
  "fall",
]);

export interface LexiconScore {
  label: "positive" | "negative" | "neutral";
  scores: { positive: number; negative: number; neutral: number };
  hits: { positive: string[]; negative: string[] };
}

export function sampleLexiconScore(text: string): LexiconScore {
  const words = text.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
  const positiveHits: string[] = [];
  const negativeHits: string[] = [];
  for (const word of words) {
    if (POSITIVE.has(word)) positiveHits.push(word);
    if (NEGATIVE.has(word)) negativeHits.push(word);
  }
  const p = positiveHits.length;
  const n = negativeHits.length;
  if (p + n === 0) {
    return {
      label: "neutral",
      scores: { positive: 0, negative: 0, neutral: 1 },
      hits: { positive: [], negative: [] },
    };
  }
  const positive = p / (p + n);
  const negative = n / (p + n);
  let label: LexiconScore["label"] = "neutral";
  if (positive > negative) label = "positive";
  else if (negative > positive) label = "negative";
  return {
    label,
    scores: { positive, negative, neutral: 0 },
    hits: { positive: positiveHits, negative: negativeHits },
  };
}

export const SAMPLE_HEADLINES = [
  "Northwind Tools lifts full-year profit guidance after a record quarter",
  "Harbor Rail says demand softened and cuts its outlook",
  "Maple Foods keeps its dividend unchanged and gives no new guidance",
].join("\n");
