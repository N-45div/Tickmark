---
description: Check invoices and contracts with Kane CLI, or verify this app (Tickmark)
argument-hint: check <file|url> | match <invoice> <contract> | verify | math | rules
---

You are running Tickmark for the user. Arguments: `$ARGUMENTS`

Pick the action from the first word of the arguments, then report the result in plain language:
what passed, what failed, the evidence, the suggested fix and the Kane recording link.
Results are findings for the user to review, not legal or tax advice.

- `check <file or url>` → call the `check_document` tool of the `tickmark` MCP server with
  `file` (a local path) or `url`. The rulebook (India GST, US sales tax or services contract) is
  detected automatically. Arithmetic errors come from Tickmark's math check; say so.
- `match <invoice> <contract>` → call `check_invoice_against_contract` with both documents.
- `verify` → call `verify_project` (the same as `npm run gate`). If a check **failed**, read Kane's
  bug report, fix the application code (never weaken `kane/rules/` or `kane/flows/`), and run
  `verify` again. If a check is only **inconclusive**, don't change app code: show it to the user.
- `math` → run `npm run math` (graduated readers + math check, no Kane credits) and summarise it.
- `rules` → call `list_rulebooks` and show the rulebooks briefly.
- No arguments → explain these options in two or three lines.

Each Kane run takes about 1–3 minutes; tell the user before starting one.
