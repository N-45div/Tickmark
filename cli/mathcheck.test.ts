import { describe, expect, it } from "vitest";
import { checkInvoiceMath, checkPaymentTerms, parseDateCandidates, parseMoney, parsePaymentDays, parsePercent, wordsToNumber } from "./mathcheck.mjs";
import { computeInvoice, formatDate, formatINR, rupeesInWords } from "../lib/gst";
import { computeUsInvoice, formatUSD, formatUsDate } from "../lib/us";
import { SAMPLES, US_SAMPLES } from "../lib/fixtures";

describe("parsing", () => {
  it("reads money in both currencies and signs", () => {
    expect(parseMoney("$1,950.00")).toBe(1950);
    expect(parseMoney("₹1,23,456.50")).toBe(123456.5);
    expect(parseMoney("-₹0.18")).toBe(-0.18);
    expect(parseMoney("(₹0.18)")).toBe(-0.18);
    expect(parseMoney("10 hrs")).toBe(10);
    expect(parseMoney("")).toBe(null);
  });
  it("reads percentages", () => {
    expect(parsePercent("Sales tax (Texas, 8.25%)")).toBe(8.25);
    expect(parsePercent("IGST @ 18%")).toBe(18);
    expect(parsePercent("No")).toBe(null);
  });
  it("reads amounts in words, Indian and international", () => {
    expect(wordsToNumber("Indian Rupees Twenty Nine Thousand Five Hundred Only")).toBe(29500);
    expect(wordsToNumber("Indian Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only")).toBe(1234567);
    expect(wordsToNumber("Indian Rupees Three Crore One Only")).toBe(30000001);
    expect(wordsToNumber("Twenty-Five Thousand Nine Hundred Sixty US Dollars")).toBe(25960);
    expect(wordsToNumber("One Million Two Hundred Thousand")).toBe(1200000);
    expect(wordsToNumber("Rupees Ten and Fifty Paise")).toBe(10);
    expect(wordsToNumber("Only")).toBe(null);
  });
});

/** What Kane would extract from one of our own rendered invoices. */
function extractIndia(id: string) {
  const c = computeInvoice(SAMPLES[id].invoice);
  return {
    line_items: JSON.stringify(c.items.map((it) => ({
      description: it.description, quantity: `${it.qty} ${it.unit}`, rate: formatINR(it.rate),
      amount: formatINR(it.taxable), taxable: `${it.gstRate}%`,
    }))),
    subtotal: formatINR(c.taxableTotal),
    tax_lines: JSON.stringify(c.taxSummary.map((t) => ({ label: `${t.kind} @ ${t.rate}%`, amount: formatINR(t.amount) }))),
    round_off: formatINR(c.roundOff),
    total: formatINR(c.grandTotal),
    amount_in_words: c.amountInWords,
  };
}
function extractUs(id: string) {
  const c = computeUsInvoice(US_SAMPLES[id].invoice);
  return {
    line_items: JSON.stringify(c.items.map((it) => ({
      description: it.description, quantity: `${it.qty} ${it.unit}`, rate: formatUSD(it.rate),
      amount: formatUSD(it.amount), taxable: it.taxable ? "Yes" : "No",
    }))),
    subtotal: formatUSD(c.subtotal),
    tax_lines: JSON.stringify([{ label: c.decision.collect ? c.decision.label : "Sales tax", amount: formatUSD(c.tax) }]),
    round_off: "",
    total: formatUSD(c.total),
    amount_in_words: "",
  };
}

describe("checkInvoiceMath on our own invoices", () => {
  for (const id of Object.keys(SAMPLES))
    it(`India sample ${id} has no arithmetic findings`, () => {
      const r = checkInvoiceMath(extractIndia(id));
      expect(r.findings).toEqual([]);
      expect(r.checked).toContain("amount in words");
    });
  for (const id of Object.keys(US_SAMPLES))
    it(`US sample ${id} has no arithmetic findings`, () => {
      expect(checkInvoiceMath(extractUs(id)).findings).toEqual([]);
    });
});

