// Graduated invoice reader for the india-gst invoice layout.
// Written by Kane CLI once (`tickmark graduate`), exported to Playwright, cleaned up.
// It only READS the numbers; cli/mathcheck.mjs checks them. Runs offline, no Kane credits.
// Run: INVOICE_URL=http://localhost:3000/invoice/sample/<id> node <this file>
import testmu, { resolveVar, setVar } from '@testmuai/playwright-bindings';
import { expect } from '@playwright/test';

testmu.configure({
  "name": "india-gst invoice reader",
  "defaultActionTimeoutMs": 10000,
  "defaultNavigationTimeoutMs": 60000,
  "kaneRunV4": true
});

testmu.test("Extract Invoice Data", async (page) => {
  await testmu.step("Open the invoice", async () => {
    await page.goto(process.env.INVOICE_URL);
  });
  
  await testmu.step("Extracting line items from the invoice table", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("line_items", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {25: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(25).querySelectorAll('tbody tr'), r => { const c=r.querySelectorAll('td'); return {description:c[1].innerText.trim(),quantity:c[3].innerText.trim(),rate:c[4].innerText.trim(),amount:c[5].innerText.trim(),taxable:c[6].innerText.trim()}; })));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"items\"s]"], query: "the item rows in the invoice items table with description, quantity, rate, amount, and GST text", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "Store the line items as 'line_items': a JSON array with one object per row of the items table, each with the keys description, quantity, rate, amount and taxable (copy the text of the Taxable or GST column; the word none if there is no such column)." }));
  });
  
  await testmu.step("Reading the taxable value subtotal from the invoice totals", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("subtotal", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {55: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(55).innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"taxable-total\"s]"], query: "the taxable value subtotal in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "Store the subtotal or total taxable value as 'subtotal'." }));
  });
  
  await testmu.step("Extracting tax lines from the invoice totals", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("tax_lines", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {52: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(52).querySelectorAll('tr[data-testid=\"tax-line\"]'), r => { const c=r.querySelectorAll('td'); return {label:c[0].innerText.trim(),amount:c[1].innerText.trim()}; })));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the tax rows and amounts in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "Store the tax rows as 'tax_lines': a JSON array with one object per tax row in the totals, each with the keys label and amount." }));
  });
  
  await testmu.step("Reading the round off amount from the invoice totals", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("round_off", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {64: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(64).innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"round-off\"s]"], query: "the round off amount in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "Store the round off amount as 'round_off' (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the grand total from the invoice totals", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("total", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {67: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(67).innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"grand-total\"s]"], query: "the grand total amount in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "Store the grand total or total due as 'total'." }));
  });
  
  await testmu.step("Reading the invoice amount in words", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("amount_in_words", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {51: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(51).querySelector('[data-testid=\"amount-in-words\"]').innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s]"], query: "the amount in words shown in the invoice summary", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "Store the amount in words as 'amount_in_words' (store the word none if it is not shown)." }));
  });

  await testmu.step("Report what was read", async () => {
    const read = {};
    for (const k of ["line_items","subtotal","tax_lines","round_off","total","amount_in_words"]) read[k] = await resolveVar(`{{${k}}}`);
    console.log("TICKMARK_READ " + JSON.stringify(read));
  });
});

testmu.run();