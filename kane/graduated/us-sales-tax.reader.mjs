// Graduated invoice reader for the us-sales-tax invoice layout.
// Written by Kane CLI once (`tickmark graduate`), exported to Playwright, cleaned up.
// It only READS the numbers; cli/mathcheck.mjs checks them. Runs offline, no Kane credits.
// Run: INVOICE_URL=http://localhost:3000/invoice/sample/<id> node <this file>
import testmu, { resolveVar, setVar } from '@testmuai/playwright-bindings';
import { expect } from '@playwright/test';

testmu.configure({
  "name": "us-sales-tax invoice reader",
  "defaultActionTimeoutMs": 10000,
  "defaultNavigationTimeoutMs": 60000,
  "kaneRunV4": true
});

testmu.test("Extract Invoice Data", async (page) => {
  await testmu.step("Open the invoice", async () => {
    await page.goto(process.env.INVOICE_URL);
  });
  
  await testmu.step("Extracting invoice line items", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("line_items", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {19: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(19).querySelectorAll('tbody tr'), r => { const c = r.querySelectorAll('td'); return {description:c[1].innerText.trim(),quantity:c[2].innerText.trim(),rate:c[3].innerText.trim(),amount:c[4].innerText.trim(),taxable:c[5].innerText.trim()}; })));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"items\"s]"], query: "the description, quantity, rate, amount, and Taxable column text for every item row in the invoice items table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The line items are stored as {{line_items}}: a JSON array with one object per row of the items table, each with the keys description, quantity, rate, amount and taxable (copy the text of the Taxable or GST column; the word none if there is no such column)." }));
  });
  
  await testmu.step("Reading the invoice round off amount", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("round_off", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {53: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(53) ? 'none' : null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["footer"], query: "the round off amount, or the word none when no round off is shown on the invoice", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The round off amount is stored as {{round_off}} (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the invoice amount in words", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("amount_in_words", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {53: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(53) ? 'none' : null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["footer"], query: "the amount in words, or the word none when no amount in words is shown on the invoice", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The amount in words is stored as {{amount_in_words}} (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the invoice subtotal", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("subtotal", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {43: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(43).querySelectorAll('tr')[0].querySelectorAll('td')[1].innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the subtotal amount in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The subtotal or total taxable value is stored as {{subtotal}}." }));
  });
  
  await testmu.step("Extracting invoice tax lines", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("tax_lines", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {43: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(43).querySelectorAll('tr[data-testid=\"tax-line\"]'), r => { const c=r.querySelectorAll('td'); return {label:c[0].innerText.trim(),amount:c[1].innerText.trim()}; })));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the label and amount for each tax row in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The tax rows are stored as {{tax_lines}}: a JSON array with one object per tax row in the totals, each with the keys label and amount." }));
  });
  
  await testmu.step("Reading the invoice total due", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("total", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {43: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(43).querySelector('td[data-testid=\"grand-total\"]').innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the total due amount in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The grand total or total due is stored as {{total}}." }));
  });

  await testmu.step("Report what was read", async () => {
    const read = {};
    for (const k of ["line_items","subtotal","tax_lines","round_off","total","amount_in_words"]) read[k] = await resolveVar(`{{${k}}}`);
    console.log("TICKMARK_READ " + JSON.stringify(read));
  });
});

testmu.run();