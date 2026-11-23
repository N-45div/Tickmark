#!/usr/bin/env node
// invoiceguard — verify invoices (India GST, US sales tax) in a real browser with Kane CLI.
//
//   invoiceguard gate            check every sample invoice + user flow of this app
//   invoiceguard audit <url|file> check any invoice page (yours or a vendor's);
//                                 picks the India GST or US sales tax rulebook automatically
//   invoiceguard hook            Claude Code Stop hook: block "done" until Kane passes
//   invoiceguard prove           plant each bug in demo/, run unit tests + Kane, print a scorecard
//   invoiceguard graduate        have Kane write + export a Playwright reader per invoice layout
//   invoiceguard math            re-add every sample invoice's numbers via the readers (0 credits)
//   invoiceguard init            install the hook + rules into the current project
//
// Zero dependencies. Needs `kane-cli` on PATH and a logged-in profile
// (`kane-cli login`), or LT_USERNAME / LT_ACCESS_KEY in the environment.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkInvoiceMath } from "./mathcheck.mjs";
import { graduate as graduateReader, readerPath, runReader } from "./graduate.mjs";

const ROOT = process.cwd();
// Where reports, caches and raw Kane logs go. Falls back to a temp dir when the
// working directory is not writable (e.g. an MCP server launched from "/").
const STATE_DIR = process.env.INVOICEGUARD_STATE_DIR ?? (() => {
  try { fs.accessSync(ROOT, fs.constants.W_OK); return path.join(ROOT, ".kane"); }
  catch { return path.join(os.tmpdir(), "invoiceguard"); }
})();
const PKG_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const tty = process.stderr.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const green = c(32), red = c(31), dim = c(2), bold = c(1), yellow = c(33);
const log = (...a) => console.error(...a);

// ------------------------------------------------------------------ config

function loadConfig() {
  const file = path.join(ROOT, "invoiceguard.config.json");
  const defaults = {
    baseUrl: "http://localhost:3000",
    devCommand: "npm run dev",
    rulePacks: {
      "india-gst": "kane/rules/india-gst.md",
      "us-sales-tax": "kane/rules/us-sales-tax.md",
      "services-contract": "kane/rules/services-contract.md",
    },
    flows: "kane/flows",
    invoices: [],
    watch: ["app", "lib", "components", "src"],
    concurrency: 3,
    timeoutSeconds: 300,
    maxHookAttempts: 3,
  };
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const cfg = { ...defaults, ...user, rulePacks: { ...defaults.rulePacks, ...user.rulePacks } };
  if (cfg.rules) cfg.rulePacks = { default: cfg.rules, ...cfg.rulePacks }; // legacy single-rulebook config
  cfg.invoices = cfg.invoices.map((inv) => typeof inv === "string"
    ? { path: inv, pack: cfg.rules ? "default" : Object.keys(cfg.rulePacks)[0] } : inv);
  return cfg;
}

const sha = (...parts) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Rulebook file → { title, rules } (numbered lines only; headings and prose are ignored). */
function loadRulebook(file) {
  const local = path.resolve(ROOT, file);
  const bundled = path.join(PKG_DIR, file);
  const src = fs.existsSync(local) ? local : bundled;
  if (!fs.existsSync(src)) throw new Error(`Rulebook not found: ${file}`);
  const text = fs.readFileSync(src, "utf8");
  const rules = text.split("\n").filter((l) => /^\s*\d+\.\s+/.test(l)).map((l) => l.trim());
  if (!rules.length) throw new Error(`No numbered rules found in ${file}`);
  // Rules tagged [math] are arithmetic: the math check enforces them in code on every invoice,
  // so Kane (reliable at reading, not at sums) isn't asked to assert them.
  const isMath = (r) => /\[math\]\s*$/i.test(r);
  return {
    title: (text.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(file)).trim(), rules, file,
    kaneRules: rules.filter((r) => !isMath(r)),
    mathRules: rules.filter(isMath).map((r) => r.replace(/\s*\[math\]\s*$/i, "")),
  };
}

function loadPack(cfg, name) {
  const file = cfg.rulePacks[name];
  if (!file) throw new Error(`Unknown rule pack "${name}". Known: ${Object.keys(cfg.rulePacks).join(", ")}`);
  return { name, kind: packKind(name), ...loadRulebook(file) };
}

/** Contract rulebooks are checked as text; everything else is an invoice whose numbers we re-add in code. */
const packKind = (name) => (/contract/i.test(name) ? "contract" : "invoice");

/** Guess which rulebook a document needs from its text. */
function detectPack(text) {
  // Go by what the document calls itself at the top (title + first lines).
  const visible = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
  const head = visible.replace(/\s+/g, " ").trim().slice(0, 300);
  if (/\b(agreement|contract)\b/i.test(head) && !/\binvoice\b/i.test(head)) return "services-contract";
  if (/GSTIN|₹|\b(IGST|CGST|SGST|HSN|SAC)\b/.test(text)) return "india-gst";
  if (/\$\s?\d|\bUSD\b|sales tax/i.test(text)) return "us-sales-tax";
  return null;
}

/** Flow files → { id, title, objective } with {{baseUrl}} filled in. */
function loadFlows(cfg) {
  const dir = path.resolve(ROOT, cfg.flows);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? f).trim();
    const objective = text.replace(/^#.*$/m, "").trim().replaceAll("{{baseUrl}}", cfg.baseUrl.replace(/\/$/, ""));
    return { id: `flow:${f.replace(/\.md$/, "")}`, title, objective, raw: text };
  });
}

/** Hash of every source file under the watched dirs — "has the app changed?" */
function sourceHash(cfg) {
  const h = createHash("sha256");
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else { h.update(path.relative(ROOT, p)); h.update(fs.readFileSync(p)); }
    }
  };
  for (const d of cfg.watch) walk(path.join(ROOT, d));
  for (const f of Object.values(cfg.rulePacks)) if (fs.existsSync(path.join(ROOT, f))) h.update(fs.readFileSync(path.join(ROOT, f)));
  walk(path.join(ROOT, cfg.flows));
  return h.digest("hex").slice(0, 16);
}

// ------------------------------------------------------------------ app server

async function reachable(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; }
}

