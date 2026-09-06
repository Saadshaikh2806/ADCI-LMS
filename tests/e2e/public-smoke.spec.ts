import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("login shell renders without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveTitle("ADCI Learning Hub");
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("registration and recovery modes are reachable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Join ADCI Learning Hub" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("public certificate verification page is accessible", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.getByRole("heading", { name: "Verify an ADCI certificate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify certificate" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Learning Hub" })).toHaveAttribute("href", "/");
});

test("security headers protect public pages", async ({ request }) => {
  const response = await request.get("/verify");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["strict-transport-security"]).toContain("max-age=");
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
});

test("unknown routes return the custom 404", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page is not available" })).toBeVisible();
});

test("public and legal pages have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/", "/verify", "/legal/privacy", "/legal/terms", "/legal/refunds"]) {
    await page.goto(path);
    if (path === "/") await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || "")), `Accessibility violations on ${path}`).toEqual([]);
  }
});
