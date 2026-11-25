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
    setVar("line_items", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {25: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(25).querySelectorAll('tr')).slice(1).map(r=>{const c=Array.from(r.cells).map(x=>x.innerText.trim());return {description:c[1],quantity:c[3],rate:c[4],amount:c[5],taxable:c[6]}})));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"items\"s]"], query: "the invoice items table rows with description, quantity, rate, amount, and GST text", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The line items are stored as {{line_items}}: a JSON array with one object per row of the items table, each with the keys description, quantity, rate, amount and taxable (copy the text of the Taxable or GST column; the word none if there is no such column)." }));
  });
  
  await testmu.step("Reading the invoice subtotal", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("subtotal", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {55: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(55).innerText.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"taxable-total\"s]"], query: "the taxable value subtotal in the invoice totals", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The subtotal or total taxable value is stored as {{subtotal}}." }));
  });
  
  await testmu.step("Extracting tax lines from the invoice totals", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("tax_lines", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {52: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(52).querySelectorAll('tr')).map(r=>Array.from(r.cells).map(c=>c.innerText.trim())).filter(c=>/^(CGST|SGST|IGST|UTGST)\\b/.test(c[0])).map(c=>({label:c[0],amount:c[1]}))));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the GST tax rows and amounts in the invoice totals", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The tax rows are stored as {{tax_lines}}: a JSON array with one object per tax row in the totals, each with the keys label and amount." }));
  });
  
  await testmu.step("Reading the invoice round off amount", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("round_off", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"round-off\"s]"], query: "the round off amount in the invoice totals", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The round off amount is stored as {{round_off}} (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the invoice grand total", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("total", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"grand-total\"s]"], query: "the grand total amount in the invoice totals", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The grand total or total due is stored as {{total}}." }));
  });
  
  await testmu.step("Reading the invoice amount in words", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("amount_in_words", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {51: 0};\n  const el = (i) => els[__m[i]];\n  const __v = ((el(51).innerText.match(/Indian Rupees[^\\n]*/)||[null])[0]);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s]"], query: "the amount in words printed in the invoice summary", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The amount in words is stored as {{amount_in_words}} (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the invoice date", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("invoice_date", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"invoice-date\"s]"], query: "the invoice date in the invoice details", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The invoice date is stored as {{invoice_date}}, exactly as printed (store the word none for a date that is not shown)." }));
  });
  
  await testmu.step("Reading the invoice due date", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("due_date", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"due-date\"s]"], query: "the due date in the invoice details", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The due date is stored as {{due_date}}, exactly as printed (store the word none for a date that is not shown)." }));
  });
  
  await testmu.step("Reading the invoice payment terms", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("payment_terms", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"payment-terms\"s]"], query: "the payment terms printed beside the due date", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The words that say when payment is due, such as 'Net 30' beside the due date or 'Payment due within 7 days' in the terms or notes, are stored as {{payment_terms}} (store the word none if there are none)." }));
  });

  await testmu.step("Report what was read", async () => {
    const read = {};
    for (const k of ["line_items","subtotal","tax_lines","round_off","total","amount_in_words","invoice_date","due_date","payment_terms"]) read[k] = await resolveVar(`{{${k}}}`);
    console.log("TICKMARK_READ " + JSON.stringify(read));
  });
});

testmu.run();