async function ensureServer(cfg) {
  if (await reachable(cfg.baseUrl)) {
    // Not ours: make it visible, a stale production build would be verified instead of your edits.
    log(dim(`Using the app already running at ${cfg.baseUrl} (make sure it serves your latest code, e.g. \`npm run dev\`)`));
    return;
  }
  log(dim(`Starting app: ${cfg.devCommand}`));
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const out = fs.openSync(path.join(STATE_DIR, "dev-server.log"), "a");
  const child = spawn(cfg.devCommand, { shell: true, detached: true, stdio: ["ignore", out, out], cwd: ROOT });
  child.unref();
  fs.writeFileSync(path.join(STATE_DIR, "dev-server.pid"), String(child.pid));
  for (let i = 0; i < 90; i++) {
    if (await reachable(cfg.baseUrl)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`App did not come up at ${cfg.baseUrl} (see .kane/dev-server.log)`);
}

/** The rendered invoice markup — unchanged markup means Kane's last verdict still holds. */
async function renderedInvoice(url) {
  const html = await (await fetch(url)).text();
  const m = html.match(/<article[^>]*data-testid="invoice"[^>]*>[\s\S]*?<\/article>/);
  return m ? m[0] : html.replace(/<script[\s\S]*?<\/script>/g, "");
}


// ------------------------------------------------------------------ isolated chrome
// Parallel kane-cli runs share one Chrome profile by default and close each
// other's browsers. We give every run its own throwaway headless Chrome and
// attach Kane to it over CDP: parallel-safe and no state leaks between runs.

function chromePath() {
  if (process.env.KANE_CLI_CHROME_PATH) return process.env.KANE_CLI_CHROME_PATH;
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => fs.existsSync(p));
}

