# Changelog

## Unreleased

- Renamed from **InvoiceGuard** to **Tickmark**, after the mark an auditor puts beside every figure
  they have checked. The CLI is now `tickmark`, the config `tickmark.config.json`, the MCP server
  `tickmark` and the slash command `/tickmark`. Drafts saved in the browser under the old name still load.

## v0.1.0: first release

**InvoiceGuard (now Tickmark): your AI coding agent can't say "done" until a real browser says the invoice is right.**

### Invoices
- Invoice maker with a live preview for **India (GST)**: IGST vs CGST/SGST/UTGST, GSTIN checksum and
  state check, HSN/SAC, round-off, amount in words in lakh/crore, financial-year invoice numbers.
- **United States (sales tax)**: nexus states, per-line taxable flag, exemption and resale certificates,
  no-sales-tax states.
- Eight sample invoices covering the main tax cases; a live app on Vercel.

### Verification with Kane CLI
- Plain-English rulebooks (`kane/rules/`) for India GST, US sales tax, services contracts and
  invoice-vs-contract checks. Each rule is one Kane assertion; `[math]` rules are checked in code.
- `gate`: Kane checks every sample invoice and editor journey in isolated, parallel Chrome sessions, with a
  content-hash cache of passes and failures and triage of product bugs vs inconclusive checks.
- `audit`: check any invoice or contract you receive (HTML, Markdown, text or PDF; rulebook auto-detected).
- **Kane reads, code does the math**: a reading pass plus a deterministic math check for line amounts,
  subtotal, tax, total and amount in words.
- **Graduated readers**: Kane writes a reading test once and exports it to Playwright; validated on every
  sample, it re-checks invoices offline for zero credits (`npm run math`).
- `prove`: plants five realistic tax bugs and scores unit tests vs Kane.
- One-page HTML reports for every gate and audit run.

### Agents
- **Claude Code Stop hook**: blocks the agent until Kane passes and feeds back the bug title, root cause,
  evidence, suggested fix, recording and evidence pack. Inconclusive checks never block.
- **MCP server**: `check_document`, `check_invoice_against_contract`, `list_rulebooks`, `verify_project`,
  plus the `/invoiceguard` slash command.

### Safety
- Agent-chosen documents must be invoice formats inside the project; cloud metadata URLs are refused;
  quoted document text is flagged as data, not instructions; reports escape all document text.

### Getting started
- `npm run demo`: a tax bug the unit tests miss, caught in 15 seconds with no account.
- CI: free checks on every pull request; the Kane gate runs when credentials are configured.
