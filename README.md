# InvoiceGuard

**Invoices that can't go out wrong.** A small invoice maker for freelancers and small businesses
in **India (GST)** and the **United States (sales tax)**. The tax rules live in plain-English rulebooks,
and [Kane CLI](https://github.com/LambdaTest/kane-cli) checks them in a real Chrome browser on every
change. When Kane finds a broken rule, the bug report goes back to the coding agent, which has to fix it
before it's allowed to say "done". Kane can also audit invoices *you receive*.

> Built for the [KaneCLI Hackathon](https://www.kaneclihack.sh/) · agent: Claude Code · verifier: Kane CLI

## Why

Invoice tax mistakes cost real money, and they're the kind of bug a refactor slips in quietly and a unit
test never sees. Kane catches them because it reads the invoice the way your client does.

**India.** The most common mistake is charging **CGST + SGST on a sale that crosses state lines and
should be IGST**. The buyer can't claim input tax credit, the invoice has to be re-issued, and the seller
can end up paying the tax twice.

**United States.** Sales tax is set per state, collected only where you have **nexus**, and often doesn't
apply to services. The usual mistakes:

- taxing the whole invoice instead of only the taxable items,
- charging a reseller who handed you an exemption certificate,
- collecting in a state where you have no nexus,
- charging tax in Oregon, Montana, New Hampshire, Delaware or Alaska.

Over-collecting annoys customers. Under-collecting becomes your own liability at audit time.

## What's in the box

| Piece | What it does |
| --- | --- |
| **Invoice app** (`app/`, `lib/gst.ts`, `lib/us.ts`) | Next.js editor with a live preview and an India / US switch. **India:** IGST vs CGST/SGST/UTGST, GSTIN checksum + state-code validation, HSN/SAC, round-off, amount in words (lakh/crore), financial-year numbering. **US:** nexus states, per-line taxable flag, exemption certificates, no-sales-tax states, state base rates as a starting point. |
| **Rulebooks** (`kane/rules/`) | `india-gst.md`: 13 rules based on the mandatory contents of a tax invoice ([CGST Rules, rule 46](https://cbic-gst.gov.in/)). `us-sales-tax.md`: 10 rules for nexus, taxability, exemptions and math. Plain English, editable by anyone. Add a rulebook for your own country. |
| **User flows** (`kane/flows/*.md`) | Plain-English journeys through the editor, e.g. "bill a Mumbai client and expect IGST 18%" or "tax only the taxable line for a Texas customer". |
| **`invoiceguard gate`** | Kane opens every sample invoice and flow in an isolated headless Chrome (in parallel) and checks them. |
| **`invoiceguard hook`** | Claude Code **Stop hook**. If the app changed, Kane re-verifies; failures come back to Claude as a block with Kane's bug title, root cause, evidence and suggested fix. |
| **`invoiceguard audit <url\|file>`** | Audit *any* invoice you receive, from a link or an HTML file. It works out whether the invoice is Indian or American and uses the matching rulebook. |
| **CI** (`.github/workflows/invoiceguard.yml`) | The same gate on every push and PR. |

## The closed loop

```
 you: "add X to the invoice editor"
        │
        ▼
 Claude Code edits app/ ──► tries to finish ──► Stop hook: invoiceguard hook
        ▲                                             │
        │                                    Kane CLI × N (real Chrome, parallel)
        │                                             │
        └──── blocked: Kane's bug report ◄──── ✗ rule 8 broken on invoice 0002
                                                      │
                                              ✓ all green → Claude may stop
```

- **Skips unchanged work.** If an invoice's rendered markup hasn't changed since Kane last passed it,
  it's skipped. If nothing in the app changed, the hook does nothing and spends no credits.
- **Separates bugs from bad checks.** When Kane decides a failure is a problem with the check rather
  than the product, it's reported as *inconclusive*. The agent is told **not** to change app code for it.
- **Can't loop forever.** After 3 failed fix attempts it stops and hands over to a human, with the
  report in `.kane/report.md`.

## Quick start

```bash
npm install
npm install -g @testmuai/kane-cli
kane-cli login                          # or set LT_USERNAME / LT_ACCESS_KEY

npm run dev                             # http://localhost:3000
npm test                                # unit tests for the GST logic
npm run gate                            # Kane verifies every sample invoice + flow
npm run audit -- examples/india-vendor-invoice.html   # wrong GST type + GSTIN/state mismatch
npm run audit -- examples/us-vendor-invoice.html      # taxed a non-taxable service + bad line math
```

To get the agent loop in Claude Code:

```bash
node cli/invoiceguard.mjs init          # adds the Stop hook to .claude/settings.json
claude                                  # work as usual; Kane signs off before Claude stops
```

### Try the demo bug

`demo/place-of-supply-bug.patch` is a one-line "refactor" that makes place of supply default to the
**seller's** state. Every out-of-state client then gets CGST+SGST instead of IGST. The unit tests still
pass because the bug is in the UI layer. Kane catches it.

```bash
git apply demo/place-of-supply-bug.patch
npm run gate          # ✗ Create an inter-state invoice from the editor
```

Or open Claude Code and ask it to apply the patch and finish. The Stop hook blocks it, hands it Kane's
report, and Claude fixes the bug on its own.

## Configuration

`invoiceguard.config.json`:

```json
{
  "baseUrl": "http://localhost:3000",
  "devCommand": "npx next dev -p 3000",
  "rulePacks": {
    "india-gst": "kane/rules/india-gst.md",
    "us-sales-tax": "kane/rules/us-sales-tax.md"
  },
  "flows": "kane/flows",
  "invoices": [
    { "path": "/invoice/sample/inter-state", "pack": "india-gst" },
    { "path": "/invoice/sample/us-taxable-goods", "pack": "us-sales-tax" }
  ],
  "watch": ["app", "lib", "components"],
  "concurrency": 5,
  "maxHookAttempts": 3
}
```

The gate starts your dev server if it isn't running. Reports go to `.kane/report.md` and
`.kane/report.json`. Each check links to its Kane recording in TestMu Test Manager.

## Disclaimer

The rulebooks cover common mandatory fields and tax decisions. They are not tax advice.

- **India:** check with your CA for e-invoicing (IRN/QR), exports, SEZ supplies and reverse-charge cases.
- **US:** state base rates are only a starting point. Enter your customer's combined state + local rate,
  and check product taxability and nexus thresholds for each state with your accountant.

## License

MIT
