import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/privacy", "/terms", "/cookies", "/accessibility", "/about"];

for (const path of PAGES) {
  test(`${path} renders, has a title and no serious accessibility violations`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/AskUoC/);
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

test("unknown pages get the friendly 404", async ({ page }) => {
  const res = await page.goto("/this-page-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByText(/couldn't find|not found|404/i).first()).toBeVisible();
});

test("SEO basics: sitemap, robots, security.txt", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  expect(await sitemap.text()).toContain("/privacy");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/admin/);
  const sec = await request.get("/.well-known/security.txt");
  expect(sec.ok()).toBeTruthy();
  expect(await sec.text()).toContain("Contact:");
});

test("shared conversation pages are not indexable", async ({ page }) => {
  await page.goto("/s/doesnotexist");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
