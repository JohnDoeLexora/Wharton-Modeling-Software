import { compactUsd } from "./format";

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
}

export function LineChart({
  years,
  series,
  bands = [],
  ariaLabel,
  markers = [],
  formatTick = compactUsd,
  yDomain,
}: {
  years: number[];
  series: Series[];
  bands?: Band[];
  ariaLabel: string;
  markers?: number[];
  formatTick?: (value: number) => string;
  yDomain?: [number, number];
}) {
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
    <figure className="chart">
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
        {bands.length > 0 ? (
          <span>
            <i className="swatch" style={{ background: bands[0].color }} />
            Percentile band
          </span>
        ) : null}
        {series.map((item) => (
          <span key={item.name}>
            <i className="swatch" style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
      </figcaption>
    </figure>
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
  if (bins.length === 0) return <p className="muted">No simulated contributions yet.</p>;
  const width = 760;
  const height = 220;
  const pad = { l: 36, r: 12, t: 12, b: 40 };
  const max = Math.max(...bins.map((bin) => bin.count), 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const barW = innerW / bins.length;
  return (
    <figure className="chart">
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
    </figure>
  );
}
