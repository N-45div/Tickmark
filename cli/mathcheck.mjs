// Deterministic invoice arithmetic. Kane CLI is good at *reading* an invoice and
// unreliable at doing sums, so Kane extracts the numbers and this module checks them.
// Pure functions, no I/O.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "$1,950.00", "₹1,23,456.00", "-₹0.18", "(₹0.18)", "Rs. 500" → number; null if no number. */
export function parseMoney(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (/^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value) || /−/.test(value)) n = -Math.abs(n);
  return n;
}

/** First percentage in a string: "Sales tax (Texas, 8.25%)" → 8.25; null if none. */
export function parsePercent(value) {
  const m = String(value ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALE = { thousand: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, crore: 1e7, crores: 1e7, billion: 1e9 };

/**
 * Amount in words → whole number. Handles the Indian (lakh, crore) and international
 * (thousand, million) systems. Stops at "paise"/"cents". Returns null if no number words.
 */
export function wordsToNumber(text) {
  const words = String(text ?? "").toLowerCase().replace(/-/g, " ").split(/[^a-z]+/).filter(Boolean);
  let total = 0, current = 0, seen = false;
  let mark = null; // value before the last "and" / currency word: the paise or cents start after it
  for (const w of words) {
    if (w === "paise" || w === "paisa" || w === "cents" || w === "cent") {
      if (mark) ({ total, current } = mark);
      break;
    }
    if (w === "and" || /^(rupees?|dollars?|usd|inr)$/.test(w)) { mark = { total, current }; continue; }
    if (w in SMALL) { current += SMALL[w]; seen = true; }
    else if (w === "hundred") { current = (current || 1) * 100; seen = true; }
    else if (w in SCALE) { total += (current || 1) * SCALE[w]; current = 0; seen = true; }
  }
  return seen ? total + current : null;
}

/** Parse a value Kane stored as JSON text (or already an array). */
export function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return null; }
}

/**
 * Check an invoice's arithmetic from the values Kane extracted.
 * @param {object} x  { line_items, subtotal, tax_lines, round_off, total, amount_in_words }
 * @returns {{ checked: string[], findings: string[], skipped?: string }}
 */
export function checkInvoiceMath(x = {}) {
  const items = parseList(x.line_items);
  const taxLines = parseList(x.tax_lines);
  if (items === null || taxLines === null) return { checked: [], findings: [], skipped: "Kane's extracted values could not be parsed" };
  const subtotal = parseMoney(x.subtotal);
  const total = parseMoney(x.total);
  if (!items.length || total === null) return { checked: [], findings: [], skipped: "Kane did not extract the line items and total" };

  const checked = [], findings = [];
  const money = (n, like) => {
    const sym = /₹|rs\.?|inr/i.test(String(like ?? "")) ? "₹" : /\$/.test(String(like ?? "")) ? "$" : "";
    return `${n < 0 ? "-" : ""}${sym}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // India-style invoices carry a GST % per line; US-style ones carry Yes/No in a Taxable column.
  const perLineRates = items.map((it) => parsePercent(it.taxable ?? it.gst ?? it.gst_rate));
  const indiaMode = perLineRates.some((r) => r !== null);

  // 1. Each line: amount = quantity × rate
  let lineSum = 0;
  items.forEach((it, i) => {
    const qty = parseMoney(it.quantity ?? it.qty);
    const rate = parseMoney(it.rate);
    const amount = parseMoney(it.amount ?? it.taxable_value);
    if (amount !== null) lineSum += amount;
    if (qty === null || rate === null || amount === null) return;
    const expected = round2(qty * rate);
    checked.push(`line ${i + 1} amount`);
    if (Math.abs(expected - amount) > 0.01)
      findings.push(`Line ${i + 1} (${it.description ?? "item"}): amount ${money(amount, it.amount)} but ${qty} × ${money(rate, it.rate)} = ${money(expected, it.rate)}`);
  });
  lineSum = round2(lineSum);

  // 2. Subtotal = sum of line amounts
  if (subtotal !== null) {
    checked.push("subtotal");
    if (Math.abs(subtotal - lineSum) > 0.01)
      findings.push(`Subtotal ${money(subtotal, x.subtotal)} but the line amounts add up to ${money(lineSum, x.subtotal)}`);
  }

  // 3. Tax
  const taxTotal = round2(taxLines.reduce((s, t) => s + (parseMoney(t.amount) ?? 0), 0));
  if (indiaMode) {
    const expected = round2(items.reduce((s, it, i) => s + (parseMoney(it.amount) ?? 0) * (perLineRates[i] ?? 0) / 100, 0));
    const tolerance = 0.01 * (items.length * 2 + 1); // per-line, per-component rounding
    checked.push("tax");
    if (Math.abs(expected - taxTotal) > tolerance)
      findings.push(`Tax lines add up to ${money(taxTotal, x.total)} but each line × its GST rate gives ${money(expected, x.total)}`);
  } else if (taxTotal > 0.005) {
    const rate = taxLines.map((t) => parsePercent(t.label)).find((r) => r !== null);
    if (rate !== null && rate !== undefined) {
      const base = round2(items.filter((it) => /^\s*y/i.test(String(it.taxable ?? ""))).reduce((s, it) => s + (parseMoney(it.amount) ?? 0), 0));
      const expected = round2(base * rate / 100);
      checked.push("tax");
      if (Math.abs(expected - taxTotal) > 0.01)
        findings.push(`Sales tax ${money(taxTotal, x.total)} but ${rate}% of the taxable lines (${money(base, x.total)}) is ${money(expected, x.total)}`);
    }
  }

  // 4. Total = subtotal + tax + round off
  const base = subtotal ?? lineSum;
  const roundOff = parseMoney(x.round_off) ?? 0;
  const expectedTotal = round2(base + taxTotal + roundOff);
  const totalTolerance = indiaMode && !String(x.round_off ?? "").trim() ? 1 : 0.01;
  checked.push("total");
  if (Math.abs(expectedTotal - total) > totalTolerance)
    findings.push(`Total ${money(total, x.total)} but subtotal + tax${roundOff ? " + round off" : ""} = ${money(expectedTotal, x.total)}`);

  // 5. Amount in words = total
  if (String(x.amount_in_words ?? "").trim()) {
    const words = wordsToNumber(x.amount_in_words);
    if (words !== null) {
      checked.push("amount in words");
      if (words !== Math.round(total))
        findings.push(`Amount in words says ${words.toLocaleString("en-IN")} but the total is ${money(total, x.total)}`);
    }
  }

  return { checked, findings };
}
