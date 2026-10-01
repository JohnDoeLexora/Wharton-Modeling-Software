import { describe, expect, it } from "vitest";
import guide from "../../docs/HOW_TO_MODELING.md?raw";
import { parseBlocks } from "./markdown";

describe("modeling guide", () => {
  const source = guide;

  it("renders the guide into headings, tables, and formulas", () => {
    const blocks = parseBlocks(source);
    const headings = blocks.filter((block) => block.type === "h").map((block) => (block.type === "h" ? block.text : ""));
    expect(headings[0]).toMatch(/How to model/);
    expect(headings).toContain("Four reserve methods");
    expect(blocks.some((block) => block.type === "table")).toBe(true);
    expect(blocks.some((block) => block.type === "code" && block.text.includes("50,000"))).toBe(true);
    expect(source.toLowerCase()).not.toContain("we recommend");
    expect(source).toContain("ProsusAI/finbert");
    expect(source).toContain("WInS");
  });
});