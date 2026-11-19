#!/usr/bin/env node
// invoiceguard — verify invoices (India GST, US sales tax) in a real browser with Kane CLI.
//
//   invoiceguard gate            check every sample invoice + user flow of this app
//   invoiceguard audit <url|file> check any invoice page (yours or a vendor's);
//                                 picks the India GST or US sales tax rulebook automatically
//   invoiceguard hook            Claude Code Stop hook: block "done" until Kane passes
//   invoiceguard init            install the hook + rules into the current project
//
// Zero dependencies. Needs `kane-cli` on PATH and a logged-in profile
// (`kane-cli login`), or LT_USERNAME / LT_ACCESS_KEY in the environment.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  return { title: (text.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(file)).trim(), rules, file };
}

function loadPack(cfg, name) {
  const file = cfg.rulePacks[name];
  if (!file) throw new Error(`Unknown rule pack "${name}". Known: ${Object.keys(cfg.rulePacks).join(", ")}`);
  return { name, ...loadRulebook(file) };
}

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

function invoiceObjective(pack) {
  return [
    `This page is a document that is checked against the rulebook "${pack.title}". Read the whole document carefully first.`,
    "Then check each of the following statements one at a time, looking at the document for evidence. Any statement that is false is a product bug.",
    "",
    ...ruleAssertions(pack.rules),
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
    let buf = "", runEnd = null, lastError = null, stderr = "";
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
        credits: runEnd.credits_consumed ?? runEnd.credits,
      });
    });
  });
}


/** A failure Kane attributes to the product, as opposed to browser/infra trouble. */
const isProductBug = (r) => r.status === "failed" && (!r.family || r.family === "application_issue");

