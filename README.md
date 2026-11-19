# InvoiceGuard

**Invoices that can't go out wrong.** A small invoice maker for freelancers and small businesses
in **India (GST)** and the **United States (sales tax)**. The tax rules live in plain-English rulebooks,
and [Kane CLI](https://github.com/LambdaTest/kane-cli) checks them in a real Chrome browser on every
change. When Kane finds a broken rule, the bug report goes back to the coding agent, which has to fix it
before it's allowed to say "done". Kane can also audit invoices and **contracts** *you receive*, and check
that an invoice bills what the contract agreed, from any AI agent via **MCP**.

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
| **MCP server** (`mcp/server.mjs`) | Any MCP agent (Claude Code, Claude Desktop, Cursor, Windsurf, Codex) can call `check_document`, `check_invoice_against_contract`, `list_rulebooks` and `verify_project`. Kane's verdict comes straight back to the agent. |
| **Contract rulebooks** (`kane/rules/services-contract.md`, `invoice-vs-contract.md`) | 12 checks for missing or contradictory terms in a services agreement (fee in words vs figures, payment terms, termination, IP, governing law, signatures). 5 checks that an invoice bills what the contract says (client, rates, terms, dates, currency). |
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
  it's skipped. If nothing in the app changed, the hook does nothing and spends no credits. Failures
  are remembered too: unchanged code gets the same bug report back in under a second instead of a
  new 2-minute Kane run (`--no-cache` forces fresh runs).
- **Separates bugs from bad checks.** When Kane decides a failure is a problem with the check rather
  than the product, it's reported as *inconclusive*. The agent is told **not** to change app code for it.
- **Can't loop forever.** After 3 failed fix attempts it stops and hands over to a human, with the
  report in `.kane/report.md`.

## MCP server: use it from any agent

The repo ships a project `.mcp.json`, so **Claude Code** picks the server up automatically when opened
here. For other clients, add this to their MCP config (Claude Desktop: `claude_desktop_config.json`;
Cursor: `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "invoiceguard": {
      "command": "node",
      "args": ["/absolute/path/to/kanehack/mcp/server.mjs"],
      "env": { "LT_USERNAME": "your-testmu-username", "LT_ACCESS_KEY": "your-testmu-access-key" }
    }
  }
}
```

Then just ask the agent in plain words:

- *"Check examples/contract-with-gaps.md before I sign it."* → `check_document`: 4 problems, including
  the fee written as "Four Thousand Five Hundred" next to "$4,800" and the missing governing-law clause.
- *"Does invoice-for-contract.html match contract-signed.md?"* → `check_invoice_against_contract`: billed
  $165/hour vs the agreed $150, and Net 15 vs the agreed Net 30.
- *"I changed the tax code, verify the app."* → `verify_project`: the same Kane gate as `npm run gate`.

| Tool | Input | Returns |
| --- | --- | --- |
| `list_rulebooks` | none | every rulebook and rule |
| `check_document` | one of `url` / `html` / `text` / `file`; optional `rulebook`, `extra_rules` | pass/fail, rules not met, evidence, suggested fix, Kane recording link |
| `check_invoice_against_contract` | `invoice` and `contract` (each url/html/text/file) | the same, for the five invoice-vs-contract rules |
| `verify_project` | optional `only`, `no_cache` | per-check results + Kane's bug report for failures |

Each Kane run takes about 1–3 minutes, and the server sends progress notifications while it works.
If your client times out long tool calls, raise its limit (Claude Code: `MCP_TOOL_TIMEOUT=600000`).
`node scripts/mcp-smoke.mjs --kane` drives the server exactly like an agent would.

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
npm run audit -- examples/contract-with-gaps.md       # contract: words vs figures, no governing law, …
```

To get the agent loop in Claude Code:

```bash
node cli/invoiceguard.mjs init          # adds the Stop hook to .claude/settings.json
claude                                  # work as usual; Kane signs off before Claude stops
```

### Try the demo bugs

Two one-line "refactors" that look harmless. The unit tests stay green for both; Kane catches both.

| Patch | What breaks | What Kane reports |
| --- | --- | --- |
| `demo/place-of-supply-bug.patch` | Place of supply defaults to the **seller's** state, so out-of-state clients get CGST+SGST instead of IGST | *"Invoice preview retains Karnataka after client state changes"* |
| `demo/us-tax-on-subtotal-bug.patch` | The US invoice template taxes the **whole subtotal**, including non-taxable services | *"Sales tax includes a non-taxable line item: should be $76.31, not $274.31"* |

```bash
git apply demo/place-of-supply-bug.patch
npm test              # ✓ 17 passed: the unit tests can't see it
npm run gate          # ✗ Create an inter-state invoice from the editor
git apply -R demo/place-of-supply-bug.patch
```

**The real agent loop:** [`docs/evidence/closed-loop.md`](docs/evidence/closed-loop.md) is the transcript
of a real Claude Code session. Claude was asked to apply the "teammate refactor" and finish. The Stop
hook blocked it with Kane's report, Claude fixed the bug, and the hook let it finish, in 4 minutes
with no human in between.

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

The rulebooks cover common mandatory fields, tax decisions and contract terms. They are not tax or legal
advice.

- **India:** check with your CA for e-invoicing (IRN/QR), exports, SEZ supplies and reverse-charge cases.
- **US:** state base rates are only a starting point. Enter your customer's combined state + local rate,
  and check product taxability and nexus thresholds for each state with your accountant.

## License

MIT
