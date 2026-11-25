# ✓ Tickmark

[![Tickmark CI](https://github.com/N-45div/kanehack/actions/workflows/tickmark.yml/badge.svg)](https://github.com/N-45div/kanehack/actions/workflows/tickmark.yml)

**Every invoice read the way your client reads it, before it goes out.**

A tickmark is what an auditor puts beside every figure they have checked. Tickmark does that for
invoices: tax rules written in plain English, [Kane CLI](https://github.com/LambdaTest/kane-cli) reading
each invoice in a real browser, code re-adding every number Kane reads, and Claude Code not allowed to say
"done" until all of it passes. India GST and US sales tax built in, contracts too.

| | |
| --- | --- |
| **Unit tests caught 2 of 5 planted tax bugs. Kane CLI caught 5 of 5.** Three of them live in what the customer sees, not in the tax logic. | [proof](docs/evidence/prove.md) |
| **Pointed at a 531★ open-source GST app we didn't write,** Tickmark confirmed its GST logic and caught its default invoice contradicting itself: "payment due within 7 days" above a due date 15 days out. | [in the wild](docs/evidence/real-world.md) |
| **Kane reads, code does the math.** Kane is unreliable at arithmetic, so it only reads; code re-adds every sum and counts every due date. Kane's reader is exported to Playwright, so that check costs 0 credits. | [how](#kane-reads-code-does-the-math) |

**Try it in 15 seconds, no account:** `npm install && npx playwright install chromium && npm run demo`

![A real Claude Code session: the Stop hook blocks Claude with Kane's bug report, Claude fixes it, the hook lets it finish](docs/images/closed-loop.png)

<sub>Excerpt from a real session, shown as a terminal: full transcript in
[docs/evidence/closed-loop.md](docs/evidence/closed-loop.md).</sub>

**Live app:** https://tickmark-invoices.vercel.app · **every Kane check recorded** ([recordings](docs/evidence/recordings.md))

> Built for the [KaneCLI Hackathon](https://www.kaneclihack.sh/) · agent: Claude Code · verifier: Kane CLI

## For judges: one link per criterion

| Criterion | Where to see it |
| --- | --- |
| **Works end to end** | The [live app](https://tickmark-invoices.vercel.app); `npm run demo` (no account, 15 s); `npm run gate` (Kane checks every sample invoice and flow) |
| **Kane caught or proved something real** | [An audit of a real invoice from a 531★ open-source GST app](docs/evidence/real-world.md), including what Kane missed · [5/5 planted bugs vs 2/5 for unit tests](docs/evidence/prove.md) |
| **The agent and Kane talk to each other** | [A real Claude Code transcript](docs/evidence/closed-loop.md): the Stop hook blocks Claude with Kane's bug report, Claude fixes the code, Kane re-checks, Claude may finish |
| **Verified, not vibes** | One `Assert that …` per rule; arithmetic and dates checked in code, not by the model ([why](#kane-reads-code-does-the-math)); readers installed only if they read every known-good sample; [recordings](docs/evidence/recordings.md) of every check |
| **Closed loop** | [The loop](#the-closed-loop): blocks only on real product bugs, reports bad checks as *inconclusive*, gives up after 3 tries |
| **Ships** | CLI, Claude Code Stop hook, [MCP server](#mcp-server-use-it-from-any-agent) for any agent, green CI, MIT, [contributing guide](CONTRIBUTING.md) |
| **Honest about limits** | [What Kane and Tickmark get wrong](#honest-limits) |

| India · GST | United States · sales tax |
| --- | --- |
| ![India GST invoice editor: a Mumbai client billed IGST 18%](docs/images/india-editor.png) | ![US invoice editor: tax only on the taxable brochures](docs/images/us-editor.png) |

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
| **Rulebooks** (`kane/rules/`) | `india-gst.md`: 14 rules based on the mandatory contents of a tax invoice ([CGST Rules, rule 46](https://cbic-gst.gov.in/)). `us-sales-tax.md`: 11 rules for nexus, taxability, exemptions, math and payment terms. Plain English, editable by anyone. Add a rulebook for your own country. |
| **User flows** (`kane/flows/*.md`) | Plain-English journeys through the editor, e.g. "bill a Mumbai client and expect IGST 18%" or "tax only the taxable line for a Texas customer". |
| **`tickmark gate`** | Kane opens every sample invoice and flow in an isolated headless Chrome (in parallel) and checks them. |
| **`tickmark hook`** | Claude Code **Stop hook**. If the app changed, Kane re-verifies; failures come back to Claude as a block with Kane's bug title, root cause, evidence and suggested fix. |
| **`tickmark audit <url\|file>`** | Audit *any* invoice you receive, from a link, an HTML or Markdown file, or a PDF. It works out whether the invoice is Indian or American and uses the matching rulebook. |
| **MCP server** (`mcp/server.mjs`) | Any MCP agent (Claude Code, Claude Desktop, Cursor, Windsurf, Codex) can call `check_document`, `check_invoice_against_contract`, `list_rulebooks` and `verify_project`. Kane's verdict comes straight back to the agent. |
| **Contract rulebooks** (`kane/rules/services-contract.md`, `invoice-vs-contract.md`) | 12 checks for missing or contradictory terms in a services agreement (fee in words vs figures, payment terms, termination, IP, governing law, signatures). 5 checks that an invoice bills what the contract says (client, rates, terms, dates, currency). |
| **CI** (`.github/workflows/tickmark.yml`) | The same gate on every push and PR. |

## Kane reads, code does the math

Kane is excellent at **reading** an invoice and unreliable at **arithmetic**. In testing it passed
"each amount equals quantity × rate" on a line showing 12 × $45.00 = $450.00, and on a real invoice it
passed "payment due within 7 days" next to a due date 15 days out. So every invoice check
runs two Kane passes in parallel:

1. **The rules pass.** Kane checks the plain-English rulebook, one `Assert that …` per rule.
2. **The reading pass.** Kane only copies values off the page: line items, rates, taxable flags,
   tax lines, round off, total, amount in words, the invoice and due dates, and the payment terms.

`cli/mathcheck.mjs` then re-adds those numbers in plain code:

- each line amount = quantity × rate,
- subtotal = the sum of the lines,
- US tax = rate × the *taxable* lines; India tax = each line × its GST rate,
- total = subtotal + tax + round off,
- the amount in words matches the total (lakh/crore and thousand/million),
- the due date is as many days after the invoice date as the payment terms say ("Net 30", "within 7 days").
  Numeric dates like 03/12/2026 can be read two ways, so a contradiction is reported only when no reading fits.

An arithmetic error fails the check with the exact numbers, even when Kane's own assertions passed:

```
✗ Audit of us-vendor-invoice.html
    • math: Line 2 (Branded USB drives): amount $450.00 but 12 × $45.00 = $540.00
    • math: Sales tax $160.88 but 8.25% of the taxable lines ($450.00) is $37.13
```

Passing checks say how many sums were re-added (`· math ✓ 6 sums`). The reading pass costs about
20 extra Kane credits per invoice check, and unchanged invoices are still served from cache.

Every `gate` and `audit` run also writes a one-page HTML report (`.kane/report.html`, `.kane/audit.html`)
you can open, screenshot or attach to a PR. This is the real audit of `examples/us-vendor-invoice.pdf`:

![Audit report: 2 arithmetic errors found in a vendor PDF](docs/images/audit-report.png)

### Graduated readers: the math check for zero credits

Kane can export a test it has written as plain Playwright code. `tickmark graduate` uses that:

1. Kane writes a reading test once for each invoice layout (about 25 credits).
2. Kane exports it to Playwright.
3. Tickmark cleans it up: it keeps only the reads, drops Kane's own self-checks and any account
   ids, and takes the invoice URL as a parameter. Kane sometimes finds a value by what it saw on that one
   invoice (a cell named "$3,325.00", the text "-12-2026 (Net 30)"), even when told the page's test ids;
   for fields with their own `data-testid`, the cleanup points the step at the test id and returns the
   text as printed, and the math check does the parsing.
4. The reader is installed only if, on **every** known-good sample invoice of that layout, it finds no
   errors and reads enough to check the subtotal, the total and the due date. A reader that silently
   reads less would make the math check skip sums, so it is refused.

From then on, `npm run math` reads every sample invoice in about a second each, **offline and for zero
Kane credits**, and the math check re-adds the numbers. The gate uses the graduated readers too. If one
finds an arithmetic error, a Kane reading pass confirms it before anything fails, so a reader that no
longer fits a changed layout can't block anyone by itself.

```
$ npm run math                      # with demo/us-tax-on-subtotal-bug.patch applied
✗ us-taxable-goods 1009ms
    • Sales tax $274.31 but 8.25% of the taxable lines ($925.00) is $76.31
```

Readers live in `kane/graduated/`. Re-run `npm run graduate` after changing an invoice layout.

### What we tried: Kane `testmd` replay

Kane can replay a recorded test without the AI: 58 s and about 2 credits instead of about 4.5 minutes
and 180 credits to write it. We measured it and decided not to use it for the gate:

- When nothing changed, our content-hash cache is already free and instant.
- When an invoice changed, Kane heals the steps with the AI anyway, at roughly the cost of a fresh check.
- With the US tax bug applied, the replayed rule checks **passed the tax rule**. They repeated the
  reasoning recorded on the clean invoice.

Exporting to Playwright, and checking the numbers in code, turned out to be the better way to save credits.

## The closed loop

```
 you: "add X to the invoice editor"
        │
        ▼
 Claude Code edits app/ ──► tries to finish ──► Stop hook: tickmark hook
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
  than the product, it's reported as *inconclusive*. Only real product bugs block the agent. Inconclusive
  checks are shown once as a warning for a human to look at, and the same code isn't re-run on every
  stop, since re-running can't fix a misread rule and only spends credits.
- **Can't loop forever.** After 3 failed fix attempts it stops and hands over to a human, with the
  report in `.kane/report.md`.

## MCP server: use it from any agent

The repo ships a project `.mcp.json`, so **Claude Code** picks the server up automatically when opened
here. For other clients, add this to their MCP config (Claude Desktop: `claude_desktop_config.json`;
Cursor: `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tickmark": {
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

**In 2 minutes, no Kane account needed.** This runs the app and re-adds every sample invoice through
the graduated readers:

```bash
npm install
npx playwright install chromium         # browser for the graduated readers
npm run demo                            # 15 s: a tax bug the unit tests miss, caught for free
npm test                                # unit tests: tax logic, math check, export cleanup
npm run math                            # re-adds all 8 sample invoices (0 credits)
```

**The full Kane CLI experience** ([free credits on signup](https://www.testmuai.com/kane-cli/)):

```bash
npm install -g @testmuai/kane-cli
kane-cli login                          # or set LT_USERNAME / LT_ACCESS_KEY

npm run dev                             # http://localhost:3000
npm run gate                            # Kane verifies every sample invoice + flow
npm run audit -- examples/india-vendor-invoice.html   # wrong GST type + GSTIN/state mismatch
npm run audit -- examples/us-vendor-invoice.html      # taxed a non-taxable service + bad line math
npm run audit -- examples/us-vendor-invoice.pdf       # the same invoice as a PDF (needs pdftotext, from poppler-utils)
npm run audit -- examples/contract-with-gaps.md       # contract: words vs figures, no governing law, …
npm run prove                                         # plant 5 bugs, scorecard of unit tests vs Kane
npm run graduate                                      # re-write the readers after a layout change
```

In Claude Code, `/tickmark check <file>`, `/tickmark match <invoice> <contract>`,
`/tickmark verify` and `/tickmark math` drive the same checks through the MCP server.

To get the agent loop in Claude Code:

```bash
node cli/tickmark.mjs init          # adds the Stop hook to .claude/settings.json
claude                                  # work as usual; Kane signs off before Claude stops
```

### Proof: Kane catches what unit tests can't

`npm run prove` plants 5 realistic bugs one at a time (`demo/*.patch`), runs the unit tests and the
Kane gate on each, and always reverts. Latest run ([full report with recordings](docs/evidence/prove.md)):

| Planted bug | Where | Unit tests | Kane CLI |
| --- | --- | --- | --- |
| IGST only for registered (B2B) buyers | India tax logic | ✅ | ✅ |
| Place of supply defaults to the seller's state | India editor (UI) | ❌ | ✅ |
| Resale certificate ignored for in-state resellers | US tax logic | ✅ | ✅ |
| Sales tax charged on the whole subtotal | US invoice template | ❌ | ✅ |
| Amount in words uses the taxable value | India invoice template | ❌ | ✅ |

**Kane CLI: 5/5. Unit tests: 2/5.** Unit tests see the tax logic; only Kane sees what the customer sees.

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

**Watch Kane work:** [`docs/evidence/recordings.md`](docs/evidence/recordings.md) links the Kane CLI
recording of every check: each step in Chrome, what Kane read, and every assertion.

**The real agent loop:** [`docs/evidence/closed-loop.md`](docs/evidence/closed-loop.md) is the transcript
of a real Claude Code session. Claude was asked to apply the "teammate refactor" and finish. The Stop
hook blocked it with Kane's report, Claude fixed the bug, and the hook let it finish, in 4 minutes
with no human in between.

## In the wild: a real open-source GST app

We pointed Tickmark at [Free GST Billing Software](https://github.com/IamRamgarhia/Free-GST-Billing-Software)
(531★, MIT, v1.10.86), an app we didn't write, with a fictional business, and audited a PDF it exported.
Its GST logic held up: IGST for an inter-state supply, matching GSTINs, correct lakh amounts in words,
every sum right. The audit still found:

- **A contradiction:** the default freelancer terms say "payment due within 7 days" on an invoice whose
  default due date is 15 days out. Kane read the dates and terms; code counted the days.
- **One to review:** no signatory line unless a signature image is uploaded (CGST rule 46(q)).

We also found a bug Kane did **not** confirm: a whole-bill discount typed for one client shows up on the
next client's new invoice. A script reproduces it every time and the code explains it, but our Kane flow for
it passed twice, taking a different path through the app. The write-up says exactly that.

It also exposed two mistakes of ours, both fixed: rules that assumed our own invoice layout, and a date rule
Kane couldn't count. [Full write-up, code references and how to reproduce it](docs/evidence/real-world.md).

## Configuration

`tickmark.config.json`:

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

## Honest limits

- **Kane can't be trusted with arithmetic or dates.** It passed 12 × $45 = $450, and a 15-day due date
  under "payment due within 7 days". Every such rule is tagged `[math]` and checked in code instead.
- **Rules can carry hidden assumptions.** Ours first expected state codes "in brackets", like our own
  invoices print them, and failed a correct invoice from another app. They're worded for any layout now.
- **Rule 11 doesn't model after-GST (cash) discounts.** "Total = taxable value + tax + round off" flags them.
- **Kane's exported readers pin what they saw.** Even when told the test ids, Kane located some values
  by the text or amount on the invoice it learned from. Our cleanup re-points those steps, and the strict
  install check refused two readers that would have skipped sums.
- **Free, offline reading is only for our own layouts.** Any other invoice gets a Kane reading pass
  (about 20 credits) before the math check.
- **Kane is not instant.** A check takes 1–3 minutes; the cache skips unchanged invoices, and the Stop hook
  does nothing if the app didn't change.
- **Kane's replay didn't help us.** Replayed checks repeated the reasoning recorded on a clean invoice and
  passed a planted bug ([details](#what-we-tried-kane-testmd-replay)).
- **A Kane flow can take its own path.** On the open-source app, Kane passed a flow that a script fails
  every time: it clicked Save twice and re-entered a value, and missed the bug. Flows that must hit an
  exact sequence need to spell it out.
- **Not tax or legal advice.** See the [disclaimer](#disclaimer).

## Roadmap

- **npm package:** `npx tickmark init` in any project, `npx tickmark audit invoice.pdf` anywhere.
- **More rulebooks:** EU VAT (incl. reverse charge), UK VAT, Australia and New Zealand GST, Canada GST/HST,
  and e-invoicing fields (EN 16931 / Peppol, ZUGFeRD / Factur-X). Contributions welcome.
- **GitHub Action:** run the gate on pull requests and comment Kane's verdict, plus a scheduled check of a
  live site.
- **Kane gate for any app:** the Stop hook, cache, triage and reader graduation, packaged for apps that
  aren't invoices.
- **More graduated readers** for common invoice layouts, so the math check is free for more documents.

## Contributing

The best contribution is a **rulebook for your country**: plain-English rules in a Markdown file,
checked by Kane CLI. [CONTRIBUTING.md](CONTRIBUTING.md) walks through it, and the
"New country rulebook" issue template helps you propose rules before writing code.

## Security

Documents you check are opened in a browser that Kane CLI records (screenshots, page text) in your
TestMu account, so Tickmark is careful about what it shows it:

- Only invoice and contract formats are checked (`.html`, `.md`, `.txt`, `.pdf`, up to 10 MB).
- When an **AI agent** picks the document (MCP tools), the file must be inside the project folder,
  symlinks included, so a manipulated agent can't send `~/.ssh` or other private files. URLs must be
  `http(s)`, and cloud metadata addresses are refused.
- Results tell the agent that text quoted from a document is data to review, never instructions.
- Credentials stay with `kane-cli login` or `LT_USERNAME` / `LT_ACCESS_KEY`; Tickmark never stores them.

## Disclaimer

The rulebooks cover common mandatory fields, tax decisions and contract terms. They are not tax or legal
advice.

- **India:** check with your CA for e-invoicing (IRN/QR), exports, SEZ supplies and reverse-charge cases.
- **US:** state base rates are only a starting point. Enter your customer's combined state + local rate,
  and check product taxability and nexus thresholds for each state with your accountant.

## License

MIT
