// "Graduated readers": Kane CLI writes the invoice-reading test once, exports it to
// Playwright, and from then on the numbers are read by plain code in about a second,
// offline and for zero Kane credits. cli/mathcheck.mjs then checks the sums.
//
// A reader belongs to an invoice *layout* (e.g. our US invoice), not to one invoice, so a
// single graduation covers every invoice rendered with that layout. If the layout changes
// and a reader can't find its elements, callers fall back to a Kane reading pass.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "INVOICEGUARD_READ ";
const FIELDS = ["line_items", "subtotal", "tax_lines", "round_off", "total", "amount_in_words"];

/**
 * Turn Kane's Playwright export into a reusable reader:
 *  - drop Kane's own "has been stored" self-check steps (authoring-time only, layout-brittle),
 *  - drop TestMu account ids (build, test case, instruction ids),
 *  - read the invoice URL from INVOICE_URL instead of the recorded one,
 *  - print what was read on one line, for runReader().
 */
export function sanitizeExport(code, { name, recordedUrl }) {
  // Split off the closing of the test body ("});" … testmu.run()) before touching the steps,
  // because the last step's block would otherwise carry it away when removed.
  const run = [...code.matchAll(/\n\}\);\s*testmu\.run\(\);?\s*$/g)].pop();
  if (!run) throw new Error("Unexpected Kane export layout: no testmu.run() at the end");
  const body = code.slice(0, run.index);
  const tail = code.slice(run.index);

  const blocks = body.split(/(?=\n {2}await testmu\.step\()/);
  let s = blocks.filter((b) => !b.includes("_stored_check") && !b.includes('"Assertion check"')).join("");

  s = s.replace(/testmu\.configure\(\{[\s\S]*?\n\}\);/, `testmu.configure({
  "name": ${JSON.stringify(`${name} invoice reader`)},
  "defaultActionTimeoutMs": 10000,
  "defaultNavigationTimeoutMs": 60000,
  "kaneRunV4": true
});`);
  s = s.replace(/,\s*\{\s*instructionId:\s*"[^"]*"\s*\}/g, "");
  if (recordedUrl) {
    s = s.split(`testmu.step("Navigate to ${recordedUrl}"`).join('testmu.step("Open the invoice"');
    s = s.split(`page.goto("${recordedUrl}")`).join("page.goto(process.env.INVOICE_URL)");
  }

  const print = `
  await testmu.step("Report what was read", async () => {
    const read = {};
    for (const k of ${JSON.stringify(FIELDS)}) read[k] = await resolveVar(\`{{\${k}}}\`);
    console.log(${JSON.stringify(MARKER)} + JSON.stringify(read));
  });`;
  s = s.replace(/\s*$/, "") + "\n" + print + tail;

  const header = [
    `// Graduated invoice reader for the ${name} invoice layout.`,
    "// Written by Kane CLI once (`invoiceguard graduate`), exported to Playwright, cleaned up.",
    "// It only READS the numbers; cli/mathcheck.mjs checks them. Runs offline, no Kane credits.",
    "// Run: INVOICE_URL=http://localhost:3000/invoice/sample/<id> node <this file>",
    "",
  ].join("\n");
  return header + s;
}

/** Run a reader against one invoice URL; resolves with the values it read (or throws). */
export function runReader(file, url, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, INVOICE_URL: url, TESTMU_RUN_TARGET: "local" };
    delete env.LT_USERNAME; // keep readers fully local: no dashboard uploads
    delete env.LT_ACCESS_KEY;
    const child = spawn(process.execPath, [file], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`reader timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith(MARKER));
      if (code === 0 && line) {
        try { return resolve(JSON.parse(line.slice(MARKER.length))); } catch {}
      }
      const why = (out + err).split("\n").find((l) => /FAIL|Error/.test(l))?.trim() ?? `exit ${code}`;
      reject(new Error(`reader could not read ${url}: ${why}`));
    });
  });
}

/** Where a pack's graduated reader lives (whether or not it exists yet). */
export const readerPath = (root, pack) => path.join(root, "kane", "graduated", `${pack}.reader.mjs`);

/**
 * Author a reading test with Kane, export it, sanitize it, save it as the pack's reader.
 * `runKaneTestmd(dir, file)` runs `kane-cli testmd run` in `dir` and resolves when done.
 */
export async function graduate({ root, pack, url, objective, runKaneTestmd, exportTestmd, validate }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `invoiceguard-graduate-${pack}-`));
  try {
    const file = `${pack}-read_test.md`;
    fs.writeFileSync(path.join(dir, file),
      `---\nurl: ${url}\nmode: testing\nheadless: true\n---\n\n# Read the ${pack} invoice numbers\n\n## Read the numbers\n${objective}\n`);
    const ok = await runKaneTestmd(dir, file);
    if (!ok) throw new Error("Kane could not author the reading test");
    const exported = await exportTestmd(dir, file);
    const code = sanitizeExport(fs.readFileSync(exported, "utf8"), { name: pack, recordedUrl: url });
    // Kane's generated selectors sometimes pin the values it saw while authoring. A reader that
    // only works on that one invoice would report bugs that don't exist, so it must read every
    // known-good sample of its layout correctly before it replaces the current reader.
    const dest = readerPath(root, pack);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const candidate = dest.replace(/\.mjs$/, ".candidate.mjs");
    fs.writeFileSync(candidate, code);
    try {
      const problems = validate ? await validate(candidate) : [];
      if (problems.length) return { installed: false, problems };
      fs.renameSync(candidate, dest);
      return { installed: true, dest, problems: [] };
    } finally {
      fs.rmSync(candidate, { force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
