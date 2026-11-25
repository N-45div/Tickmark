// Reproduce the discount carry-over in Free GST Billing Software (v1.10.86, commit a550d9e).
// Start the app (`npx vite build && node server.js`, port 47371) and finish its first-run setup
// once (freelancer, India, any business in Karnataka). Then: node reproduce-discount-carry-over.cjs
//
// Invoice A: First Client, ₹10,000 of services, a ₹500 discount on the whole bill, saved.
// The app is reopened. Invoice B: Second Client, ₹10,000 of services, no discount typed.
// Expected for B: Subtotal ₹10,000 + IGST ₹1,800 = ₹11,800. Seen: "Discount on total −₹500", ₹11,300.
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? 'http://localhost:47371/';

const totals = async (p) => {
  const body = await p.innerText('body');
  const i = body.indexOf('TAX INVOICE');
  return body.slice(body.indexOf('Subtotal', i), body.indexOf('TERMS & CONDITIONS', i)).replace(/\n+/g, ' | ');
};

async function newInvoice(p, client, city, pin, discount) {
  await p.getByRole('button', { name: 'New Invoice' }).first().click();
  await p.waitForTimeout(1000);
  await p.getByText('Services', { exact: true }).click();
  await p.fill('input[placeholder="Type client name to search or add new"]', client);
  await p.keyboard.press('Escape');
  await p.getByText('More client details').click();
  await p.fill('input[placeholder="Street address, locality"]', '1 Test Road');
  await p.fill('input[placeholder="e.g. Mumbai"]', city);
  for (const s of await p.$$('select')) {
    const opts = await s.$$eval('option', (o) => o.map((x) => x.textContent));
    if (opts.includes('Maharashtra') && (await s.inputValue()) === '') { await s.selectOption({ label: 'Maharashtra' }); break; }
  }
  await p.fill('input[placeholder="Postal / PIN code"]', pin);
  await p.fill('textarea[placeholder="Item"]', 'Consulting');
  const row = p.locator('textarea[placeholder="Item"] >> xpath=following::input');
  await row.nth(0).fill('998311'); // SAC
  await row.nth(2).fill('10000'); // rate
  if (discount) {
    await p.getByText('+ Discount on the whole bill').click();
    await p.locator('input[placeholder="0"]:visible').first().fill(discount);
  }
  await p.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.goto(APP, { waitUntil: 'networkidle' });

  await newInvoice(p, 'First Client', 'Mumbai', '400013', '500');
  console.log('A, ₹500 discount typed:', await totals(p));
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.waitForTimeout(2500);

  await p.goto(APP, { waitUntil: 'networkidle' }); // reopen the app
  await newInvoice(p, 'Second Client', 'Pune', '411001', null);
  const b = await totals(p);
  console.log('B, no discount typed: ', b);
  console.log(b.includes('Discount') ? '✗ the discount from invoice A was carried over to invoice B' : '✓ no discount on invoice B');
  await browser.close();
})();
