import { describe, expect, it } from "vitest";
import { sanitizeExport } from "./graduate.mjs";

// A made-up export in the shape Kane CLI produces (ids are fake).
const URL = "http://localhost:3000/invoice/sample/example";
const exported = `import testmu, { resolveVar, setVar } from '@testmuai/playwright-bindings';
import { expect } from '@playwright/test';

testmu.configure({
  "build": "00000000-0000-0000-0000-000000000000",
  "name": "Extract Invoice Data",
  "tcId": "TC-1",
  "kaneRunV4": true
});

testmu.test("Extract Invoice Data", async (page) => {
  await testmu.step("Navigate to ${URL}", { instructionId: "aaaa-1" }, async () => {
    await page.goto("${URL}");
  });

  await testmu.step("Extracting invoice total", async () => {
    setVar("total", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => els[0].innerText" }));
  });

  await testmu.step("Checking line_items_stored_check", async () => {
    setVar("line_items_stored_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => 'true'" }));
  });

  await testmu.step("Assertion check", { instructionId: "aaaa-2" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {});
  });
});

testmu.run();`;

describe("sanitizeExport", () => {
  const code = sanitizeExport(exported, { name: "us-sales-tax", recordedUrl: URL });

  it("keeps the reads and drops Kane's own self-check steps", () => {
    expect(code).toContain('setVar("total"');
    expect(code).not.toContain("_stored_check");
    expect(code).not.toContain('"Assertion check"');
  });
  it("removes account identifiers", () => {
    expect(code).not.toMatch(/"build"|tcId|instructionId|TC-1|00000000-/);
    expect(code).toContain('"name": "us-sales-tax invoice reader"');
  });
  it("reads the invoice URL from INVOICE_URL", () => {
    expect(code).toContain("page.goto(process.env.INVOICE_URL)");
    expect(code).not.toContain(`page.goto("${URL}")`);
    expect(code).toContain('testmu.step("Open the invoice"');
  });
  it("reports what was read and still closes and runs the test", () => {
    expect(code).toContain('testmu.step("Report what was read"');
    expect(code).toContain("INVOICEGUARD_READ ");
    expect(code.trimEnd()).toMatch(/\}\);\s*testmu\.run\(\);$/);
    expect(code.indexOf("Report what was read")).toBeLessThan(code.lastIndexOf("testmu.run()"));
  });
  it("refuses an export it doesn't recognise", () => {
    expect(() => sanitizeExport("console.log(1)", { name: "x", recordedUrl: URL })).toThrow(/testmu\.run/);
  });
});
