# InvoiceGuard

**GST invoices that can't go out wrong.** A small invoice maker for Indian freelancers and
small businesses. The GST rules live in a plain-English rulebook, and [Kane CLI](https://github.com/LambdaTest/kane-cli)
checks them in a real Chrome browser on every change. When Kane finds a broken rule, the bug report goes
back to the coding agent, which has to fix it before it's allowed to say "done".

> Built for the [KaneCLI Hackathon](https://www.kaneclihack.sh/) · agent: Claude Code · verifier: Kane CLI

## Why

Getting GST wrong on an invoice costs real money. The most common mistake is charging **CGST + SGST
when the sale crosses state lines and should be IGST**. When that happens:

- the buyer can't claim input tax credit,
- the invoice has to be cancelled and re-issued,
- the seller can end up paying the tax twice.

It's the kind of bug a refactor slips in quietly and a unit test never sees. Kane catches it because it
reads the invoice the way your client does.

## What's in the box

| Piece | What it does |
| --- | --- |
| **Invoice app** (`app/`, `lib/gst.ts`) | Next.js editor with a live preview. IGST vs CGST/SGST/UTGST, GSTIN checksum + state-code validation, HSN/SAC, round-off, amount in words (lakh/crore), financial-year invoice numbers. |
| **Rulebook** (`kane/rules.md`) | 13 plain-English rules based on the mandatory contents of a tax invoice ([CGST Rules, rule 46](https://cbic-gst.gov.in/)). Anyone can edit them, no code needed. |
| **User flows** (`kane/flows/*.md`) | Plain-English journeys through the editor, e.g. "bill a Mumbai client and expect IGST 18%". |
| **`invoiceguard gate`** | Kane opens every sample invoice and flow in an isolated headless Chrome (in parallel) and checks them. |
| **`invoiceguard hook`** | Claude Code **Stop hook**. If the app changed, Kane re-verifies; failures come back to Claude as a block with Kane's bug title, root cause, evidence and suggested fix. |
| **`invoiceguard audit <url\|file>`** | Audit *any* invoice: a vendor's invoice link or an HTML file someone sent you. |
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
npm run audit -- examples/vendor-invoice.html   # audit a vendor's invoice
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
  "rules": "kane/rules.md",
  "flows": "kane/flows",
  "invoices": ["/invoice/sample/intra-state", "/invoice/sample/inter-state"],
  "watch": ["app", "lib", "components"],
  "concurrency": 5,
  "maxHookAttempts": 3
}
```

The gate starts your dev server if it isn't running. Reports go to `.kane/report.md` and
`.kane/report.json`. Each check links to its Kane recording in TestMu Test Manager.

## Disclaimer

The rulebook covers the common mandatory fields and tax-type rules. It is not tax advice. Check with
your CA for e-invoicing (IRN/QR), exports, SEZ supplies and reverse-charge cases.

## License

MIT