describe("checkInvoiceMath catches the mistakes Kane missed", () => {
  // Exactly what Kane extracted from examples/us-vendor-invoice.html (19 Nov run).
  const vendor = {
    line_items: '[{"description":"SEO consulting (non-taxable service)","quantity":"1","rate":"$1,500.00","amount":"$1,500.00","taxable":"No"},{"description":"Branded USB drives","quantity":"12","rate":"$45.00","amount":"$450.00","taxable":"Yes"}]',
    subtotal: "$1,950.00",
    tax_lines: '[{"label":"Sales tax (Texas, 8.25%)","amount":"$160.88"}]',
    round_off: "",
    total: "$2,110.88",
    amount_in_words: "",
  };
  it("flags the wrong line amount and the tax on a non-taxable line", () => {
    const r = checkInvoiceMath(vendor);
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]).toMatch(/Line 2 .*\$450\.00 but 12 × \$45\.00 = \$540\.00/);
    expect(r.findings[1]).toMatch(/Sales tax \$160\.88 but 8\.25% of the taxable lines \(\$450\.00\) is \$37\.13/);
  });
  it("flags amount in words that doesn't match the total", () => {
    const x = extractIndia("inter-state");
    x.amount_in_words = rupeesInWords(25000); // words from the taxable value, not the grand total
    expect(checkInvoiceMath(x).findings).toEqual(["Amount in words says 25,000 but the total is ₹29,500.00"]);
  });
  it("flags a total that doesn't add up", () => {
    const x = extractUs("us-taxable-goods");
    x.total = "$3,599.31";
    expect(checkInvoiceMath(x).findings[0]).toMatch(/Total \$3,599\.31 but subtotal \+ tax = \$3,401\.31/);
  });
  it("recovers a total that was read into the round-off field (seen on a PDF)", () => {
    const r = checkInvoiceMath({ ...vendor, round_off: "$2,110.88", total: "" });
    expect(r.skipped).toBeUndefined();
    expect(r.checked).toContain("total");
    expect(r.findings).toHaveLength(2);
  });
  it("still checks lines, subtotal and tax when the total is missing", () => {
    const r = checkInvoiceMath({ ...vendor, total: "" });
    expect(r.findings).toHaveLength(2);
    expect(r.checked).not.toContain("total");
    expect(r.skipped).toMatch(/total/);
  });
  it('treats the word "none" as an absent field', () => {
    const x = { ...extractUs("us-no-nexus"), round_off: "none", amount_in_words: "none" };
    const r = checkInvoiceMath(x);
    expect(r.findings).toEqual([]);
    expect(r.checked).toContain("total");
    expect(r.checked).not.toContain("amount in words");
  });
  it("skips politely when Kane extracted nothing", () => {
    expect(checkInvoiceMath({}).skipped).toBeTruthy();
    expect(checkInvoiceMath({ line_items: "not json", total: "$1" }).skipped).toMatch(/could not be parsed/);
  });
});

describe("due date vs payment terms", () => {
  it("reads printed dates, and keeps both meanings of an ambiguous one", () => {
    const nov25 = Date.UTC(2026, 10, 25) / 864e5;
    expect(parseDateCandidates("25 Nov 2026")).toEqual([nov25]);
    expect(parseDateCandidates("Nov 25th, 2026")).toEqual([nov25]);
    expect(parseDateCandidates("2026-11-25")).toEqual([nov25]);
    expect(parseDateCandidates("25-11-2026")).toEqual([nov25]);
    expect(parseDateCandidates("03/12/2026")).toHaveLength(2);
    expect(parseDateCandidates("none")).toEqual([]);
  });

  it("reads the payment period from common wordings", () => {
    expect(parsePaymentDays("1. Payment due within 7 days of invoice via UPI/NEFT/IMPS.")).toBe(7);
    expect(parsePaymentDays("Net 30")).toBe(30);
    expect(parsePaymentDays("(Net-15)")).toBe(15);
    expect(parsePaymentDays("Due on receipt")).toBe(0);
    expect(parsePaymentDays("Late payments attract interest @ 2% per month")).toBeNull();
    expect(parsePaymentDays("none")).toBeNull();
  });

  it("catches terms that contradict the due date (a real invoice from an open-source GST app)", () => {
    const r = checkPaymentTerms({ payment_terms: "Payment due within 7 days of invoice", invoice_date: "25 Nov 2026", due_date: "10 Dec 2026" });
    expect(r?.finding).toBe('Payment terms say "Payment due within 7 days of invoice" (7 days) but the due date 10 Dec 2026 is 15 days after the invoice date 25 Nov 2026');
  });

  it("passes every sample invoice this app renders, in both date formats", () => {
    const add = (iso: string, days: number) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
    for (const { invoice } of Object.values(SAMPLES)) {
      const days = invoice.paymentTermsDays ?? 0;
      const terms = days ? `Net ${days}` : "Due on receipt";
      expect(checkPaymentTerms({ payment_terms: terms, invoice_date: formatDate(invoice.date), due_date: formatDate(add(invoice.date, days)) })?.finding).toBeUndefined();
    }
    for (const { invoice } of Object.values(US_SAMPLES)) {
      const days = invoice.paymentTermsDays ?? 0;
      expect(checkPaymentTerms({ payment_terms: `Net ${days}`, invoice_date: formatUsDate(invoice.date), due_date: formatUsDate(add(invoice.date, days)) })?.finding).toBeUndefined();
    }
  });

  it("never guesses: an ambiguous date that fits one reading is not reported", () => {
    // 03/12/2026 + Net 9 = 12/12/2026 if day-first; month-first would be a different gap.
    expect(checkPaymentTerms({ payment_terms: "Net 9", invoice_date: "03/12/2026", due_date: "12/12/2026" })?.finding).toBeUndefined();
  });

  it("is skipped when the terms state no period, and joins the other findings when it fires", () => {
    expect(checkPaymentTerms({ payment_terms: "none", invoice_date: "25 Nov 2026", due_date: "10 Dec 2026" })).toBeNull();
    const r = checkInvoiceMath({
      line_items: JSON.stringify([{ description: "Design", quantity: "1", rate: "₹100.00", amount: "₹100.00", taxable: "18%" }]),
      subtotal: "₹100.00", tax_lines: JSON.stringify([{ label: "IGST @ 18%", amount: "₹18.00" }]), total: "₹118.00",
      payment_terms: "Net 7", invoice_date: "25 Nov 2026", due_date: "10 Dec 2026",
    });
    expect(r.checked).toContain("due date vs payment terms");
    expect(r.findings).toHaveLength(1);
  });
});