async function launchChrome() {
  const bin = chromePath();
  if (!bin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invoiceguard-chrome-"));
  // Port 0: Chrome picks a free port and writes it to DevToolsActivePort, so any
  // number of runs (CLI, CI, parallel MCP calls) can coexist.
  const proc = spawn(bin, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--window-size=1366,900", "about:blank",
  ], { stdio: "ignore" });
  let endpoint = null;
  for (let i = 0; i < 75; i++) {
    if (!endpoint) {
      const portLine = (() => { try { return fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { return ""; } })();
      if (/^\d+$/.test(portLine)) endpoint = `http://127.0.0.1:${portLine}`;
    }
    if (endpoint && await reachable(`${endpoint}/json/version`)) {
      const close = async () => {
        if (proc.exitCode === null) {
          const exited = new Promise((r) => proc.once("exit", r));
          try { proc.kill("SIGKILL"); } catch {}
          await exited;
        }
        try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
      };
      return { endpoint, close };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill("SIGKILL");
  return null;
}

// ------------------------------------------------------------------ kane

/** A rulebook as an explicit checklist: one "Assert that …" per rule, so Kane checks every rule. */
function ruleAssertions(rules) {
  return rules.map((r) => {
    const text = r.replace(/^\s*\d+\.\s*/, "").replace(/\.\s*$/, "");
    return `Assert that ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
  });
}

/**
 * Kane reads, code does the math. A separate Kane pass only copies the numbers off the page,
 * and mathcheck.mjs verifies every sum. It is separate because Kane stops a run as soon as it
 * spots a product bug, which would lose the extraction if both happened in one run.
 */
const EXTRACTION_OBJECTIVE = [
  "This page is an invoice. Do not judge it; only copy these values from the page exactly as printed (keep currency symbols and percent signs):",
  "Store the line items as 'line_items': a JSON array with one object per row of the items table, each with the keys description, quantity, rate, amount and taxable (copy the text of the Taxable or GST column; the word none if there is no such column).",
  "Store the subtotal or total taxable value as 'subtotal'.",
  "Store the tax rows as 'tax_lines': a JSON array with one object per tax row in the totals, each with the keys label and amount.",
  "Store the round off amount as 'round_off' (store the word none if it is not shown).",
  "Store the grand total or total due as 'total'.",
  "Store the amount in words as 'amount_in_words' (store the word none if it is not shown).",
  "Assert that line_items, subtotal, tax_lines and total have been stored.",
].join("\n");

/** Extra guidance when Kane writes a reader that must work on every invoice of a layout. */
const GRADUATION_HINTS = [
  "These steps will be reused on other invoices with the same layout but different numbers, items and tax rows.",
  "So locate values by stable attributes such as data-testid, read every row of a table rather than specific rows,",
  "and never locate anything by the text or numbers you see on this particular invoice.",
].join(" ");

function invoiceObjective(pack) {
  return [
    `This page is a document that is checked against the rulebook "${pack.title}". Read the whole document carefully first.`,
    "Then check each of the following statements one at a time, looking at the document for evidence. Any statement that is false is a product bug.",
    "",
    ...ruleAssertions(pack.kaneRules ?? pack.rules),
  ].join("\n");
}

/** Run one Kane objective; resolves with a normalised result. */
function runKane({ objective, url, timeoutSeconds, visual, cdpEndpoint, allFailures, logName }) {
  const args = ["run", objective, "--agent", "--timeout", String(timeoutSeconds)];
  args.push(...(cdpEndpoint ? ["--cdp-endpoint", cdpEndpoint] : ["--headless"]));
  if (url) args.push("--url", url);
  if (visual) args.push("--assertion-mode", "visual");
  if (allFailures) args.push("--assertion-failure-mode", "continue"); // report every broken rule, not just the first
  if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY)
    args.push("--username", process.env.LT_USERNAME, "--access-key", process.env.LT_ACCESS_KEY);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("kane-cli", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, KANE_CLI_USER_AGENT: "invoiceguard" },
    });
    let buf = "", runEnd = null, lastError = null, stderr = "", evidencePack = null;
    fs.mkdirSync(path.join(STATE_DIR, "runs"), { recursive: true });
    const raw = fs.createWriteStream(path.join(STATE_DIR, "runs", `${(logName ?? "run").replace(/[^\w.-]+/g, "_")}.ndjson`));
    const steps = [];
    child.stdout.on("data", (d) => {
      raw.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "run_end") runEnd = e;
        else if (e.type === "coverage" && e.pack) evidencePack = e.pack; // sealed per-run evidence pack
        else if (e.type === "error") lastError = e.message;
        else if (!e.type && e.status && e.status !== "running") steps.push({ status: e.status, remark: e.remark });
      }
    });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => resolve({ status: "error", reason: `could not start kane-cli: ${err.message}` }));
    child.on("close", (code) => {
      raw.end();
      const seconds = Math.round((Date.now() - started) / 1000);
      if (!runEnd) {
        const reason = code === 3 ? "Kane run timed out" : lastError || stderr.trim().split("\n").pop() || `kane-cli exited ${code}`;
        return resolve({ status: "error", exitCode: code, reason, seconds, steps });
      }
      const v = runEnd.verdict ?? {};
      resolve({
        status: runEnd.status === "passed" ? "passed" : "failed",
        exitCode: code,
        seconds,
        oneLiner: runEnd.one_liner,
        summary: runEnd.summary,
        reason: runEnd.reason,
        bugTitle: v.bug_title,
        rootCause: v.root_cause,
        suggestion: v.suggestion,
        severity: v.severity,
        family: v.family,
        reasonCode: runEnd.reason_code,
        confidence: v.confidence,
        evidence: (v.signals ?? []).map((s) => s.excerpt).filter(Boolean),
        failedSteps: steps.filter((s) => s.status === "failed" && !/^wait:/.test(s.remark ?? "")).map((s) => s.remark),
        testUrl: runEnd.test_url,
        finalState: runEnd.final_state ?? {},
        sessionDir: runEnd.session_dir,
        evidencePack,
        credits: runEnd.credits_consumed ?? runEnd.credits,
      });
    });
  });
}


/** A failure Kane attributes to the product, as opposed to browser/infra trouble. */
const isProductBug = (r) => r.status === "failed" && (!r.family || r.family === "application_issue");

async function verify(opts) {
  if (!opts.mathCheck) return verifyWithKane(opts);
  const [r, read] = await Promise.all([verifyWithKane(opts), readNumbers(opts)]);
  // A graduated reader that finds an arithmetic error might simply be misreading a new layout:
  // confirm with a Kane reading pass before failing anyone. Green stays free; red gets verified.
  if (read.readBy === "graduated reader" && checkInvoiceMath(read.finalState).findings.length) {
    log(dim("  … graduated reader found an arithmetic error; confirming with a Kane reading pass"));
    return withMathCheck(r, await readNumbers({ ...opts, readerFile: null }), opts.mathRules);
  }
  return withMathCheck(r, read, opts.mathRules);
}

/** The numbers on the page: from a graduated reader when there is one (free), else a Kane pass. */
async function readNumbers(opts) {
  if (opts.readerFile) {
    try { return { finalState: await runReader(opts.readerFile, opts.url), credits: 0, readBy: "graduated reader" }; }
    catch (err) { log(dim(`  … graduated reader failed (${err.message.split(": ").pop()}); reading with Kane instead`)); }
  }
  const read = await runKaneOnce({
    objective: EXTRACTION_OBJECTIVE, url: opts.url, timeoutSeconds: opts.timeoutSeconds,
    visual: opts.visual, logName: `${opts.logName ?? "run"}-read`,
  });
  return { ...read, readBy: "Kane" };
}

async function runKaneOnce(opts) {
  const chrome = await launchChrome();
  try { return await runKane({ ...opts, cdpEndpoint: chrome?.endpoint }); }
  finally { await chrome?.close(); }
}

/** Re-add the invoice's numbers (as Kane read them) in code; arithmetic errors fail the check. */
function withMathCheck(r, read, mathRules = 0) {
  if (r.status === "error") return r;
  const math = checkInvoiceMath(read.finalState ?? {});
  math.readCredits = read.credits ?? 0;
  math.readBy = read.readBy;
  // Arithmetic rules are only enforced by this check: if the numbers couldn't be read, those
  // rules were not checked, and a pass would be claiming more than was verified.
  if (math.skipped && mathRules && r.status === "passed")
    return { ...r, math, status: "inconclusive", bugTitle: `Numbers could not be read, so ${mathRules} arithmetic rule(s) were not checked`, reason: math.skipped };
  if (!math.findings.length) return { ...r, math };
  const kaneFound = r.status === "failed";
  return {
    ...r,
    math,
    status: "failed",
    bugTitle: kaneFound && r.bugTitle ? r.bugTitle : `Arithmetic error: ${math.findings[0]}`,
    rootCause: kaneFound ? r.rootCause
      : `InvoiceGuard's math check re-added the numbers Kane read from the page and found ${math.findings.length} error(s).`,
  };
}

async function verifyWithKane(opts) {
  for (let attempt = 1; ; attempt++) {
    const chrome = await launchChrome();
    const r = await runKane({ ...opts, cdpEndpoint: chrome?.endpoint });
    await chrome?.close();
    if (r.status === "passed" || isProductBug(r)) return { ...r, attempts: attempt };
    if (attempt === 2) return { ...r, status: r.status === "failed" ? "inconclusive" : r.status, attempts: attempt };
    log(dim(`  … ${r.bugTitle || r.reason || "Kane run did not finish"}; retrying once`));
  }
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async (_, slot) => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], slot); }
  }));
  return results;
}

// ------------------------------------------------------------------ reporting

function printResult(check, r) {
  const tag = !r.cached ? dim(` ${r.seconds ?? 0}s`)
    : dim(r.status === "passed" ? " (this exact version passed before, skipped)" : " (this exact version failed before, not re-run)");
  const mathTag = r.math && !r.math.findings.length && r.math.checked.length ? dim(` · math ✓ ${r.math.checked.length} sums`) : "";
  if (r.status === "passed") return log(`${green("✓")} ${check.title}${tag}${mathTag}`);
  const mark = r.status === "failed" ? red("✗") : yellow("?");
  if (r.status === "inconclusive") log(`${mark} ${bold(check.title)}${tag} ${yellow("— Kane says the check itself is the problem, not the invoice")}`);
  else
    log(`${mark} ${bold(check.title)}${tag}`);
  if (r.bugTitle) log(`    ${red(r.bugTitle)}`);
  const why = r.rootCause || r.oneLiner || r.reason;
  if (why) log(`    ${why}`);
  for (const f of r.failedSteps ?? []) log(red(`    • ${f.replace(/^assert:\s*/, "")}`));
  for (const f of r.math?.findings ?? []) log(red(`    • math: ${f}`));
  if (r.suggestion) log(dim(`    fix: ${r.suggestion}`));
  if (r.testUrl) log(dim(`    ${r.testUrl}`));
  if (r.evidencePack) log(dim(`    evidence: kane-cli evidence serve ${r.evidencePack}`));
}

