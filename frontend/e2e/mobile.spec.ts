import { expect, test } from "@playwright/test";
import { ask } from "./helpers";

test("phone layout: no horizontal scroll, drawer opens, composer stays reachable", async ({ page }) => {
  await page.goto("/");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Open chat history" }).click();
  await expect(
    page.getByRole("complementary", { name: "Chat history" }).getByRole("button", { name: "New chat" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).first().click();

  await ask(page, "What are the fees for the Diploma in Information Technology?");
  expect(await overflow()).toBeLessThanOrEqual(0);
  const box = await page.getByPlaceholder(/ask/i).first().boundingBox();
  expect(box && box.y + box.height <= (page.viewportSize()?.height ?? 0)).toBeTruthy();
});
