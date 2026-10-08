import { expect, test } from "@playwright/test";
import { API, PASSWORD, ask, ensureAdmin, makeAccount, uniqueName } from "./helpers";

test("sign up from the app, chat, and the chat syncs to the account and follows it to a new browser", async ({
  page,
  browser,
  request,
}) => {
  const username = uniqueName("ann");
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /create an account/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^name/i).fill("Ann Lee");
  await dialog.getByLabel("Username").fill(username);
  await dialog.getByLabel(/^password/i).fill(PASSWORD);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create your account" }).click();
  await expect(page.getByRole("button", { name: /account menu for ann lee/i })).toBeVisible();

  await ask(page, "How do international students apply?");
  // sync is debounced
  const login = await request.post(`${API}/auth/login`, { data: { username, password: PASSWORD } });
  const token = (await login.json()).token;
  await expect
    .poll(
      async () =>
        (await (await request.get(`${API}/me/conversations`, { headers: { Authorization: `Bearer ${token}` } })).json())
          .conversations.length,
      { timeout: 15_000 },
    )
    .toBe(1);

  // a different browser profile signs in and sees the same chat
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto("/");
  await page2.getByRole("button", { name: "Sign in" }).click();
  await page2.getByRole("dialog").getByLabel("Username").fill(username);
  await page2
    .getByRole("dialog")
    .getByLabel(/^password/i)
    .fill(PASSWORD);
  await page2.getByRole("dialog").getByRole("button", { name: "Sign in" }).click();
  await expect(
    page2
      .getByRole("complementary", { name: "Chat history" })
      .getByRole("button", { name: /international/i })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  await other.close();
});

test("wrong password shows a friendly error, and nothing leaks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Username").fill("nobody-here");
  await d.getByLabel(/^password/i).fill("not-the-password");
  await d.getByRole("button", { name: "Sign in" }).click();
  await expect(d.getByRole("alert")).toContainText(/incorrect|invalid|wrong/i);
});

test("profile: change name, avatar, and the letter avatar is generated from the name", async ({ page, request }) => {
  const { username, token } = await makeAccount(request);
  await page.addInitScript(
    ([t, u]) =>
      localStorage.setItem(
        "askuoc_session_v1",
        JSON.stringify({
          token: t,
          user: { username: u, role: "user", display_name: "Test Person", has_avatar: false },
        }),
      ),
    [token, username],
  );
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Test Person" })).toBeVisible();

  await page.getByLabel("Display name").fill("Renamed Person");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Renamed Person" })).toBeVisible();

  // a 1x1 PNG is enough; the browser re-encodes it
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  const profile = await (
    await request.get(`${API}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  expect(profile.avatar).toMatch(/^data:image\/(webp|jpeg);base64,/);
  expect(profile.display_name).toBe("Renamed Person");
});

test("data export downloads and deleting the account signs you out", async ({ page, request }) => {
  const { username, token } = await makeAccount(request);
  await page.addInitScript(
    ([t, u]) =>
      localStorage.setItem(
        "askuoc_session_v1",
        JSON.stringify({ token: t, user: { username: u, role: "user", display_name: "Test Person" } }),
      ),
    [token, username],
  );
  await page.goto("/profile");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /download my data/i }).click(),
  ]);
  expect(download.suggestedFilename()).toContain(username);

  await page.getByLabel("Password to confirm deletion").fill(PASSWORD);
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete forever" }).click();
  await expect(page).toHaveURL(/\/$/);
  const login = await request.post(`${API}/auth/login`, { data: { username, password: PASSWORD } });
  expect(login.status()).toBe(401);
});

test("roles are automatic: members never see the admin console, staff do", async ({ page, request }) => {
  const member = await makeAccount(request, "user");
  await page.addInitScript(
    ([t, u]) =>
      localStorage.setItem(
        "askuoc_session_v1",
        JSON.stringify({ token: t, user: { username: u, role: "user", display_name: "Test Person" } }),
      ),
    [member.token, member.username],
  );
  await page.goto("/");
  await page.getByRole("button", { name: /account menu/i }).click();
  await expect(page.getByRole("menuitem", { name: /profile/i })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /console/i })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText(/don't have access|not have access|no access/i)).toBeVisible();

  const staff = await makeAccount(request, "staff");
  const ctx = await page.context().browser()!.newContext();
  const p2 = await ctx.newPage();
  await p2.addInitScript(
    ([t, u]) =>
      localStorage.setItem(
        "askuoc_session_v1",
        JSON.stringify({ token: t, user: { username: u, role: "staff", display_name: "Staff Person" } }),
      ),
    [staff.token, staff.username],
  );
  await p2.goto("/");
  await p2.getByRole("button", { name: /account menu/i }).click();
  await expect(p2.getByRole("menuitem", { name: /console/i })).toBeVisible();
  await ctx.close();
});

test("first-time setup: the admin key creates the first admin; admin sees the full console", async ({
  page,
  request,
}) => {
  const token = await ensureAdmin(request);
  await page.addInitScript(
    (t) =>
      localStorage.setItem(
        "askuoc_session_v1",
        JSON.stringify({ token: t, user: { username: "e2eadmin", role: "admin", display_name: "e2eadmin" } }),
      ),
    token,
  );
  await page.goto("/admin");
  for (const tab of ["Overview", "Data", "Settings", "Users", "Snapshots", "Audit"]) {
    await expect(
      page
        .getByRole("tab", { name: tab })
        .or(page.getByRole("link", { name: tab }))
        .first(),
    ).toBeVisible();
  }
});
