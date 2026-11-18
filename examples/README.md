# Example documents

Realistic documents with **planted mistakes**, used to show what InvoiceGuard + Kane CLI catch.
The answer key lives here, not inside the files, so Kane has nothing to read but the document itself.

| File | Rulebook (auto-detected) | Planted mistakes |
| --- | --- | --- |
| `india-vendor-invoice.html` | India GST | Karnataka → Maharashtra supply charged CGST + SGST instead of IGST; buyer GSTIN starts with 29 (Karnataka) but the buyer is in Maharashtra (27) |
| `us-vendor-invoice.html` | US sales tax | Sales tax charged on a non-taxable consulting line; line 2 shows 12 × $45.00 = $450.00 (should be $540.00) |
| `contract-with-gaps.md` | Services contract | Fee in words (Four Thousand Five Hundred) ≠ figures ($4,800); no governing-law clause; client signature block has no date line, and the client is named "Lone Star Coffee Company LLC" in the preamble but "Lone Star Coffee Co." at signing |
| `contract-signed.md` + `invoice-for-contract.html` | Invoice vs contract | Invoice bills $165/hour, contract says $150/hour; invoice is Net 15, contract says Net 30 |

```bash
npm run audit -- examples/contract-with-gaps.md
npm run audit -- examples/us-vendor-invoice.html
node scripts/mcp-smoke.mjs --kane      # same checks through the MCP server
```
