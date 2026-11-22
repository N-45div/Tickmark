#!/usr/bin/env node
// InvoiceGuard MCP server: lets any MCP-capable agent (Claude Code, Claude
// Desktop, Cursor, Windsurf, Codex…) check invoices and contracts with Kane CLI.
// Kane opens each document in a real Chrome, checks it against a plain-English
// rulebook, and the verdict (broken rules, evidence, suggested fix, recording)
// comes straight back to the agent.
//
// Runs over stdio. Logs go to stderr only; stdout is the MCP channel.

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  detectPack, failureReport, gate, invoiceObjective, loadConfig, loadPack, loadRulebook,
  ruleAssertions, serveComparison, serveDocuments, verify,
} from "../cli/invoiceguard.mjs";

const cfg = loadConfig();
const PACKS = Object.keys(cfg.rulePacks);

const server = new McpServer(
  { name: "invoiceguard", version: "0.2.0" },
  {
    instructions: [
      "InvoiceGuard checks invoices and contracts with Kane CLI, which reads each document in a real browser.",
      "Use check_document for one invoice or contract, check_invoice_against_contract to confirm an invoice bills what a contract agreed,",
      "and verify_project to re-verify this app after you change its code. Each Kane run takes about 1-3 minutes.",
      "Results are not legal or tax advice; surface them to the user as findings to review.",
    ].join(" "),
  },
);

// ------------------------------------------------------------------ helpers

const documentShape = {
  url: z.string().url().optional().describe("Public or localhost URL of the document"),
  html: z.string().optional().describe("The document as an HTML string"),
  text: z.string().optional().describe("The document as plain text or Markdown (e.g. a contract)"),
  file: z.string().optional().describe("Path to an .html, .md, .txt or .pdf file, relative to the server's working directory"),
};
const documentSchema = z.object(documentShape).describe("Exactly one of url, html, text or file");

function pickDocument(doc, label) {
  const given = ["url", "html", "text", "file"].filter((k) => doc?.[k]);
  if (given.length !== 1) throw new Error(`${label}: give exactly one of url, html, text or file (got ${given.length || "none"})`);
  return { [given[0]]: doc[given[0]], name: label };
}

/** Send MCP progress notifications while a long Kane run is going. */
function keepAlive(extra, message) {
  const token = extra?._meta?.progressToken;
  if (token === undefined) return () => {};
  let progress = 0;
  const tick = () => extra.sendNotification({
    method: "notifications/progress",
    params: { progressToken: token, progress: ++progress, message },
  }).catch(() => {});
  tick();
  const timer = setInterval(tick, 10_000);
  return () => clearInterval(timer);
}

function summarize(result) {
  return {
    status: result.status, // passed | failed | inconclusive | error
    bug_title: result.bugTitle ?? null,
    root_cause: result.rootCause ?? result.summary ?? result.reason ?? null,
    broken_rules: result.failedSteps ?? [],
    arithmetic_errors: result.math?.findings ?? [], // re-added in code from the numbers Kane read
    sums_checked: result.math?.checked ?? [],
    evidence: result.evidence ?? [],
    suggestion: result.suggestion ?? null,
    recording_url: result.testUrl ?? null,
    seconds: result.seconds ?? null,
    kane_credits: result.credits ?? null,
  };
}

