import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the login form has named controls, ordered headings, and visible keyboard focus", async ({
  page,
}) => {
  await page.goto("/login");
  const email = page.getByRole("textbox", { name: "Email" });
  await expect(email).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  const focused = await email.evaluate((el) => {
    const css = getComputedStyle(el);
    return (
      css.boxShadow !== "none" ||
      (css.outlineStyle !== "none" && parseFloat(css.outlineWidth) > 0)
    );
  });
  expect(focused).toBe(true);
  await email.fill("unknown@example.test");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(
    page.getByText("No account found with that email.", { exact: false })
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withRules([
      "heading-order",
      "label",
      "button-name",
      "image-alt",
      "tabindex",
    ])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("the instructor sees roster status as text within the composed layout", async ({
  page,
}) => {
  await page.request.post("/api/switch-user", { form: { userId: "2" } });
  await page.goto("/instructor/1/students");
  await expect(
    page.getByRole("heading", { name: "Student Roster" })
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Not Started" })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withRules(["heading-order", "image-alt", "tabindex"])
    .analyze();
  expect(result.violations).toEqual([]);
});
