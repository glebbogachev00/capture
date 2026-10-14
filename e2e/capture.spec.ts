import { expect, test } from "@playwright/test";

/* No model keys here, so a capture waits in Unsorted: the path that must
   never lose words. */
test("a capture is kept, and is still there after a reload", async ({ page }) => {
  const words = `Email the landlord about the leak ${Date.now()}`;
  await page.goto("/app");
  await page.getByPlaceholder("Say it however it comes out.").fill(words);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByText("Saved. Awaiting sorting or placement")).toBeVisible();
  const unsorted = page.getByRole("region", { name: "Unsorted captures" });
  await expect(unsorted.getByRole("button", { name: /Unsorted 1/ })).toBeVisible();

  await page.reload();
  await unsorted.getByRole("button", { name: /Unsorted 1/ }).click();
  await expect(unsorted.getByText(words)).toBeVisible();
});

test("an English phone gets English", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByPlaceholder("Say it however it comes out.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test.describe("on a Russian phone", () => {
  test.use({ locale: "ru-RU" });

  test("the app speaks Russian", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByPlaceholder("Пишите или говорите как получится.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Записать", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  });
});
