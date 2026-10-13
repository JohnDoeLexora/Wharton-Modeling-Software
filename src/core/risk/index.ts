export * from "./fixed";
export * from "./stats";
export * from "./clean";
export * from "./vol";
export * from "./beta";
export * from "./jumps";
export * from "./tails";
export * from "./funds";
export * from "./factors";
export * from "./coverage";
export * from "./portfolio";
export * from "./assemble";
export * from "./compare";
export * from "./fixture";
export * from "./report";

/** Parity series. Both engines see these exact numbers. */
export function paritySeries(): { asset: number[]; market: number[] } {
  const asset: number[] = [];
  const market: number[] = [];
  for (let i = 0; i < 80; i++) {
    const m = ((i % 9) - 4) / 400;
    const noise = ((i % 5) - 2) / 500;
    market.push(m);
    asset.push(0.5 * m + noise + (i % 17 === 0 ? -0.04 : 0));
  }
  return { asset, market };
}

export function parityHits(): boolean[] {
  return Array.from({ length: 100 }, (_, index) => index % 20 === 0);
}
