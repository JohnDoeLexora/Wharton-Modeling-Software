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

export type ExportAudience = "EXTERNAL" | "INTERNAL";

let exportAudience: ExportAudience = "EXTERNAL";

/** Every downloaded file name starts with this tag. EXTERNAL is shareable. INTERNAL is the working file. */
export function setExportAudience(next: ExportAudience) {
  exportAudience = next;
}

export function currentExportAudience(): ExportAudience {
  return exportAudience;
}

export function taggedName(filename: string): string {
  if (filename.startsWith("EXTERNAL - ") || filename.startsWith("INTERNAL - ")) return filename;
  return `${exportAudience} - ${filename}`;
}

export function download(filename: string, content: string, type: string) {
  downloadBlob(taggedName(filename), new Blob([content], { type }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = taggedName(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function svgXml(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(filename: string, svg: SVGSVGElement) {
  download(filename, svgXml(svg), "image/svg+xml");
}

export function downloadPng(filename: string, svg: SVGSVGElement) {
  const xml = svgXml(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  const width = svg.viewBox.baseVal.width || 760;
  const height = svg.viewBox.baseVal.height || 340;
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * 2);
    canvas.height = Math.round(height * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (png) downloadBlob(filename, png);
      URL.revokeObjectURL(url);
    });
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

export function formatRateInput(decimal: number): string {
  if (!Number.isFinite(decimal)) return "";
  return String(Math.round(decimal * 100 * 10000) / 10000);
}

export function formatNumberInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 10000) / 10000);
}
