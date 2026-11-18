// Drive the InvoiceGuard MCP server like an agent would: list tools, list
// rulebooks, then (optionally) run real Kane checks in parallel.
//   node scripts/mcp-smoke.mjs           # tools + rulebooks only (no Kane credits)
//   node scripts/mcp-smoke.mjs --kane    # also runs check_document + check_invoice_against_contract
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "invoiceguard-smoke", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: "node", args: ["mcp/server.mjs"], stderr: "inherit" }));

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const books = await client.callTool({ name: "list_rulebooks", arguments: {} });
console.log("rulebooks:", books.structuredContent.rulebooks.map((b) => `${b.name} (${b.rules.length})`).join(", "));

if (process.argv.includes("--kane")) {
  const opts = { timeout: 15 * 60_000, resetTimeoutOnProgress: true, onprogress: (p) => console.log("  progress:", p.message) };
  const started = Date.now();
  const [contract, cross] = await Promise.all([
    client.callTool({ name: "check_document", arguments: { file: "examples/contract-with-gaps.md" } }, undefined, opts),
    client.callTool({
      name: "check_invoice_against_contract",
      arguments: { contract: { file: "examples/contract-signed.md" }, invoice: { file: "examples/invoice-for-contract.html" } },
    }, undefined, opts),
  ]);
  for (const r of [contract, cross]) console.log("\n" + r.content[0].text);
  console.log(`\n(${Math.round((Date.now() - started) / 1000)}s for both, in parallel)`);
}
await client.close();
