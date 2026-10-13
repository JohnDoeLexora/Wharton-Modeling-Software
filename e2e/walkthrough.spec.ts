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
    const box = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
  }
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toContainText("we recommend");
});
