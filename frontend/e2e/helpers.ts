import { expect, type Page } from "@playwright/test";

export const API = "http://127.0.0.1:8600";
export const PASSWORD = "correct-horse-battery";
export const uniqueName = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/** Ask a question and wait for the streamed answer to finish. */
export async function ask(page: Page, question: string) {
  const box = page.getByPlaceholder(/ask/i).first();
  await box.fill(question);
  await page.getByRole("button", { name: "Send" }).click(); // Enter is a newline on touch devices
  await expect(page.getByRole("button", { name: "Copy answer" }).last()).toBeVisible({ timeout: 30_000 });
}

/** Create an account through the API and return its bearer token and username. */
export async function makeAccount(
  request: import("@playwright/test").APIRequestContext,
  role: "user" | "staff" = "user",
) {
  const username = uniqueName(role === "staff" ? "st" : "us");
  if (role === "user") {
    const r = await request.post(`${API}/auth/register`, {
      data: { username, password: PASSWORD, display_name: "Test Person" },
    });
    expect(r.ok()).toBeTruthy();
    return { username, token: (await r.json()).token as string };
  }
  const admin = await ensureAdmin(request);
  const c = await request.post(`${API}/admin/users`, {
    headers: { Authorization: `Bearer ${admin}` },
    data: { username, password: PASSWORD, role: "staff" },
  });
  expect(c.ok()).toBeTruthy();
  const l = await request.post(`${API}/auth/login`, { data: { username, password: PASSWORD } });
  return { username, token: (await l.json()).token as string };
}

/** The first admin is created with the ADMIN_TOKEN setup key; later calls just sign in. */
export async function ensureAdmin(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/auth/login`, { data: { username: "e2eadmin", password: PASSWORD } });
  if (login.ok()) return (await login.json()).token;
  const setup = await request.post(`${API}/auth/setup`, {
    data: { setup_key: "e2e-setup-key-0123456789", username: "e2eadmin", password: PASSWORD },
  });
  expect(setup.ok()).toBeTruthy();
  return (await setup.json()).token;
}
