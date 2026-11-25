# In the wild: Tickmark on an open-source GST app we didn't write

Everything else in this repo checks invoices from **our own** app. This page is the harder test: we
pointed Tickmark and Kane CLI at a popular open-source GST billing app that we didn't write and had
never seen, and wrote down everything that happened, including what didn't work.

**The app:** [Free GST Billing Software](https://github.com/IamRamgarhia/Free-GST-Billing-Software)
by DiceCodes (531★, MIT), version 1.10.86, commit `a550d9e` (21 Nov 2026). It is mature: GSTR-1/3B
exports, e-way bills, 23 countries and more than 50 test scripts. We ran it locally (`vite build`, then
`node server.js`) with a fictional business: Pixel & Paper Studio in Bengaluru, billing Acme Retail in
Mumbai. Nothing was sent to anyone and no account was created.

## Results

| What was checked | Checked by | Result |
| --- | --- | --- |
| Inter-state supply billed IGST only, no CGST/SGST | Kane, rules 8–9 | ✅ correct |
| GSTINs match each party's state; place of supply shown | Kane, rules 6–7 | ✅ correct |
| Invoice number, dates, HSN/SAC, reverse charge | Kane, rules 1–5, 10 | ✅ correct |
| Line amount, subtotal, IGST, round off, total, amount in words (₹1,23,000) | code, on what Kane read | ✅ 5 sums correct |
| **The due date agrees with the payment terms on the invoice** | code, on what Kane read (rule 14) | ❌ [7 days vs 15 days](#finding-1-the-invoice-contradicts-its-own-due-date) |
| The invoice ends with an authorised signatory line | Kane, rule 13 | ⚠️ [to review](#finding-2-to-review-no-signatory-line-without-an-uploaded-signature) |
| A discount on one client's invoice doesn't reach the next client's | a Kane flow, then a script | ⚠️ [Kane passed; the script reproduces a bug](#finding-3-found-by-us-not-confirmed-by-kane-a-discount-carries-over) |

The GST logic, the hardest part to get right, held up. The problems are in the defaults around it.

## Finding 1: the invoice contradicts its own due date

A freelancer's invoice prints **"1. Payment due within 7 days of invoice"** in its terms and, higher up,
**Due Date 10 Dec 2026** for an invoice dated 25 Nov 2026: 15 days. Both are the app's own defaults for a
freelancer: the "Freelancer (Simple)" terms (`src/utils/termsDefaults.js`, line 21) and a 15-day due date
(`src/utils/invoiceStart.js`, line 37). A client could fairly ask which one applies, and the 2%-a-month
late-payment interest in the next line of the terms depends on it.

Tickmark's audit of the exported PDF ([report](free-gst-billing/audit-report.html),
[the PDF](free-gst-billing/free-gst-billing-interstate.pdf)):

```
$ npm run audit -- docs/evidence/real-world/free-gst-billing/free-gst-billing-interstate.pdf
✗ Audit of free-gst-billing-interstate.pdf 112s
    • "Reverse charge" is stated, and the invoice ends with an authorised signatory line
    • math: Payment terms say "Payment due within 7 days of invoice via UPI/NEFT/IMPS." (7 days)
      but the due date 10 Dec 2026 is 15 days after the invoice date 25 Nov 2026
```

Kane read the terms and both dates off the PDF; `cli/mathcheck.mjs` counted the days.

## Finding 2 (to review): no signatory line without an uploaded signature

CGST Rules, rule 46(q) asks for the signature or digital signature of the supplier or an authorised
representative. The app prints its signature block, including the "Authorised Signatory" caption, only
when a signature image has been uploaded (`src/components/InvoicePreview.jsx`, line 1678), and setup lets
you skip that step. The invoice says "This is a computer-generated invoice" instead. Whether that is
enough is a question for a CA, so we list it as a finding to review, not a bug.

## Finding 3 (found by us, not confirmed by Kane): a discount carries over

While setting up the test we noticed that a whole-bill discount typed for one client appeared on the
next client's new invoice. The script [`reproduce-discount-carry-over.cjs`](free-gst-billing/reproduce-discount-carry-over.cjs)
reproduces it every time, from a fresh browser profile, with or without a 70-second wait: invoice A for
First Client gets a ₹500 discount and is saved, the app is reopened, and invoice B for Second Client, with
no discount typed, shows **"Discount on total −₹500.00"** and ₹11,300 instead of ₹11,800.

![Invoice B for Second Client with a ₹500 discount nobody typed](free-gst-billing/discount-carried-over.png)

The code explains it: `src/components/InvoiceGenerator.jsx` (lines 1277–1291) saves every option of the
invoice being edited as the defaults for the next new invoice, and the discount amount
(`invoiceDiscountValue`) is one of them. The same code already strips two other pieces of per-bill data
before saving, the bank-account snapshot (v1.10.20) and the LUT options, for the same reason. The likely
fix is to strip the discount amount there too.

**Kane did not confirm it.** We wrote the same journey as a plain-English Kane flow
([`discount-carry-over.md`](free-gst-billing/discount-carry-over.md)) and ran it twice, once in one session
and once with the app reopened in between. Both runs passed: Kane's second invoice showed ₹11,800 and no
discount. Kane's own step log shows it took a different path from the script (it clicked Save twice and
re-entered the rate after the first save), and we haven't worked out which difference matters. So this
is our finding, backed by a script and the code, not a Kane result. It is also a lesson for writing flows:
Kane walks its own path to the goal, so a flow that must hit a precise sequence has to spell it out.

## Not a bug: the default whole-bill discount is after GST

An early run gave a ₹1,000 whole-bill discount and got IGST on the full ₹10,000. That looked wrong, but
the app's documentation describes exactly this: the default is an *after-GST cash discount*, with a
*before-GST trade discount* one click away. It isn't reported. It did expose a limit in our own rulebook
(below).

## What we got wrong, and changed

- **Our rules assumed our own layout.** The first audit failed rule 7 because it looked for state codes
  "in brackets", which is how *our* invoices print them. Rules 7–9 are now worded for any invoice; they
  require exactly the same thing.
- **Kane missed the 7-vs-15-day contradiction.** Asked as a plain rule, Kane passed it. Counting days is
  arithmetic, and Kane is unreliable at arithmetic, so rule 14 is a `[math]` rule now: Kane only reads the
  dates and the terms, and code counts. The second audit caught it.
- **Rule 11 doesn't know about after-GST discounts.** "Total = taxable value + tax + round off" would flag
  a documented cash discount like this app's.

## Reproduce

```bash
git clone https://github.com/IamRamgarhia/Free-GST-Billing-Software && cd Free-GST-Billing-Software
git checkout a550d9e && npm install --ignore-scripts && npx vite build && node server.js   # :47371
# Finish the 1-minute setup (freelancer, India, a business in Karnataka). Then, from this repo:
node docs/evidence/real-world/free-gst-billing/reproduce-discount-carry-over.cjs
kane-cli run "$(sed 's#{{baseUrl}}#http://localhost:47371#g' docs/evidence/real-world/free-gst-billing/discount-carry-over.md)" \
  --agent --headless --url http://localhost:47371/
# Export an invoice to a client in another state as a PDF, then:
npm run audit -- path/to/invoice.pdf
```

Kane credits used: about 37 for the first audit, 50 for the second, and 100 and 89 for the two flow runs.
