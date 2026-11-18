# InvoiceGuard — notes for coding agents

This is a GST invoice maker for India (Next.js, TypeScript). Tax logic lives in `lib/gst.ts`, and
the rendered invoice is `components/InvoiceView.tsx`.

## Verification is done by Kane CLI, in a real browser

- `npm test` runs the unit tests for `lib/gst.ts`. Run it after logic changes.
- `npm run gate` makes Kane CLI open every sample invoice (`/invoice/sample/*`) and every flow in
  `kane/flows/` in Chrome and check it against `kane/rules.md`. It takes 1–3 minutes, and unchanged
  invoices are skipped.
- A Claude Code Stop hook runs the gate automatically when you try to finish. If it blocks you,
  read Kane's bug report, fix the **application code**, and finish again.
- Never weaken `kane/rules.md` or a flow to get a pass. If Kane marks a result *inconclusive* (the
  check itself is ambiguous), you may reword that rule or flow so it is clearer, but it must still
  require the same thing.
- `.kane/report.md` has the latest results and links to the Kane recordings.

## GST facts the code relies on

- Supplier state ≠ place of supply → inter-state → IGST at the full rate.
- Same state → CGST + SGST at half the rate each (UTGST instead of SGST in UTs without a legislature).
- Place of supply for these services is the recipient's state unless the user overrides it.
- Invoice numbers: at most 16 chars, only letters, digits, `/` and `-`, consecutive within a financial year (April–March).
