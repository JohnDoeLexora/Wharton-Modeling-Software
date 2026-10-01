export function usd(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(digits) + "%";
}

export function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return sign + "$" + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2) + "m";
  if (abs >= 10_000) return sign + "$" + Math.round(abs / 1000) + "k";
  if (abs >= 1_000) return sign + "$" + (abs / 1000).toFixed(1) + "k";
  return sign + "$" + Math.round(abs);
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatRateInput(decimal: number): string {
  if (!Number.isFinite(decimal)) return "";
  return String(Math.round(decimal * 100 * 10000) / 10000);
}

export function formatNumberInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 10000) / 10000);
}
