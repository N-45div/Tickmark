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
  
  await testmu.step("Extracting line items from the invoice table", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("line_items", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {19: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(19).querySelectorAll('tbody tr'), tr => { const c=Array.from(tr.querySelectorAll('td'), td=>td.innerText.trim()); return {description:c[1],quantity:c[2],rate:c[3],amount:c[4],taxable:c[5]}; })));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"items\"s]"], query: "the item rows in the invoice items table, with description, quantity, rate, amount, and taxable text", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The line items are stored as {{line_items}}: a JSON array with one object per row of the items table, each with the keys description, quantity, rate, amount and taxable (copy the text of the Taxable or GST column; the word none if there is no such column)." }));
  });
  
  await testmu.step("Reading the invoice subtotal", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("subtotal", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"subtotal\"s]"], query: "the subtotal amount in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The subtotal or total taxable value is stored as {{subtotal}}." }));
  });
  
  await testmu.step("Extracting tax lines from the invoice totals", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("tax_lines", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {43: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(43).querySelectorAll('tr')).filter(tr=>/^Sales tax/i.test(tr.cells[0]?.innerText.trim())).map(tr=>({label:tr.cells[0].innerText.trim(),amount:tr.cells[1].innerText.trim()}))));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the sales tax rows and amounts in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The tax rows are stored as {{tax_lines}}: a JSON array with one object per tax row in the totals, each with the keys label and amount." }));
  });
  
  await testmu.step("Reading the invoice round off amount", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("round_off", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {43: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (Array.from(el(43).querySelectorAll('tr')).some(tr=>/round\\s*off/i.test(tr.cells[0]?.innerText||'')) ? Array.from(el(43).querySelectorAll('tr')).find(tr=>/round\\s*off/i.test(tr.cells[0]?.innerText||'')).cells[1].innerText.trim() : 'none');\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"totals\"s] >> internal:role=table"], query: "the round off amount in the invoice totals table, or none when no round off row is shown", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The round off amount is stored as {{round_off}} (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the invoice total due", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("total", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"grand-total\"s]"], query: "the total due amount in the invoice totals table", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The grand total or total due is stored as {{total}}." }));
  });
  
  await testmu.step("Reading the invoice amount in words", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("amount_in_words", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {6: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (Array.from(el(6).querySelectorAll('p,div,span,td,dd')).some(n=>/amount\\s+in\\s+words/i.test(n.innerText||'')) ? (Array.from(el(6).querySelectorAll('p,div,span,td,dd')).find(n=>/amount\\s+in\\s+words/i.test(n.innerText||'')).innerText.trim()) : 'none');\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:testid=[data-testid=\"invoice\"s]"], query: "the amount in words text in the invoice, or none when it is not shown", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The amount in words is stored as {{amount_in_words}} (store the word none if it is not shown)." }));
  });
  
  await testmu.step("Reading the invoice issue date", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("invoice_date", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"invoice-date\"s]"], query: "the issue date printed in the invoice details", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The invoice date is stored as {{invoice_date}}, exactly as printed (store the word none for a date that is not shown)." }));
  });
  
  await testmu.step("Reading the invoice due date", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("due_date", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"due-date\"s]"], query: "the due date printed in the invoice details", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The due date is stored as {{due_date}}, exactly as printed (store the word none for a date that is not shown)." }));
  });
  
  await testmu.step("Reading the invoice payment terms", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("payment_terms", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => (els[0] ? els[0].innerText.trim() : 'none')", locators: ["internal:testid=[data-testid=\"payment-terms\"s]"], query: "the payment terms shown with the invoice due date", expectedValue: "", needsUnitConversion: false, operator: "equals", transforms: ["strip"], condition: "The words that say when payment is due, such as 'Net 30' beside the due date or 'Payment due within 7 days' in the terms or notes, are stored as {{payment_terms}} (store the word none if there are none)." }));
  });

  await testmu.step("Report what was read", async () => {
    const read = {};
    for (const k of ["line_items","subtotal","tax_lines","round_off","total","amount_in_words","invoice_date","due_date","payment_terms"]) read[k] = await resolveVar(`{{${k}}}`);
    console.log("TICKMARK_READ " + JSON.stringify(read));
  });
});

testmu.run();