/** Compact, agent-readable failure report (what the coding agent gets back). */
function failureReport(failures) {
  return failures.map(({ check, result: r }) => {
    const lines = [`### ${check.title}`, `Checked: ${check.url ?? "user flow"}`];
    if (r.status === "error") lines.push(`Kane could not complete the check: ${r.reason}`);
    if (r.status === "inconclusive") lines.push("Kane judged this a problem with the check, not with the invoice. Do not change app code for it; you may reword the rule or flow so it is unambiguous, without changing what it requires.");
    if (r.bugTitle) lines.push(`Bug: ${r.bugTitle}${r.severity ? ` (${r.severity})` : ""}`);
    if (r.rootCause) lines.push(`Root cause: ${r.rootCause}`);
    else if (r.summary) lines.push(`Summary: ${r.summary}`);
    if (r.failedSteps?.length) lines.push(`Failed assertion: ${r.failedSteps.join("; ")}`);
    if (r.math?.findings.length) lines.push(`Arithmetic (re-added in code from the numbers Kane read on the page):\n${r.math.findings.map((f) => `  - ${f}`).join("\n")}`);
    if (r.evidence?.length) lines.push(`Evidence seen on the page:\n${r.evidence.map((e) => `  - ${e}`).join("\n")}`);
    if (r.suggestion) lines.push(`Kane's suggestion: ${r.suggestion}`);
    if (r.testUrl) lines.push(`Recording: ${r.testUrl}`);
    if (r.evidencePack) lines.push(`Evidence pack (screenshot, console and network log for every step): ${r.evidencePack}\n  Open it with: kane-cli evidence serve ${r.evidencePack}`);
    return lines.join("\n");
  }).join("\n\n");
}

function writeReport(summary) {
  writeJson(path.join(STATE_DIR, "report.json"), summary);
  const md = [
    `# InvoiceGuard report — ${summary.passed ? "PASSED" : "FAILED"}`,
    `${summary.at} · ${summary.results.length} checks · ${summary.credits.toFixed(1)} Kane credits`,
    "",
    ...summary.results.map(({ check, result }) =>
      `- ${{ passed: "✅", failed: "❌" }[result.status] ?? "⚠️"} ${check.title}${result.cached ? " (cached)" : ""}${result.testUrl ? ` — [recording](${result.testUrl})` : ""}`),
    "",
    summary.passed ? "" : failureReport(summary.results.filter((x) => x.result.status !== "passed")),
  ].join("\n");
  fs.writeFileSync(path.join(STATE_DIR, "report.md"), md);
}

// ------------------------------------------------------------------ commands

async function gate(opts = {}) {
  const cfg = loadConfig();
  const packs = Object.fromEntries([...new Set(cfg.invoices.map((i) => i.pack))].map((n) => [n, loadPack(cfg, n)]));
  await ensureServer(cfg);

  const base = cfg.baseUrl.replace(/\/$/, "");
  let checks = [
    ...cfg.invoices.map((inv) => {
      const pack = packs[inv.pack];
      const reader = readerPath(ROOT, pack.name);
      return {
        id: `invoice:${inv.path}`, title: `Invoice ${inv.path.split("/").pop()} follows all ${pack.rules.length} ${pack.name} rules`,
        url: base + inv.path, kind: "invoice", pack, readerFile: fs.existsSync(reader) ? reader : null,
      };
    }),
    ...loadFlows(cfg).map((f) => ({ ...f, kind: "flow" })),
  ];
  if (opts.only) checks = checks.filter((ch) => ch.id.includes(opts.only));

  // Verdict cache, keyed by content hash: every code version that passed or failed is
  // remembered, so going back to a known version (e.g. reverting a bug) costs nothing.
  //   { [checkId]: { pass: [key, ...], fail: { [key]: result } } }
  const cacheFile = path.join(STATE_DIR, "cache.json");
  const cache = {};
  for (const [k, v] of Object.entries(readJson(cacheFile, {}))) { // migrate the old flat format
    if (k.startsWith("fail:")) { const id = k.slice(5); (cache[id] ??= { pass: [], fail: {} }).fail[v.key] = v.result; }
    else if (typeof v === "string") (cache[k] ??= { pass: [], fail: {} }).pass.push(v);
    else {
      const e = (cache[k] ??= { pass: [], fail: {} });
      e.pass.push(...(v.pass ?? []));
      Object.assign(e.fail, v.fail ?? {});
    }
  }
  writeJson(cacheFile, cache);
  const known = (id, key) => {
    if (opts.noCache) return null;
    if (cache[id]?.pass.includes(key)) return { status: "passed", cached: true };
    if (cache[id]?.fail[key]) return { ...cache[id].fail[key], cached: true };
    return null;
  };
  const remember = (id, key, r) => {
    const e = (cache[id] ??= { pass: [], fail: {} });
    if (r.status === "passed") { e.pass = [key, ...e.pass.filter((k) => k !== key)].slice(0, 25); delete e.fail[key]; }
    else if (r.status === "failed") {
      e.fail[key] = r; e.pass = e.pass.filter((k) => k !== key);
      const keys = Object.keys(e.fail); if (keys.length > 25) delete e.fail[keys[0]];
    }
    writeJson(cacheFile, cache);
  };
  const srcHash = sourceHash(cfg);
  for (const ch of checks) {
    ch.key = ch.kind === "invoice"
      ? sha(ch.id, invoiceObjective(ch.pack), EXTRACTION_OBJECTIVE, "math-v1",
          ch.readerFile ? fs.readFileSync(ch.readerFile, "utf8") : "", await renderedInvoice(ch.url))
      : sha(ch.id, ch.raw, srcHash);
  }

  const fresh = checks.filter((ch) => !known(ch.id, ch.key)).length;
  log(bold(`\nInvoiceGuard · verifying with Kane CLI`) + dim(`  ${checks.length} checks, ${fresh} need a fresh run`));

  const results = await pool(checks, cfg.concurrency, async (ch, slot) => {
    let r = known(ch.id, ch.key);
    if (!r) {
      r = ch.kind === "invoice"
        ? await verify({ objective: invoiceObjective(ch.pack), url: ch.url, timeoutSeconds: cfg.timeoutSeconds, logName: ch.id, mathCheck: true, readerFile: ch.readerFile, mathRules: ch.pack.mathRules.length }, slot)
        : await verify({ objective: ch.objective, url: `${base}/`, timeoutSeconds: cfg.timeoutSeconds, logName: ch.id }, slot);
      remember(ch.id, ch.key, r);
    }
    printResult(ch, r);
    return { check: { id: ch.id, title: ch.title, url: ch.url }, result: r };
  });

  const summary = {
    passed: results.every((x) => x.result.status === "passed"),
    at: new Date().toISOString(),
    sourceHash: srcHash,
    credits: results.reduce((s, x) => s + (x.result.credits ?? 0) + (x.result.math?.readCredits ?? 0), 0),
    results,
  };
  writeReport(summary);
  if (summary.passed && !opts.only && !opts.noRecord) { // never record a planted-bug run as "green"
    const hookFile = path.join(STATE_DIR, "hook.json");
    writeJson(hookFile, { ...readJson(hookFile, {}), lastGreen: srcHash, attempts: 0 });
  }
  log(summary.passed
    ? green(bold(`\nAll ${results.length} checks passed.`)) + dim(" Report: .kane/report.md")
    : red(bold(`\n${results.filter((x) => x.result.status !== "passed").length} of ${results.length} checks did not pass`))
      + dim(` (${results.filter((x) => x.result.status === "failed").length} failed, ${results.filter((x) => !["passed", "failed"].includes(x.result.status)).length} inconclusive/error). Report: .kane/report.md`));
  return summary;
}

