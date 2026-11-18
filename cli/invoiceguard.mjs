#!/usr/bin/env node
// invoiceguard — verify GST invoices in a real browser with Kane CLI.
//
//   invoiceguard gate            check every sample invoice + user flow of this app
//   invoiceguard audit <url|file> check any invoice page (yours or a vendor's)
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
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".kane");
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
    rules: "kane/rules.md",
    flows: "kane/flows",
    invoices: [],
    watch: ["app", "lib", "components", "src"],
    concurrency: 3,
    timeoutSeconds: 300,
    maxHookAttempts: 3,
  };
  if (!fs.existsSync(file)) return defaults;
  return { ...defaults, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

const sha = (...parts) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Rules file → numbered rule lines (ignores headings and prose). */
function loadRules(cfg, override) {
  const file = path.resolve(ROOT, override ?? cfg.rules);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8")
    : fs.readFileSync(path.join(PKG_DIR, "kane", "rules.md"), "utf8");
  const rules = text.split("\n").filter((l) => /^\s*\d+\.\s+/.test(l)).map((l) => l.trim());
  if (!rules.length) throw new Error(`No numbered rules found in ${file}`);
  return rules;
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
  for (const f of [cfg.rules]) if (fs.existsSync(path.join(ROOT, f))) h.update(fs.readFileSync(path.join(ROOT, f)));
  walk(path.join(ROOT, cfg.flows));
  return h.digest("hex").slice(0, 16);
}

// ------------------------------------------------------------------ app server

async function reachable(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; }
}

async function ensureServer(cfg) {
  if (await reachable(cfg.baseUrl)) return;
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

async function launchChrome(slot) {
  const bin = chromePath();
  if (!bin) return null;
  const port = 9301 + slot;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `invoiceguard-chrome-${slot}-`));
  const proc = spawn(bin, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--window-size=1366,900", "about:blank",
  ], { stdio: "ignore" });
  const endpoint = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    if (await reachable(`${endpoint}/json/version`)) {
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

function invoiceObjective(rules) {
  return [
    "This page is an Indian GST tax invoice. Read the whole invoice carefully.",
    "Check it against every rule below and verify each rule holds. A violated rule is a product bug: name the rule number.",
    "",
    ...rules,
  ].join("\n");
}

/** Run one Kane objective; resolves with a normalised result. */
function runKane({ objective, url, timeoutSeconds, visual, cdpEndpoint }) {
  const args = ["run", objective, "--agent", "--timeout", String(timeoutSeconds)];
  args.push(...(cdpEndpoint ? ["--cdp-endpoint", cdpEndpoint] : ["--headless"]));
  if (url) args.push("--url", url);
  if (visual) args.push("--assertion-mode", "visual");
  if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY)
    args.push("--username", process.env.LT_USERNAME, "--access-key", process.env.LT_ACCESS_KEY);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("kane-cli", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, KANE_CLI_USER_AGENT: "invoiceguard" },
    });
    let buf = "", runEnd = null, lastError = null, stderr = "";
    const steps = [];
    child.stdout.on("data", (d) => {
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
        failedSteps: steps.filter((s) => s.status === "failed").map((s) => s.remark),
        testUrl: runEnd.test_url,
        credits: runEnd.credits_consumed ?? runEnd.credits,
      });
    });
  });
}


/** A failure Kane attributes to the product, as opposed to browser/infra trouble. */
const isProductBug = (r) => r.status === "failed" && (!r.family || r.family === "application_issue");