function toMarkdown(title, s) {
  const icon = { passed: "✅", failed: "❌", inconclusive: "⚠️", error: "⚠️" }[s.status] ?? "•";
  const lines = [`${icon} **${title}: ${s.status.toUpperCase()}**`];
  if (s.status === "inconclusive") lines.push("Kane judged this a problem with the check itself, not with the document.");
  if (s.bug_title) lines.push(`**Issue:** ${s.bug_title}`);
  if (s.root_cause) lines.push(s.root_cause);
  if (s.broken_rules.length) lines.push("**Rules not met:**\n" + s.broken_rules.map((r) => `- ${r.replace(/^assert:\s*/, "")}`).join("\n"));
  if (s.arithmetic_errors.length) lines.push("**Arithmetic errors (re-added in code from the numbers Kane read):**\n" + s.arithmetic_errors.map((f) => `- ${f}`).join("\n"));
  else if (s.sums_checked.length) lines.push(`Arithmetic: ${s.sums_checked.length} sums re-added in code, all correct.`);
  if (s.evidence.length) lines.push("**Seen on the page:**\n" + s.evidence.map((e) => `- ${e}`).join("\n"));
  if (s.suggestion) lines.push(`**Suggested fix:** ${s.suggestion}`);
  if (s.recording_url) lines.push(`[Kane recording](${s.recording_url})`);
  return lines.join("\n\n");
}

const ok = (markdown, structured) => ({ content: [{ type: "text", text: markdown }], structuredContent: structured });
const fail = (err) => ({ isError: true, content: [{ type: "text", text: `InvoiceGuard: ${err.message ?? err}` }] });

// ------------------------------------------------------------------ tools

server.registerTool("list_rulebooks", {
  title: "List rulebooks",
  description: "List the plain-English rulebooks InvoiceGuard can check documents against (e.g. India GST invoices, US sales tax invoices, services contracts), with every rule.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  try {
    const books = PACKS.map((name) => { const p = loadPack(cfg, name); return { name, title: p.title, file: p.file, rules: p.rules }; });
    const cross = loadRulebook("kane/rules/invoice-vs-contract.md");
    const md = [...books, { name: "invoice-vs-contract", ...cross }]
      .map((b) => `### ${b.name}: ${b.title}\n${b.rules.join("\n")}`).join("\n\n");
    return ok(md, { rulebooks: books, cross_check: { title: cross.title, rules: cross.rules } });
  } catch (err) { return fail(err); }
});

