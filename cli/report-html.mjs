// A single, self-contained HTML report for a gate run or an audit: the page people open,
// screenshot and share. Everything shown is escaped, because it includes text Kane read from
// the checked documents. Links are only rendered for http(s) URLs.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeHref = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : null);

const STATUS = {
  passed: { label: "Passed", cls: "ok", icon: "✓" },
  failed: { label: "Failed", cls: "bad", icon: "✗" },
  inconclusive: { label: "Inconclusive", cls: "warn", icon: "?" },
  error: { label: "Didn't run", cls: "warn", icon: "!" },
};

function row({ title, url, result: r }) {
  const st = STATUS[r.status] ?? STATUS.error;
  const parts = [];
  if (r.bugTitle) parts.push(`<p class="bug">${esc(r.bugTitle)}</p>`);
  const why = r.rootCause || (r.status !== "passed" ? r.oneLiner || r.reason : "");
  if (why) parts.push(`<p>${esc(why)}</p>`);
  if (r.status === "inconclusive") parts.push(`<p class="note">Kane judged this a problem with the check itself, not with the document.</p>`);
  const math = r.math?.findings ?? [];
  if (math.length) parts.push(`<p class="label">Arithmetic, re-added in code</p><ul>${math.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
  const broken = (r.failedSteps ?? []).map((f) => f.replace(/^assert:\s*/, ""));
  if (broken.length) parts.push(`<p class="label">Rules not met</p><ul>${broken.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
  if (r.suggestion) parts.push(`<p><span class="label">Suggested fix</span> ${esc(r.suggestion)}</p>`);
  const meta = [];
  if (r.math?.checked?.length && !math.length) meta.push(`math ✓ ${r.math.checked.length} sums`);
  if (r.cached) meta.push("unchanged since it was last checked");
  else if (r.seconds) meta.push(`${r.seconds}s`);
  const links = [];
  const rec = safeHref(r.testUrl);
  if (rec) links.push(`<a href="${rec}">Kane recording</a>`);
  const page = safeHref(url);
  if (page) links.push(`<a href="${page}">checked page</a>`);
  if (r.evidencePack) links.push(`<code>kane-cli evidence serve ${esc(r.evidencePack)}</code>`);
  return `<li class="check ${st.cls}">
  <div class="head"><span class="pill">${st.icon} ${st.label}</span><span class="title">${esc(title)}</span>${meta.length ? `<span class="meta">${esc(meta.join(" · "))}</span>` : ""}</div>
  ${parts.join("\n  ")}
  ${links.length ? `<p class="links">${links.join(" · ")}</p>` : ""}
</li>`;
}

/**
 * @param {{heading: string, subtitle?: string, rows: {title: string, url?: string, result: object}[]}} report
 */
export function renderReport({ heading, subtitle = "", rows }) {
  const failed = rows.filter((x) => x.result.status === "failed").length;
  const unsure = rows.filter((x) => !["passed", "failed"].includes(x.result.status)).length;
  const verdict = failed ? `${failed} of ${rows.length} failed` : unsure ? `${unsure} of ${rows.length} inconclusive` : `All ${rows.length} passed`;
  const cls = failed ? "bad" : unsure ? "warn" : "ok";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e3e0d8;--ok:#1f7a52;--bad:#b42318;--warn:#a15c00}
@media (prefers-color-scheme:dark){:root{--bg:#141517;--card:#1f2023;--ink:#ececec;--muted:#a0a0a6;--line:#34353a;--ok:#4cc38a;--bad:#ff6b5e;--warn:#f5b453}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}h1{font-size:24px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
.verdict{display:inline-block;font-weight:700;padding:6px 14px;border-radius:999px;margin-bottom:20px;border:2px solid currentColor}
.verdict.ok{color:var(--ok)}.verdict.bad{color:var(--bad)}.verdict.warn{color:var(--warn)}
ul.checks{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.check{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:10px;padding:14px 16px}
.check.ok{border-left-color:var(--ok)}.check.bad{border-left-color:var(--bad)}.check.warn{border-left-color:var(--warn)}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.title{font-weight:600}.meta{color:var(--muted);font-size:13px;margin-left:auto}
.pill{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.ok .pill{color:var(--ok)}.bad .pill{color:var(--bad)}.warn .pill{color:var(--warn)}
.check p{margin:8px 0 0}.bug{font-weight:600}.label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.note{color:var(--muted);font-style:italic}.check ul{margin:4px 0 0;padding-left:20px}.links{font-size:13px;color:var(--muted)}
a{color:inherit}code{font:12px ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
footer{margin-top:28px;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>${esc(heading)}</h1>
<p class="sub">${esc(subtitle)}</p>
<div class="verdict ${cls}">${esc(verdict)}</div>
<ul class="checks">
${rows.map(row).join("\n")}
</ul>
<footer>Checked by <a href="https://github.com/LambdaTest/kane-cli">Kane CLI</a> in a real browser, with every number re-added in code by InvoiceGuard. Findings to review, not tax or legal advice.</footer>
</main></body></html>
`;
}
