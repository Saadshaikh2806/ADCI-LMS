import { expect, test, type BrowserContext, type Route } from "@playwright/test";

const userId = "00000000-0000-0000-0000-000000000001";

// Exercise the real AuthGate/Supabase client with isolated provider responses.
// The actual SQL ownership/permission rules run in test:session, not in this mock.
async function mockAccount(context: BrowserContext, sessionId: string, state: { owner: string; unavailable?: boolean }) {
  const user = {
    id: userId, aud: "authenticated", role: "authenticated", email: "learner@example.test",
    email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Test Learner" }, factors: []
  };
  const jwt = [
    { alg: "HS256", typ: "JWT" },
    { sub: userId, role: "authenticated", aal: "aal1", session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-only-signature"
  ].map(value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url")).join(".");
  await context.routeWebSocket("wss://**", socket => socket.close());
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/token")) return respond({ access_token: jwt, refresh_token: sessionId, expires_in: 3600, token_type: "bearer", user });
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
      if (url.pathname.endsWith("/user")) return respond(user);
      return respond({ all: [], totp: [], phone: [] });
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (url.pathname.endsWith("/adci_claim_active_session")) {
        if (state.unavailable) return respond({ message: "Session database unavailable", code: "PGRST202" }, 503);
        if (state.owner === "second-login" && sessionId === "first-login") return respond({ message: "Your session is no longer active. Please sign in again.", code: "PT401" }, 401);
        state.owner = sessionId;
        return respond(null);
      }
      if (url.pathname.endsWith("/adci_check_active_session")) {
        return state.owner === sessionId ? respond(null) : respond({ message: "Your session is no longer active. Please sign in again.", code: "PT401" }, 401);
      }
      if (url.pathname.endsWith("/adci_claim_initial_admin")) return respond(null);
      if (url.pathname.includes("/rpc/")) return respond({ message: "Dashboard data excluded from session test" }, 503);
      return respond([]);
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort();
  });
}

test("a second browser login signs the first browser out on its next ownership check", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const state = { owner: "" };
    await mockAccount(first, "first-login", state);
    await mockAccount(second, "second-login", state);
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();
    for (const page of [firstPage, secondPage]) {
      await page.goto("http://127.0.0.1:3100/");
      await page.getByLabel("Email address").fill("learner@example.test");
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Sign in to continue" })).not.toBeVisible();
      await expect(page.getByText("Securing your ADCI workspace…")).not.toBeVisible();
    }
    await expect.poll(() => state.owner).toBe("second-login");
    await firstPage.bringToFront();
    await firstPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(firstPage.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    await expect(firstPage.getByText("Your session is no longer active. Please sign in again.", { exact: true })).toBeVisible();
    await expect(secondPage.getByRole("heading", { name: "Sign in to continue" })).not.toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test("a failed session claim shows an error instead of admitting the account", async ({ context, page }) => {
  await mockAccount(context, "first-login", { owner: "", unavailable: true });
  await page.goto("/");
  await page.getByLabel("Email address").fill("learner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Session database unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
});

test("Back closes Zoom first and returns to the same LMS screen", async ({ context, page }) => {
  await mockAccount(context, "first-login", { owner: "" });
  await page.goto("/verify");
  await page.goto("/?tab=live#classes");
  await page.getByLabel("Email address").fill("learner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Securing your ADCI workspace…")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("adci-open-zoom-live", {
    detail: "00000000-0000-0000-0000-000000000010"
  })));
  await expect(page.getByRole("dialog", { name: "Zoom Live", exact: true })).toBeVisible();
  let pendingJoin: Route | undefined;
  await page.route("**/api/live-sessions/zoom", route => { pendingJoin = route; });
  await page.getByRole("button", { name: "Join Zoom Live", exact: true }).click();
  await expect(page.getByText("Starting Zoom Live…", { exact: true })).toBeVisible();
  // The same history entry must cover pre-join, waiting for the host, and the meeting.
  await page.goBack();
  await expect(page).toHaveURL(/\/\?tab=live#classes$/);
  await expect(page.getByRole("dialog", { name: "Zoom Live", exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("adci-active-zoom-live"))).toBeNull();
  await pendingJoin?.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({error:"Cancelled test join"}) });
  // Closing explicitly must consume the same history entry, without trapping Back.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("adci-open-zoom-live", {
    detail: "00000000-0000-0000-0000-000000000010"
  })));
  await page.getByRole("button", { name: "Close Zoom Live", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Zoom Live", exact: true })).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?tab=live#classes$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/verify$/);
});