async function verify(opts, slot) {
  for (let attempt = 1; ; attempt++) {
    const chrome = await launchChrome(slot);
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
  const tag = r.cached ? dim(" (unchanged since last pass, skipped)") : dim(` ${r.seconds ?? 0}s`);
  if (r.status === "passed") return log(`${green("✓")} ${check.title}${tag}`);
  const mark = r.status === "failed" ? red("✗") : yellow("?");
  if (r.status === "inconclusive") log(`${mark} ${bold(check.title)}${tag} ${yellow("— Kane says the check itself is the problem, not the invoice")}`);
  else
    log(`${mark} ${bold(check.title)}${tag}`);
  if (r.bugTitle) log(`    ${red(r.bugTitle)}`);
  const why = r.rootCause || r.oneLiner || r.reason;
  if (why) log(`    ${why}`);
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
  const rules = loadRules(cfg);
  await ensureServer(cfg);

  const base = cfg.baseUrl.replace(/\/$/, "");
  let checks = [
    ...cfg.invoices.map((p) => ({ id: `invoice:${p}`, title: `Invoice ${p.split("/").pop()} follows all ${rules.length} GST rules`, url: base + p, kind: "invoice" })),
    ...loadFlows(cfg).map((f) => ({ ...f, kind: "flow" })),
  ];
  if (opts.only) checks = checks.filter((ch) => ch.id.includes(opts.only));

  const cacheFile = path.join(STATE_DIR, "cache.json");
  const cache = opts.noCache ? {} : readJson(cacheFile, {});
  const srcHash = sourceHash(cfg);
  for (const ch of checks) {
    ch.key = ch.kind === "invoice"
      ? sha(ch.id, rules.join("\n"), await renderedInvoice(ch.url))
      : sha(ch.id, ch.raw, srcHash);
  }

  const fresh = checks.filter((ch) => cache[ch.id] !== ch.key).length;
  log(bold(`\nInvoiceGuard · verifying with Kane CLI`) + dim(`  ${checks.length} checks, ${fresh} need a fresh run`));

  const results = await pool(checks, cfg.concurrency, async (ch, slot) => {
    let r;
    if (cache[ch.id] === ch.key) r = { status: "passed", cached: true };
    else {
      r = ch.kind === "invoice"
        ? await verify({ objective: invoiceObjective(rules), url: ch.url, timeoutSeconds: cfg.timeoutSeconds }, slot)
        : await verify({ objective: ch.objective, url: `${base}/`, timeoutSeconds: cfg.timeoutSeconds }, slot);
      if (r.status === "passed") cache[ch.id] = ch.key; else delete cache[ch.id];
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
  log(summary.passed
    ? green(bold(`\nAll ${results.length} checks passed.`)) + dim(" Report: .kane/report.md")
    : red(bold(`\n${results.filter((x) => x.result.status !== "passed").length} of ${results.length} checks failed.`)) + dim(" Report: .kane/report.md"));
  return summary;
}

async function audit(target, opts = {}) {
  if (!target) throw new Error("usage: invoiceguard audit <url | file.html | file.pdf> [--rules rules.md]");
  const cfg = loadConfig();
  const rules = loadRules(cfg, opts.rules);
  let url = target, server;
  if (!/^https?:\/\//.test(target)) {
    const file = path.resolve(target);
    if (!fs.existsSync(file)) throw new Error(`No such file: ${target}`);
    const type = file.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8";
    server = createServer((_, res) => { res.writeHead(200, { "content-type": type }); fs.createReadStream(file).pipe(res); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${server.address().port}/${path.basename(file)}`;
  }
  const visual = /\.pdf($|\?)/i.test(target);
  log(bold(`\nInvoiceGuard audit`) + dim(`  ${target} · ${rules.length} rules${visual ? " · visual mode (PDF)" : ""}`));
  const check = { id: "audit", title: `Audit of ${path.basename(target)}`, url };
  const r = await verify({ objective: invoiceObjective(rules), url, timeoutSeconds: cfg.timeoutSeconds, visual }, 0);
  server?.close();
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

  if (state.lastGreen === src) return; // nothing changed since Kane last signed off
  if (!input.stop_hook_active) state.attempts = 0; // a fresh user request

  let summary;
  try { summary = await gate(); }
  catch (err) {
    console.log(JSON.stringify({ systemMessage: `InvoiceGuard could not run Kane: ${err.message}` }));
    return;
  }

  if (summary.passed) {
    writeJson(stateFile, { lastGreen: src, attempts: 0 });
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
      "Fix the application code so these invoices are correct (do not weaken kane/rules.md or the flows), then finish again — Kane will re-verify automatically.",
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
  for (const f of ["kane/rules.md"]) {
    const dest = path.join(ROOT, f);
    if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(PKG_DIR, f), dest); }
  }
  log(green("✓ ") + (already ? "Stop hook already installed" : "Installed Claude Code Stop hook") + dim(" (.claude/settings.json)"));
  log(green("✓ ") + "GST rules at kane/rules.md — edit them in plain English");
  log(dim("Next: list your invoice pages in invoiceguard.config.json, then `invoiceguard gate`."));
}

// ------------------------------------------------------------------ main

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? (rest[i + 1] ?? true) : undefined; };

try {
  if (cmd === "gate") {
    const s = await gate({ only: flag("--only"), noCache: rest.includes("--no-cache") });
    if (rest.includes("--json")) console.log(JSON.stringify(s, null, 2));
    process.exit(s.passed ? 0 : 1);
  } else if (cmd === "audit") {
    const r = await audit(rest.find((a) => !a.startsWith("--") && a !== flag("--rules")), { rules: flag("--rules") });
    if (rest.includes("--json")) console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === "passed" ? 0 : 1);
  } else if (cmd === "hook") {
    await hook();
    process.exit(0);
  } else if (cmd === "init") {
    init();
  } else {
    log(`invoiceguard — GST invoices verified by Kane CLI

  gate [--only <id>] [--no-cache] [--json]   verify this app's invoices and flows
  audit <url|file> [--rules file] [--json]   audit any invoice page or PDF
  hook                                       Claude Code Stop hook (reads stdin)
  init                                       install the hook and rules here`);
    process.exit(cmd ? 2 : 0);
  }
} catch (err) {
  log(red(`invoiceguard: ${err.message}`));
  process.exit(2);
}