server.registerTool("check_document", {
  title: "Check an invoice or contract",
  description: [
    "Kane CLI opens the document in a real Chrome browser and checks it against a plain-English rulebook.",
    "Works for invoices (India GST, US sales tax) and services contracts; the rulebook is auto-detected unless given.",
    "Returns pass/fail, each rule that is not met, the evidence Kane saw, a suggested fix and a recording link.",
    "Takes about 1-3 minutes.",
  ].join(" "),
  inputSchema: {
    ...documentShape,
    rulebook: z.enum(["auto", ...PACKS]).default("auto").describe("Which rulebook to apply; 'auto' detects it from the document"),
    extra_rules: z.array(z.string()).optional().describe("Additional plain-English rules to check, e.g. 'The invoice includes a PO number.'"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async (args, extra) => {
  let docs;
  try {
    docs = await serveDocuments([pickDocument(args, "document")]);
    const name = args.rulebook && args.rulebook !== "auto" ? args.rulebook : detectPack(docs.texts[0]);
    if (!name) throw new Error(`Could not tell what kind of document this is. Pass rulebook: one of ${PACKS.join(", ")}.`);
    const pack = loadPack(cfg, name);
    if (args.extra_rules?.length)
      pack.kaneRules = [...pack.kaneRules, ...args.extra_rules.map((r, i) => `${pack.rules.length + i + 1}. ${r.replace(/^\d+\.\s*/, "")}`)];
    const stop = keepAlive(extra, `Kane is reading the document against "${pack.title}"`);
    const result = await verify({
      objective: invoiceObjective(pack), url: docs.urls[0], timeoutSeconds: cfg.timeoutSeconds,
      visual: docs.visual[0], allFailures: true, logName: `mcp-${name}`, mathCheck: pack.kind === "invoice", mathRules: pack.mathRules?.length ?? 0,
    }).finally(stop);
    const s = { rulebook: name, ...summarize(result) };
    return ok(toMarkdown(`Checked against "${pack.title}"`, s), s);
  } catch (err) { return fail(err); }
  finally { docs?.close(); }
});

server.registerTool("check_invoice_against_contract", {
  title: "Check an invoice against its contract",
  description: [
    "Kane CLI reads the contract, then the invoice, in a real browser and checks that the invoice bills what was agreed:",
    "client legal name, rates and fees, payment terms and due date, invoice date within the contract term, and currency.",
    "Takes about 1-3 minutes.",
  ].join(" "),
  inputSchema: { invoice: documentSchema, contract: documentSchema },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ invoice, contract }, extra) => {
  let docs;
  try {
    docs = await serveComparison(pickDocument(contract, "contract"), pickDocument(invoice, "invoice"));
    const book = loadRulebook("kane/rules/invoice-vs-contract.md");
    const objective = [
      "This page shows two documents: DOCUMENT 1 is a services contract (top section) and DOCUMENT 2 is an invoice issued under it (bottom section).",
      "From the contract section, store: the client's legal name as 'contract_client', every agreed rate or fee with currency and unit as 'contract_rates',",
      "the payment terms as 'contract_terms', and the effective date and end date (if any) as 'contract_dates'.",
      "From the invoice section, store: the bill-to name as 'invoice_client', every rate or fee billed with currency and unit as 'invoice_rates',",
      "the payment terms and due date as 'invoice_terms', and the invoice date as 'invoice_date'.",
      "Then check each of the following statements one at a time by comparing the stored values. Any statement that is false is a product bug; quote what the contract says and what the invoice says.",
      "",
      ...ruleAssertions(book.rules),
    ].join("\n");
    const stop = keepAlive(extra, "Kane is comparing the invoice with the contract");
    const result = await verify({
      objective, url: docs.urls[0], timeoutSeconds: cfg.timeoutSeconds, allFailures: true, logName: "mcp-invoice-vs-contract",
    }).finally(stop);
    const s = { rulebook: "invoice-vs-contract", ...summarize(result) };
    return ok(toMarkdown("Invoice vs contract", s), s);
  } catch (err) { return fail(err); }
  finally { docs?.close(); }
});

server.registerTool("verify_project", {
  title: "Verify this app with Kane",
  description: [
    "Run InvoiceGuard's Kane gate on this project: every sample invoice and user flow listed in invoiceguard.config.json",
    "is opened in a real browser and checked against its rulebook. Use it after changing invoice code; if it fails,",
    "fix the application code (never weaken the rulebooks) and run it again. Unchanged invoices are skipped.",
  ].join(" "),
  inputSchema: {
    only: z.string().optional().describe("Only run checks whose id contains this text, e.g. 'flow' or 'us-'"),
    no_cache: z.boolean().default(false).describe("Re-run every check even if unchanged since the last pass"),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
}, async ({ only, no_cache }, extra) => {
  if (!fs.existsSync(path.join(process.cwd(), "invoiceguard.config.json")))
    return fail("No invoiceguard.config.json in the server's working directory, so there is no project to verify.");
  const stop = keepAlive(extra, "Kane is verifying the app");
  try {
    const summary = await gate({ only, noCache: no_cache });
    const failures = summary.results.filter((x) => x.result.status !== "passed");
    const lines = summary.results.map(({ check, result }) =>
      `- ${{ passed: "✅", failed: "❌" }[result.status] ?? "⚠️"} ${check.title}${result.cached ? " (unchanged, skipped)" : ""}`);
    const md = [
      summary.passed ? `✅ **All ${summary.results.length} Kane checks passed.**` : `❌ **${failures.length} of ${summary.results.length} Kane checks failed.** Fix the application code, then run verify_project again.`,
      lines.join("\n"),
      failures.length ? failureReport(failures) : "",
    ].filter(Boolean).join("\n\n");
    return ok(md, {
      passed: summary.passed,
      checks: summary.results.map(({ check, result }) => ({ id: check.id, title: check.title, ...summarize(result), cached: !!result.cached })),
    });
  } catch (err) { return fail(err); }
  finally { stop(); }
});

await server.connect(new StdioServerTransport());
console.error("invoiceguard MCP server ready (stdio)");