const escapeHtml = (t) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** Plain text / markdown → a readable HTML page Kane can open. */
function textToHtml(title, text) {
  const body = text.split(/\n{2,}/).map((para) => {
    const h = para.match(/^#{1,6}\s+(.+)/);
    return h ? `<h2>${escapeHtml(h[1])}</h2>` : `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.6 Georgia,serif;max-width:760px;margin:32px auto;padding:0 16px;color:#222;background:#fff}</style>
</head><body>${body}</body></html>`;
}

const DOCUMENT_TYPES = /\.(html?|md|markdown|txt|pdf)$/i;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Resolve a document path safely. Documents are shown to a cloud-recorded browser, so only
 * invoice/contract formats are accepted, up to 10 MB. With insideRoot (used when an AI agent
 * picks the file, e.g. via MCP) the real path must also be inside the working directory, so a
 * prompt-injected agent can't send ~/.ssh or other private files through Kane.
 */
function resolveDocumentFile(file, { insideRoot = false } = {}) {
  const resolved = path.resolve(ROOT, file);
  if (!fs.existsSync(resolved)) throw new Error(`No such file: ${file}`);
  const real = fs.realpathSync(resolved);
  if (insideRoot) {
    const root = fs.realpathSync(ROOT);
    if (real !== root && !real.startsWith(root + path.sep))
      throw new Error(`Refusing ${file}: documents must be inside ${root}`);
  }
  if (!DOCUMENT_TYPES.test(real)) throw new Error(`Refusing ${file}: only .html, .md, .txt and .pdf documents are checked`);
  if (fs.statSync(real).size > MAX_DOCUMENT_BYTES) throw new Error(`Refusing ${file}: larger than 10 MB`);
  return real;
}

/**
 * Make documents reachable by Kane's browser. Each doc is one of
 * { url } | { html } | { text } | { file } (html, txt, md or pdf).
 * Returns { urls: string[], texts: string[], close() }.
 */
async function serveDocuments(docs, opts = {}) {
  const pages = [];
  const urls = [], texts = [], visual = [];
  for (const [i, doc] of docs.entries()) {
    const name = doc.name ?? `document-${i + 1}`;
    if (doc.url) {
      urls.push(doc.url);
      texts.push(await fetch(doc.url).then((r) => r.text()).catch(() => ""));
      visual.push(/\.pdf($|\?)/i.test(doc.url));
      continue;
    }
    let body, type = "text/html; charset=utf-8", ext = "html";
    if (doc.html) body = doc.html;
    else if (doc.text) body = textToHtml(name, doc.text);
    else if (doc.file) {
      const file = resolveDocumentFile(doc.file, opts);
      if (/\.pdf$/i.test(file)) {
        // Prefer the PDF's own text (layout kept) as a normal page: Kane reads page text far more
        // reliably than it reads a PDF viewer visually. Fall back to the raw PDF + visual mode.
        const txt = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
        if (txt.status === 0 && txt.stdout.trim()) {
          body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(path.basename(file))}</title>`
            + `<style>body{background:#fff;color:#111;margin:24px}pre{font:14px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap}</style>`
            + `</head><body><pre>${escapeHtml(txt.stdout)}</pre></body></html>`;
          texts.push(txt.stdout); visual.push(false);
          pages.push({ route: `/${i}/${name.replace(/[^\w.-]+/g, "-")}.html`, body, type });
          urls.push(null);
          continue;
        }
        body = fs.readFileSync(file); type = "application/pdf"; ext = "pdf";
      }
      else if (/\.html?$/i.test(file)) body = fs.readFileSync(file, "utf8");
      else body = textToHtml(path.basename(file), fs.readFileSync(file, "utf8"));
    } else throw new Error("Each document needs one of: url, html, text, file");
    pages.push({ route: `/${i}/${name.replace(/[^\w.-]+/g, "-")}.${ext}`, body, type });
    texts.push(typeof body === "string" ? body : "");
    visual.push(type === "application/pdf");
    urls.push(null);
  }
  let server = null;
  if (pages.length) {
    server = createServer((req, res) => {
      const page = pages.find((p) => req.url === p.route);
      if (!page) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": page.type });
      res.end(page.body);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    let k = 0;
    for (let i = 0; i < urls.length; i++) if (urls[i] === null) urls[i] = base + pages[k++].route;
  }
  return { urls, texts, visual, close: () => server?.close() };
}

/** HTML body of a document, with styles, scripts and comments removed. */
async function documentBody(doc, opts = {}) {
  if (doc.text) return textToHtml("", doc.text).match(/<body>([\s\S]*)<\/body>/)[1];
  let html = doc.html;
  if (doc.url) html = await fetch(doc.url).then((r) => r.text());
  if (doc.file) {
    const file = resolveDocumentFile(doc.file, opts);
    if (/\.pdf$/i.test(file)) throw new Error("PDFs are not supported for invoice-vs-contract yet; pass HTML, text or a URL");
    const raw = fs.readFileSync(file, "utf8");
    if (!/\.html?$/i.test(file)) return textToHtml("", raw).match(/<body>([\s\S]*)<\/body>/)[1];
    html = raw;
  }
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
}

/** One page holding both documents, so Kane reads them together in a single flow. */
async function serveComparison(contract, invoice, opts = {}) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Contract and invoice</title>
<style>body{font:15px/1.6 Georgia,serif;max-width:820px;margin:32px auto;padding:0 16px;color:#222;background:#fff}
section{border:2px solid #333;padding:8px 24px 24px;margin-bottom:32px} .doc-label{font:700 13px sans-serif;letter-spacing:.12em}
table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}</style></head><body>
<section id="contract"><p class="doc-label">DOCUMENT 1 OF 2: THE CONTRACT</p>${await documentBody(contract, opts)}</section>
<section id="invoice"><p class="doc-label">DOCUMENT 2 OF 2: THE INVOICE</p>${await documentBody(invoice, opts)}</section>
</body></html>`;
  return serveDocuments([{ html, name: "contract-and-invoice" }]);
}

async function audit(target, opts = {}) {
  if (!target) throw new Error("usage: invoiceguard audit <url | file.html | file.pdf> [--pack india-gst|us-sales-tax | --rules file.md]");
  const cfg = loadConfig();
  const docs = await serveDocuments([/^https?:\/\//.test(target) ? { url: target } : { file: target }]);
  let pack;
  if (opts.rules) pack = { name: path.basename(opts.rules, ".md"), kind: packKind(opts.rules), ...loadRulebook(opts.rules) };
  else {
    const name = opts.pack ?? detectPack(docs.texts[0]);
    if (!name) { docs.close(); throw new Error("Could not tell what kind of document this is. Pass --pack india-gst, us-sales-tax or services-contract."); }
    pack = loadPack(cfg, name);
  }
  const url = docs.urls[0];
  const visual = docs.visual[0];
  const pdfText = /\.pdf$/i.test(target) && !visual;
  log(bold(`\nInvoiceGuard audit`) + dim(`  ${target} · ${pack.title} (${pack.rules.length} rules)${visual ? " · visual mode (PDF)" : pdfText ? " · PDF text" : ""}`));
  const check = { id: "audit", title: `Audit of ${path.basename(target)}`, url };
  const r = await verify({ objective: invoiceObjective(pack), url, timeoutSeconds: cfg.timeoutSeconds, visual, allFailures: true, logName: "audit", mathCheck: pack.kind === "invoice", mathRules: pack.mathRules?.length ?? 0 });
  docs.close();
  printResult(check, r);
  writeJson(path.join(STATE_DIR, "audit.json"), { target, at: new Date().toISOString(), result: r });
  return r;
}

/**
 * Plant each realistic bug from demo/*.patch, one at a time, and record whether the
 * unit tests and Kane catch it. Patches are always reverted, even on Ctrl-C.
 */
async function prove(opts = {}) {
  const demoDir = path.join(ROOT, "demo");
  const meta = readJson(path.join(demoDir, "bugs.json"), {});
  let patches = fs.readdirSync(demoDir).filter((f) => f.endsWith(".patch")).sort();
  if (opts.only) patches = patches.filter((f) => f.includes(opts.only));
  if (!patches.length) throw new Error("No demo/*.patch files to plant");
  const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  for (const p of patches) {
    const check = git("apply", "--check", path.join("demo", p));
    if (check.status !== 0) throw new Error(`${p} does not apply cleanly (is it already applied, or are files modified?)\n${check.stderr}`);
  }

  let applied = null;
  const revert = () => { if (applied) { git("apply", "-R", path.join("demo", applied)); applied = null; } };
  const onSignal = () => { revert(); process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const rows = [];
  try {
    for (const p of patches) {
      const name = p.replace(/\.patch$/, "");
      const info = meta[name] ?? { title: name, where: "", impact: "" };
      log(bold(`\n━━ Planting: ${info.title}`) + dim(`  (${p})`));
      git("apply", path.join("demo", p));
      applied = p;
      await new Promise((r) => setTimeout(r, 1500)); // let the dev server pick up the change

      const unit = spawnSync("npx", ["vitest", "run"], { cwd: ROOT, encoding: "utf8" });
      const unitOut = (unit.stdout ?? "") + (unit.stderr ?? "");
      const unitFailed = Number(unitOut.match(/Tests\s+(\d+) failed/)?.[1] ?? 0);
      log(unit.status === 0 ? dim("unit tests: all passed (bug not seen)") : red(`unit tests: ${unitFailed || "some"} failed (bug caught)`));

      const summary = await gate({ noCache: opts.noCache, noRecord: true });
      const caught = summary.results.filter((x) => x.result.status === "failed");
      const unsure = summary.results.filter((x) => !["passed", "failed"].includes(x.result.status));
      rows.push({
        bug: name, ...info,
        unitCaught: unit.status !== 0, unitFailed,
        kaneCaught: caught.length > 0,
        kaneChecks: caught.map((x) => ({ check: x.check.title, bug: x.result.bugTitle ?? x.result.oneLiner ?? null, recording: x.result.testUrl ?? null })),
        kaneInconclusive: unsure.length,
      });
      revert();
    }
  } finally {
    revert();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  log(bold("\n━━ Back on the clean code"));
  const clean = await gate({});

  const unitN = rows.filter((r) => r.unitCaught).length, kaneN = rows.filter((r) => r.kaneCaught).length;
  const md = [
    `# InvoiceGuard proof: ${kaneN}/${rows.length} planted bugs caught by Kane CLI, ${unitN}/${rows.length} by unit tests`,
    "",
    `${new Date().toISOString()} · clean code afterwards: ${clean.passed ? "all checks green" : "NOT green"}`,
    "",
    "| Planted bug | Where | Unit tests | Kane CLI | What Kane reported |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| **${r.title}**<br>${r.impact} | ${r.where} | ${r.unitCaught ? `✅ caught (${r.unitFailed} failed)` : "❌ missed"} | ${r.kaneCaught ? `✅ caught (${r.kaneChecks.length} check${r.kaneChecks.length > 1 ? "s" : ""})` : r.kaneInconclusive ? "⚠️ inconclusive" : "❌ missed"} | ${r.kaneChecks.map((k) => `${k.bug ?? k.check}${k.recording ? ` ([recording](${k.recording}))` : ""}`).join("<br>") || "–"} |`),
    "",
    "Reproduce: `npm run prove` (patches live in `demo/`, descriptions in `demo/bugs.json`).",
  ].join("\n");
  writeJson(path.join(STATE_DIR, "prove.json"), { at: new Date().toISOString(), rows, cleanPassed: clean.passed });
  fs.writeFileSync(path.join(STATE_DIR, "prove.md"), md);

  log(bold(`\n━━ Scorecard`));
  for (const r of rows)
    log(`${r.kaneCaught ? green("Kane ✓") : red("Kane ✗")}  ${r.unitCaught ? green("unit ✓") : red("unit ✗")}  ${r.title}`);
  log(bold(`\nKane CLI caught ${kaneN}/${rows.length}. Unit tests caught ${unitN}/${rows.length}.`) + dim(" Report: .kane/prove.md"));
  return { rows, kaneN, unitN, cleanPassed: clean.passed };
}

/** Run `kane-cli testmd run` for a test file in `dir`, in an isolated Chrome. Resolves true on pass. */
function runKaneTestmd(dir, file, timeoutSeconds) {
  return new Promise(async (resolve) => {
    const chrome = await launchChrome();
    const args = ["testmd", "run", file, "--agent", "--timeout", String(timeoutSeconds)];
    args.push(...(chrome ? ["--cdp-endpoint", chrome.endpoint] : ["--headless"]));
    if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY)
      args.push("--username", process.env.LT_USERNAME, "--access-key", process.env.LT_ACCESS_KEY);
    const child = spawn("kane-cli", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KANE_CLI_USER_AGENT: "invoiceguard" } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", async (code) => {
      await chrome?.close();
      resolve(code === 0 && /"overall_status":"passed"/.test(out));
    });
  });
}

/** Export a passed test file to Playwright JavaScript; resolves with the exported file's path. */
function exportTestmd(dir, file) {
  return new Promise((resolve, reject) => {
    const child = spawn("kane-cli", ["testmd", "export", file, "--language", "javascript", "--force"], { cwd: dir, stdio: "ignore" });
    child.on("close", (code) => {
      const out = path.join(dir, `output-${file.replace(/_test\.md$/, "")}`, "playwright-javascript-code", "test.js");
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(new Error(`kane-cli testmd export exited ${code}`));
    });
  });
}

/** Have Kane write a reading test for each invoice layout, export it to Playwright, keep it. */
async function graduate(opts = {}) {
  const cfg = loadConfig();
  await ensureServer(cfg);
  const base = cfg.baseUrl.replace(/\/$/, "");
  let packs = [...new Set(cfg.invoices.map((i) => i.pack))];
  if (opts.pack) packs = packs.filter((p) => p === opts.pack);
  if (!packs.length) throw new Error("No invoice rulebook to graduate (check --pack and invoiceguard.config.json)");
  for (const pack of packs) {
    const sample = opts.sample ?? cfg.invoices.find((i) => i.pack === pack).path;
    log(bold(`\nGraduating the ${pack} reader`) + dim(`  Kane writes it on ${sample}, then exports it to Playwright`));
    const samples = cfg.invoices.filter((i) => i.pack === pack);
    const result = await graduateReader({
      root: ROOT, pack, url: base + sample, objective: `${EXTRACTION_OBJECTIVE}\n${GRADUATION_HINTS}`,
      runKaneTestmd: (dir, file) => runKaneTestmd(dir, file, cfg.timeoutSeconds),
      exportTestmd,
      // Every sample invoice is known to be correct, so any finding means the reader misread.
      validate: async (file) => {
        const problems = [];
        for (const inv of samples) {
          try {
            const r = checkInvoiceMath(await runReader(file, base + inv.path));
            if (r.findings.length || r.skipped) problems.push(`${inv.path}: ${r.findings[0] ?? r.skipped}`);
          } catch (err) { problems.push(`${inv.path}: ${err.message}`); }
        }
        return problems;
      },
    });
    if (result.installed) log(green("✓ ") + `${path.relative(ROOT, result.dest)}` + dim(` (reads all ${samples.length} ${pack} samples correctly)`));
    else {
      log(red(`✗ Kane's reader for ${pack} misreads known-good invoices, so it was not installed:`));
      for (const p of result.problems) log(red(`    • ${p}`));
      process.exitCode = 1;
    }
  }
  log(dim("Next: `invoiceguard math` re-adds every sample invoice through these readers, for 0 Kane credits."));
}

/** Read every sample invoice with its graduated reader and check the sums. No Kane credits. */
async function math() {
  const cfg = loadConfig();
  await ensureServer(cfg);
  const base = cfg.baseUrl.replace(/\/$/, "");
  log(bold("\nInvoiceGuard math") + dim("  graduated readers + math check, no Kane credits"));
  let bad = 0;
  for (const inv of cfg.invoices) {
    const reader = readerPath(ROOT, inv.pack);
    const name = inv.path.split("/").pop();
    if (!fs.existsSync(reader)) { bad++; log(`${yellow("?")} ${name}: no graduated ${inv.pack} reader yet (run \`invoiceguard graduate --pack ${inv.pack}\`)`); continue; }
    const t = Date.now();
    try {
      const r = checkInvoiceMath(await runReader(reader, base + inv.path));
      const ms = dim(` ${Date.now() - t}ms`);
      if (r.findings.length) { bad++; log(`${red("✗")} ${name}${ms}`); for (const f of r.findings) log(red(`    • ${f}`)); }
      else log(`${green("✓")} ${name}${ms}${dim(` · ${r.checked.length} sums`)}${r.skipped ? dim(` (${r.skipped})`) : ""}`);
    } catch (err) { bad++; log(`${yellow("!")} ${name}: ${err.message}`); }
  }
  log(bad ? red(bold(`\n${bad} of ${cfg.invoices.length} invoices have a problem.`)) : green(bold(`\nAll ${cfg.invoices.length} invoices add up.`)));
  return bad === 0;
}

/**
 * Claude Code Stop hook. Runs when the agent is about to finish its turn.
 * If the app changed since the last green run, Kane re-verifies it; failures are
 * handed back to the agent as a "block" decision so it keeps working.
 */
async function hook() {
  const cfg = loadConfig();
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
  const stateFile = path.join(STATE_DIR, "hook.json");
  const state = readJson(stateFile, { lastGreen: null, attempts: 0 });
  const src = sourceHash(cfg);

  if (state.lastGreen === src) { // nothing changed since Kane last signed off
    if (state.attempts) {
      writeJson(stateFile, { ...state, attempts: 0 });
      console.log(JSON.stringify({ systemMessage: "✓ Code matches the version Kane CLI last verified. All checks green." }));
    }
    return;
  }
  // Same code as a run that had only inconclusive/error results: it was already reported, and
  // re-running Kane can't change a misread rule, so don't spend credits on it again.
  if (state.lastInconclusive === src) return;
  if (!input.stop_hook_active) state.attempts = 0; // a fresh user request

  let summary;
  try { summary = await gate(); }
  catch (err) {
    console.log(JSON.stringify({ systemMessage: `InvoiceGuard could not run Kane: ${err.message}` }));
    return;
  }

  if (summary.passed) {
    console.log(JSON.stringify({ systemMessage: `✓ Kane CLI verified ${summary.results.length} invoice checks in a real browser.` }));
    return;
  }

  // Only real product bugs block. "Inconclusive" means Kane blamed its own check (a misread or an
  // ambiguous rule) and "error" means Kane couldn't run: neither is fixed by changing app code.
  const failures = summary.results.filter((x) => x.result.status === "failed");
  if (!failures.length) {
    const shaky = summary.results.filter((x) => x.result.status !== "passed");
    writeJson(stateFile, { ...state, lastInconclusive: src, attempts: 0 });
    console.log(JSON.stringify({
      systemMessage: [
        `⚠ Kane found no product bugs, but ${shaky.length} check(s) were not conclusive, so this version is not marked green:`,
        ...shaky.map(({ check, result }) => `  • ${check.title}: ${result.bugTitle ?? result.reason ?? result.status}`),
        "A human should look at .kane/report.md and, if a rule is ambiguous, reword it without changing what it requires.",
      ].join("\n"),
    }));
    return;
  }

  state.attempts += 1;
  writeJson(stateFile, state);
  if (state.attempts > cfg.maxHookAttempts) {
    writeJson(stateFile, { ...state, attempts: 0 });
    console.log(JSON.stringify({
      systemMessage: `✗ Kane still reports ${failures.length} failing check(s) after ${cfg.maxHookAttempts} fix attempts. Stopping so a human can look: .kane/report.md`,
    }));
    return;
  }
  console.log(JSON.stringify({
    decision: "block",
    reason: [
      `InvoiceGuard: Kane CLI opened the app in a real browser and ${failures.length} check(s) failed. You are not done yet.`,
      "Fix the application code so these invoices are correct (do not weaken the rulebooks in kane/rules/ or the flows), then finish again — Kane will re-verify automatically.",
      `Attempt ${state.attempts} of ${cfg.maxHookAttempts}.`,
      "",
      failureReport(failures),
    ].join("\n"),
  }));
}

function init() {
  const settingsFile = path.join(ROOT, ".claude", "settings.json");
  const settings = readJson(settingsFile, {});
  const command = "node cli/invoiceguard.mjs hook";
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  const already = JSON.stringify(settings.hooks.Stop).includes("invoiceguard");
  if (!already) settings.hooks.Stop.push({ hooks: [{ type: "command", command, timeout: 1200 }] });
  writeJson(settingsFile, settings);
  for (const f of ["kane/rules/india-gst.md", "kane/rules/us-sales-tax.md"]) {
    const dest = path.join(ROOT, f);
    if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(PKG_DIR, f), dest); }
  }
  log(green("✓ ") + (already ? "Stop hook already installed" : "Installed Claude Code Stop hook") + dim(" (.claude/settings.json)"));
  log(green("✓ ") + "Rulebooks in kane/rules/ (India GST, US sales tax). Edit them in plain English");
  log(dim("Next: list your invoice pages in invoiceguard.config.json, then `invoiceguard gate`."));
}

