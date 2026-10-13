import { expect, test } from "@playwright/test";

test("walks every screen without a horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gao modeling toolkit" })).toBeVisible();
  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  expect(count).toBeGreaterThan(10);
  for (let index = 0; index < count; index++) {
    await tabs.nth(index).click();
    await expect(page.locator("#screen-status, #screen-error")).toBeVisible();
    const box = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
  }
  await page.getByRole("tab", { name: "Decision" }).click();
  await page.screenshot({ path: "docs/figures/cio-decision.png" });
  await expect(page).toHaveScreenshot("cio-decision.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("tab", { name: "Curve" }).click();
  await expect(page.locator("#convergence-lab-empty")).toBeVisible();
  await page.screenshot({ path: "docs/figures/cio-curve.png" });
  await expect(page).toHaveScreenshot("cio-curve.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("tab", { name: "Risk" }).click();
  await page.screenshot({ path: "docs/figures/cio-risk.png" });
  await expect(page).toHaveScreenshot("cio-risk.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("tab", { name: "Assumptions" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Load teaching example" }).click();
  await expect(page.getByText(/No stochastic curve/)).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".alert.warn")).toBeVisible();
  await page.screenshot({ path: "docs/figures/cio-teaching-warning.png" });
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toContainText("we recommend");
});
