import { useRef, type RefObject } from "react";
import { compactUsd, downloadPng, downloadSvg } from "./format";

interface Series {
  name: string;
  color: string;
  values: number[];
  width?: number;
  dash?: string;
}

interface Band {
  low: number[];
  high: number[];
  color: string;
  name?: string;
}

export function LineChart({
  years,
  series,
  bands = [],
  ariaLabel,
  markers = [],
  formatTick = compactUsd,
  yDomain,
  downloadName = "gao-chart",
}: {
  years: number[];
  series: Series[];
  bands?: Band[];
  ariaLabel: string;
  markers?: number[];
  formatTick?: (value: number) => string;
  yDomain?: [number, number];
  downloadName?: string;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const width = 760;
  const height = 340;
  const pad = { l: 68, r: 14, t: 16, b: 36 };
  const points: number[] = [];
  for (const item of series) points.push(...item.values.filter(Number.isFinite));
  for (const band of bands) {
    points.push(...band.low.filter(Number.isFinite), ...band.high.filter(Number.isFinite));
  }
  if (points.length === 0 || years.length === 0) return <p className="muted">Nothing to chart yet.</p>;

  let min = yDomain ? yDomain[0] : Math.min(...points);
  let max = yDomain ? yDomain[1] : Math.max(...points);
  if (!yDomain) {
    if (min === max) {
      const padUnit = Math.max(Math.abs(min) * 0.05, 0.05);
      min -= padUnit;
      max += padUnit;
    }
    const padSpan = (max - min) * 0.08;
    min -= padSpan;
    max += padSpan;
  }
  if (min === max) max = min + 1;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (index: number) => pad.l + (index * innerW) / Math.max(1, years.length - 1);
  const y = (value: number) => pad.t + ((max - value) / (max - min)) * innerH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * (1 - t));
  const labelYears = new Set([2027, 2028, 2031, 2033, 2037, 2042]);

  return (
    <figure className="chart" ref={figureRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={pad.l - 8} y={y(tick) + 4} textAnchor="end" className="tick">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {markers.map((year) => {
          const index = years.indexOf(year);
          if (index < 0) return null;
          return <line key={year} x1={x(index)} x2={x(index)} y1={pad.t} y2={height - pad.b} className="marker" />;
        })}
        {bands.map((band) => (
          <path key={band.color} d={areaPath(band.low, band.high, x, y)} fill={band.color} />
        ))}
        {series.map((item) => (
          <path
            key={item.name}
            d={linePath(item.values, x, y)}
            fill="none"
            stroke={item.color}
            strokeWidth={item.width ?? 2.25}
            strokeDasharray={item.dash}
          />
        ))}
        {years.map((year, index) =>
          labelYears.has(year) ? (
            <text key={year} x={x(index)} y={height - 12} textAnchor="middle" className="tick">
              {year}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="legend">
        {bands.map((band, index) => (
          <span key={band.name ?? index}>
            <i className="swatch" style={{ background: band.color }} />
            {band.name ?? "Percentile band"}
          </span>
        ))}
        {series.map((item) => (
          <span key={item.name}>
            <i className="swatch" style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
      </figcaption>
      <ChartDownloads figureRef={figureRef} filename={downloadName} />
    </figure>
  );
}

function ChartDownloads({
  figureRef,
  filename,
}: {
  figureRef: RefObject<HTMLElement | null>;
  filename: string;
}) {
  return (
    <div className="row-actions chart-downloads">
      <button
        type="button"
        className="ghost"
        onClick={() => {
          const svg = figureRef.current?.querySelector("svg");
          if (svg) downloadSvg(`${filename}.svg`, svg);
        }}
      >
        Download SVG
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          const svg = figureRef.current?.querySelector("svg");
          if (svg) downloadPng(`${filename}.png`, svg);
        }}
      >
        Download PNG
      </button>
    </div>
  );
}

function linePath(values: number[], x: (i: number) => number, y: (v: number) => number): string {
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
}

function areaPath(
  low: number[],
  high: number[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  const top = high.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const bottom = [...low]
    .reverse()
    .map((value, index) => `L${x(low.length - 1 - index).toFixed(1)},${y(value).toFixed(1)}`);
  return [...top, ...bottom, "Z"].join(" ");
}

export function Histogram({
  bins,
  ariaLabel,
}: {
  bins: { lo: number; hi: number; count: number }[];
  ariaLabel: string;
}) {
  const figureRef = useRef<HTMLElement>(null);
  if (bins.length === 0) return <p className="muted">No simulated contributions yet.</p>;
  const width = 760;
  const height = 220;
  const pad = { l: 36, r: 12, t: 12, b: 40 };
  const max = Math.max(...bins.map((bin) => bin.count), 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const barW = innerW / bins.length;
  return (
    <figure className="chart" ref={figureRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {bins.map((bin, index) => {
          const h = (bin.count / max) * innerH;
          return (
            <rect
              key={`${bin.lo}-${index}`}
              x={pad.l + index * barW + 1}
              y={pad.t + innerH - h}
              width={Math.max(0, barW - 2)}
              height={h}
              className="bar"
            />
          );
        })}
        <text x={pad.l} y={height - 14} className="tick">
          {compactUsd(bins[0].lo)}
        </text>
        <text x={width - pad.r} y={height - 14} textAnchor="end" className="tick">
          {compactUsd(bins[bins.length - 1].hi)}
        </text>
      </svg>
      <figcaption className="legend">Facility contribution across full-horizon draws, under the rule used in the range.</figcaption>
      <ChartDownloads figureRef={figureRef} filename="gao-contribution-histogram" />
    </figure>
  );
}

export function RangeChart({
  rows,
  ariaLabel,
}: {
  rows: { name: string; low: number | null; high: number | null }[];
  ariaLabel: string;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const finite = rows.filter((row) => row.low !== null && row.high !== null && Number.isFinite(row.low) && Number.isFinite(row.high)) as {
    name: string;
    low: number;
    high: number;
  }[];
  if (finite.length === 0) return <p className="muted">No finite contribution range to chart.</p>;
  const width = 760;
  const height = 56 + finite.length * 36;
  const pad = { l: 210, r: 16, t: 16, b: 28 };
  let min = Math.min(...finite.map((row) => Math.min(row.low, row.high)));
  let max = Math.max(...finite.map((row) => Math.max(row.low, row.high)));
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = (max - min) * 0.06;
  min -= span;
  max += span;
  const innerW = width - pad.l - pad.r;
  const x = (value: number) => pad.l + ((value - min) / (max - min)) * innerW;
  return (
    <figure className="chart" ref={figureRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <line x1={x(min)} x2={x(max)} y1={height - pad.b} y2={height - pad.b} className="grid" />
        <text x={pad.l} y={height - 8} className="tick">
          {compactUsd(min)}
        </text>
        <text x={width - pad.r} y={height - 8} textAnchor="end" className="tick">
          {compactUsd(max)}
        </text>
        {finite.map((row, index) => {
          const y = pad.t + index * 36 + 14;
          const left = Math.min(row.low, row.high);
          const right = Math.max(row.low, row.high);
          return (
            <g key={row.name}>
              <text x={pad.l - 8} y={y + 4} textAnchor="end" className="tick">
                {row.name}
              </text>
              <line x1={x(left)} x2={x(right)} y1={y} y2={y} stroke="#0e5f5a" strokeWidth={8} strokeLinecap="butt" />
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">Low to high facility contribution under each communication method. Not a recommendation.</figcaption>
      <ChartDownloads figureRef={figureRef} filename="gao-contribution-ranges" />
    </figure>
  );
}