async function verify(opts) {
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
    : dim(r.status === "passed" ? " (unchanged since last pass, skipped)" : " (code unchanged since this failure, not re-run)");
  if (r.status === "passed") return log(`${green("✓")} ${check.title}${tag}`);
  const mark = r.status === "failed" ? red("✗") : yellow("?");
  if (r.status === "inconclusive") log(`${mark} ${bold(check.title)}${tag} ${yellow("— Kane says the check itself is the problem, not the invoice")}`);
  else
    log(`${mark} ${bold(check.title)}${tag}`);
  if (r.bugTitle) log(`    ${red(r.bugTitle)}`);
  const why = r.rootCause || r.oneLiner || r.reason;
  if (why) log(`    ${why}`);
  for (const f of r.failedSteps ?? []) log(red(`    • ${f.replace(/^assert:\s*/, "")}`));
  if (r.suggestion) log(dim(`    fix: ${r.suggestion}`));
  if (r.testUrl) log(dim(`    ${r.testUrl}`));
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
    if (r.evidence?.length) lines.push(`Evidence seen on the page:\n${r.evidence.map((e) => `  - ${e}`).join("\n")}`);
    if (r.suggestion) lines.push(`Kane's suggestion: ${r.suggestion}`);
    if (r.testUrl) lines.push(`Recording: ${r.testUrl}`);
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
      return { id: `invoice:${inv.path}`, title: `Invoice ${inv.path.split("/").pop()} follows all ${pack.rules.length} ${pack.name} rules`, url: base + inv.path, kind: "invoice", pack };
    }),
    ...loadFlows(cfg).map((f) => ({ ...f, kind: "flow" })),
  ];
  if (opts.only) checks = checks.filter((ch) => ch.id.includes(opts.only));

  const cacheFile = path.join(STATE_DIR, "cache.json");
  const cache = opts.noCache ? {} : readJson(cacheFile, {});
  const srcHash = sourceHash(cfg);
  for (const ch of checks) {
    ch.key = ch.kind === "invoice"
      ? sha(ch.id, invoiceObjective(ch.pack), await renderedInvoice(ch.url))
      : sha(ch.id, ch.raw, srcHash);
  }

  const fresh = checks.filter((ch) => cache[ch.id] !== ch.key && cache[`fail:${ch.id}`]?.key !== ch.key).length;
  log(bold(`\nInvoiceGuard · verifying with Kane CLI`) + dim(`  ${checks.length} checks, ${fresh} need a fresh run`));

  const results = await pool(checks, cfg.concurrency, async (ch, slot) => {
    let r;
    const prevFail = cache[`fail:${ch.id}`];
    if (cache[ch.id] === ch.key) r = { status: "passed", cached: true };
    // Same code, same verdict: hand back the earlier product-bug report instead of paying for a re-run.
    else if (prevFail?.key === ch.key) r = { ...prevFail.result, cached: true };
    else {
      r = ch.kind === "invoice"
        ? await verify({ objective: invoiceObjective(ch.pack), url: ch.url, timeoutSeconds: cfg.timeoutSeconds, logName: ch.id }, slot)
        : await verify({ objective: ch.objective, url: `${base}/`, timeoutSeconds: cfg.timeoutSeconds, logName: ch.id }, slot);
      if (r.status === "passed") cache[ch.id] = ch.key; else delete cache[ch.id];
      if (r.status === "failed") cache[`fail:${ch.id}`] = { key: ch.key, result: r };
      else delete cache[`fail:${ch.id}`];
      writeJson(cacheFile, cache);
    }
    printResult(ch, r);
    return { check: { id: ch.id, title: ch.title, url: ch.url }, result: r };
  });

  const summary = {
    passed: results.every((x) => x.result.status === "passed"),
    at: new Date().toISOString(),
    sourceHash: srcHash,
    credits: results.reduce((s, x) => s + (x.result.credits ?? 0), 0),
    results,
  };
  writeReport(summary);
  if (summary.passed && !opts.only) {
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

/**
 * Make documents reachable by Kane's browser. Each doc is one of
 * { url } | { html } | { text } | { file } (html, txt, md or pdf).
 * Returns { urls: string[], texts: string[], close() }.
 */
async function serveDocuments(docs) {
  const pages = [];
  const urls = [], texts = [];
  for (const [i, doc] of docs.entries()) {
    const name = doc.name ?? `document-${i + 1}`;
    if (doc.url) {
      urls.push(doc.url);
      texts.push(await fetch(doc.url).then((r) => r.text()).catch(() => ""));
      continue;
    }
    let body, type = "text/html; charset=utf-8", ext = "html";
    if (doc.html) body = doc.html;
    else if (doc.text) body = textToHtml(name, doc.text);
    else if (doc.file) {
      const file = path.resolve(ROOT, doc.file);
      if (!fs.existsSync(file)) throw new Error(`No such file: ${doc.file}`);
      if (/\.pdf$/i.test(file)) { body = fs.readFileSync(file); type = "application/pdf"; ext = "pdf"; }
      else if (/\.html?$/i.test(file)) body = fs.readFileSync(file, "utf8");
      else body = textToHtml(path.basename(file), fs.readFileSync(file, "utf8"));
    } else throw new Error("Each document needs one of: url, html, text, file");
    pages.push({ route: `/${i}/${name.replace(/[^\w.-]+/g, "-")}.${ext}`, body, type });
    texts.push(typeof body === "string" ? body : "");
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
  return { urls, texts, close: () => server?.close() };
}

/** HTML body of a document, with styles, scripts and comments removed. */
async function documentBody(doc) {
  if (doc.text) return textToHtml("", doc.text).match(/<body>([\s\S]*)<\/body>/)[1];
  let html = doc.html;
  if (doc.url) html = await fetch(doc.url).then((r) => r.text());
  if (doc.file) {
    const file = path.resolve(ROOT, doc.file);
    if (/\.pdf$/i.test(file)) throw new Error("PDFs are not supported for invoice-vs-contract yet; pass HTML, text or a URL");
    const raw = fs.readFileSync(file, "utf8");
    if (!/\.html?$/i.test(file)) return textToHtml("", raw).match(/<body>([\s\S]*)<\/body>/)[1];
    html = raw;
  }
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
}

/** One page holding both documents, so Kane reads them together in a single flow. */
async function serveComparison(contract, invoice) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Contract and invoice</title>
<style>body{font:15px/1.6 Georgia,serif;max-width:820px;margin:32px auto;padding:0 16px;color:#222;background:#fff}
section{border:2px solid #333;padding:8px 24px 24px;margin-bottom:32px} .doc-label{font:700 13px sans-serif;letter-spacing:.12em}
table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}</style></head><body>
<section id="contract"><p class="doc-label">DOCUMENT 1 OF 2: THE CONTRACT</p>${await documentBody(contract)}</section>
<section id="invoice"><p class="doc-label">DOCUMENT 2 OF 2: THE INVOICE</p>${await documentBody(invoice)}</section>
</body></html>`;
  return serveDocuments([{ html, name: "contract-and-invoice" }]);
}

async function audit(target, opts = {}) {
  if (!target) throw new Error("usage: invoiceguard audit <url | file.html | file.pdf> [--pack india-gst|us-sales-tax | --rules file.md]");
  const cfg = loadConfig();
  const docs = await serveDocuments([/^https?:\/\//.test(target) ? { url: target } : { file: target }]);
  let pack;
  if (opts.rules) pack = { name: path.basename(opts.rules, ".md"), ...loadRulebook(opts.rules) };
  else {
    const name = opts.pack ?? detectPack(docs.texts[0]);
    if (!name) { docs.close(); throw new Error("Could not tell what kind of document this is. Pass --pack india-gst, us-sales-tax or services-contract."); }
    pack = loadPack(cfg, name);
  }
  const url = docs.urls[0];
  const visual = /\.pdf($|\?)/i.test(target);
  log(bold(`\nInvoiceGuard audit`) + dim(`  ${target} · ${pack.title} (${pack.rules.length} rules)${visual ? " · visual mode (PDF)" : ""}`));
  const check = { id: "audit", title: `Audit of ${path.basename(target)}`, url };
  const r = await verify({ objective: invoiceObjective(pack), url, timeoutSeconds: cfg.timeoutSeconds, visual, allFailures: true, logName: "audit" });
  docs.close();
  printResult(check, r);
  writeJson(path.join(STATE_DIR, "audit.json"), { target, at: new Date().toISOString(), result: r });
  return r;
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

  state.attempts += 1;
  writeJson(stateFile, state);
  const failures = summary.results.filter((x) => x.result.status !== "passed");
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
  } else if (cmd === "hook") {
    await hook();
    process.exit(0);
  } else if (cmd === "init") {
    init();
  } else {
    log(`invoiceguard — invoices (India GST, US sales tax) verified by Kane CLI

  gate [--only <id>] [--no-cache] [--json]   verify this app's invoices and flows
  audit <url|file> [--pack name] [--json]    audit any invoice or contract (html, txt, md, pdf or URL; rulebook auto-detected)
  hook                                       Claude Code Stop hook (reads stdin)
  init                                       install the hook and rules here`);
    process.exit(cmd ? 2 : 0);
  }
} catch (err) {
  log(red(`invoiceguard: ${err.message}`));
  process.exit(2);
}
}
