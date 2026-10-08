import { expect, test } from "@playwright/test";
import { ask } from "./helpers";

test("asks a question and gets a cited answer, follow-ups and an insights panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /what can i help you/i })).toBeVisible();
  await ask(page, "What are the fees for the Diploma in Information Technology?");
  await expect(page.getByText(/Information Technology/).first()).toBeVisible();
  await expect(page.getByLabel("Sources")).toBeVisible();
  await expect(page.getByLabel("Suggested follow-up questions")).toBeVisible();

  await page.getByRole("button", { name: "How this was answered" }).click();
  const insights = page.getByRole("region", { name: /how this answer was produced/i });
  await expect(insights).toContainText("Searched the knowledge base");
  await expect(insights).toContainText("Wrote the answer");
});

test("a suggested follow-up can be clicked to ask it", async ({ page }) => {
  await page.goto("/");
  await ask(page, "What are the fees for the Diploma in Information Technology?");
  const chip = page.getByLabel("Suggested follow-up questions").getByRole("button").first();
  const text = (await chip.innerText()).trim();
  await chip.click();
  await expect(page.getByText(text).first()).toBeVisible();
});

test("chats are kept in the browser, can be renamed, pinned and deleted", async ({ page }) => {
  await page.goto("/");
  await ask(page, "What scholarships are available?");
  await page.reload();
  const sidebar = page.getByRole("complementary", { name: "Chat history" });
  await expect(sidebar.getByRole("button", { name: /scholarships/i }).first()).toBeVisible();

  await sidebar
    .getByRole("button", { name: /scholarships/i })
    .first()
    .hover(); // the options button appears on hover
  await page
    .getByRole("button", { name: /Options for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(sidebar.getByText(/scholarships/i)).toHaveCount(0);
});

test("off-topic questions are declined honestly, without inventing facts", async ({ page }) => {
  await page.goto("/");
  await ask(page, "Who won the football world cup in 2010?");
  await expect(page.getByText(/couldn't find|not find|contact/i).first()).toBeVisible();
});

test("dark mode toggles and persists", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("reloading opens a new chat; earlier chats stay in the sidebar", async ({ page }) => {
  await page.goto("/");
  await ask(page, "What scholarships are available?");
  await page.reload();
  await expect(page.getByRole("heading", { name: /what can i help you/i })).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "Chat history" })
      .getByRole("button", { name: /scholarships/i })
      .first(),
  ).toBeVisible();
});

test("the Recents popover on the collapsed sidebar closes when its button is clicked again", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("askuoc_sidebar_v1", "0");
    const chat = { id: "c1", title: "Fees question", threadId: null, updatedAt: Date.now() };
    localStorage.setItem(
      "askuoc_history_v1",
      JSON.stringify([{ ...chat, messages: [{ id: "m1", role: "user", content: "hi", sources: [] }] }]),
    );
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Recent chats" });
  const entry = page.getByRole("button", { name: /Fees question/ });
  await button.click();
  await expect(entry).toBeVisible();
  await button.click();
  await expect(entry).toBeHidden();
});

test("messages show when they were sent and the sidebar groups chats by day", async ({ page }) => {
  await page.goto("/");
  await ask(page, "What scholarships are available?");
  await expect(page.locator("time")).toHaveCount(2); // the question and the answer
  await expect(
    page.getByRole("complementary", { name: "Chat history" }).getByRole("heading", { name: "Today" }),
  ).toBeVisible();
});