// ------------------------------------------------------------------ exports (used by mcp/server.mjs)

export {
  loadConfig, loadRulebook, loadPack, detectPack, invoiceObjective, ruleAssertions, verify, gate,
  failureReport, serveDocuments, serveComparison, PKG_DIR, ROOT,
};

// ------------------------------------------------------------------ main

const isMain = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isMain) await main();

async function main() {
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? (rest[i + 1] ?? true) : undefined; };

try {
  if (cmd === "gate") {
    const s = await gate({ only: flag("--only"), noCache: rest.includes("--no-cache") });
    if (rest.includes("--json")) console.log(JSON.stringify(s, null, 2));
    process.exit(s.passed ? 0 : 1);
  } else if (cmd === "audit") {
    const r = await audit(rest.find((a) => !a.startsWith("--") && a !== flag("--rules") && a !== flag("--pack")), { rules: flag("--rules"), pack: flag("--pack") });
    if (rest.includes("--json")) console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === "passed" ? 0 : 1);
  } else if (cmd === "prove") {
    const r = await prove({ only: flag("--only"), noCache: rest.includes("--no-cache") });
    process.exit(r.kaneN === r.rows.length && r.cleanPassed ? 0 : 1);
  } else if (cmd === "graduate") {
    await graduate({ pack: flag("--pack"), sample: flag("--sample") });
  } else if (cmd === "math") {
    process.exit((await math()) ? 0 : 1);
  } else if (cmd === "hook") {
    await hook();
    process.exit(0);
  } else if (cmd === "init") {
    init();
  } else {
    log(`invoiceguard — invoices (India GST, US sales tax) verified by Kane CLI

  gate [--only <id>] [--no-cache] [--json]   verify this app's invoices and flows
  audit <url|file> [--pack name] [--json]    audit any invoice or contract (html, txt, md, pdf or URL; rulebook auto-detected)
  prove [--only <name>] [--no-cache]         plant each demo/*.patch bug; scorecard of unit tests vs Kane
  graduate [--pack name] [--sample path]     Kane writes + exports a Playwright reader per invoice layout
  math                                       re-add every sample invoice via the readers (0 Kane credits)
  hook                                       Claude Code Stop hook (reads stdin)
  init                                       install the hook and rules here`);
    process.exit(cmd ? 2 : 0);
  }
} catch (err) {
  log(red(`invoiceguard: ${err.message}`));
  process.exit(2);
}
}
