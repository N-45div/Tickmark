# Tickmark — notes for coding agents

This is an invoice maker for India (GST) and the United States (sales tax), built with Next.js and
TypeScript.

- Tax logic: `lib/gst.ts` and `lib/us.ts`
- Rendered invoices: `components/InvoiceView.tsx` and `components/UsInvoiceView.tsx`
- Editors: `components/IndiaEditor.tsx` and `components/UsEditor.tsx`

## Verification is done by Kane CLI, in a real browser

- `npm test` runs the unit tests for `lib/gst.ts`. Run it after logic changes.
- `npm run gate` makes Kane CLI open every sample invoice (`/invoice/sample/*`) and every flow in
  `kane/flows/` in Chrome and check it against its country's rulebook in `kane/rules/`. It takes 1–3 minutes, and unchanged
  invoices are skipped.
- A Claude Code Stop hook runs the gate automatically when you try to finish. If it blocks you,
  read Kane's bug report, fix the **application code**, and finish again.
- Never weaken a rulebook in `kane/rules/` or a flow to get a pass. If Kane marks a result *inconclusive* (the
  check itself is ambiguous), you may reword that rule or flow so it is clearer, but it must still
  require the same thing.
- `.kane/report.md` has the latest results and links to the Kane recordings.
- The `tickmark` MCP server (`mcp/server.mjs`, registered in `.mcp.json`) exposes `check_document`,
  `check_invoice_against_contract`, `list_rulebooks` and `verify_project`. `verify_project` is the
  same gate as `npm run gate`.
- Rulebooks turn into one `Assert that …` per rule (`ruleAssertions` in `cli/tickmark.mjs`). Write
  each rule as one checkable statement about visible text.

## US sales tax facts the code relies on

- Collect only if the customer's state is one of the seller's nexus states (destination-based).
- No sales tax in AK, DE, MT, NH or OR, even with nexus.
- A customer with an exemption or resale certificate pays $0.00 tax, and the certificate is shown.
- Tax only the lines marked taxable: tax = taxable total × rate. Total = subtotal + tax.

## India GST facts the code relies on

- Supplier state ≠ place of supply → inter-state → IGST at the full rate.
- Same state → CGST + SGST at half the rate each (UTGST instead of SGST in UTs without a legislature).
- Place of supply for these services is the recipient's state unless the user overrides it.
- Invoice numbers: at most 16 chars, only letters, digits, `/` and `-`, consecutive within a financial year (April–March).
