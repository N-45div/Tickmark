import { describe, expect, it } from "vitest";
import {
  computeInvoice, financialYear, invoiceNumber, rupeesInWords, taxesFor,
  validInvoiceNumber, validateGstin,
} from "./gst";
import { SAMPLES } from "./fixtures";

describe("GSTIN", () => {
  it("accepts a known-valid GSTIN", () => {
    expect(validateGstin("27AAPFU0939F1ZV")).toEqual({ ok: true, stateCode: "27" });
  });
  it("rejects a bad checksum", () => {
    expect(validateGstin("27AAPFU0939F1ZX").ok).toBe(false);
  });
  it("rejects a GSTIN from the wrong state", () => {
    const r = validateGstin("27AAPFU0939F1ZV", "29");
    expect(r.ok).toBe(false);
  });
  it("all sample GSTINs are valid and match their state", () => {
    for (const { invoice } of Object.values(SAMPLES)) {
      for (const p of [invoice.supplier, invoice.recipient])
        if (p.gstin) expect(validateGstin(p.gstin, p.stateCode).ok).toBe(true);
    }
  });
});

describe("tax split", () => {
  it("intra-state → CGST + SGST halves", () => {
    expect(taxesFor(1000, 18, false, "29")).toEqual([
      { kind: "CGST", rate: 9, amount: 90 },
      { kind: "SGST", rate: 9, amount: 90 },
    ]);
  });
  it("intra-UT → CGST + UTGST", () => {
    expect(taxesFor(1000, 18, false, "04").map((t) => t.kind)).toEqual(["CGST", "UTGST"]);
  });
  it("inter-state → IGST only", () => {
    expect(taxesFor(1000, 18, true, "27")).toEqual([{ kind: "IGST", rate: 18, amount: 180 }]);
  });
});

describe("computeInvoice", () => {
  it("inter-state sample: IGST 18% on ₹25,000", () => {
    const c = computeInvoice(SAMPLES["inter-state"].invoice);
    expect(c.interState).toBe(true);
    expect(c.taxableTotal).toBe(25000);
    expect(c.taxSummary).toEqual([{ kind: "IGST", rate: 18, amount: 4500 }]);
    expect(c.grandTotal).toBe(29500);
    expect(c.amountInWords).toBe("Indian Rupees Twenty Nine Thousand Five Hundred Only");
    expect(c.dueDate).toBe("2026-12-18");
  });
  it("mixed rates aggregate per rate and round off to the rupee", () => {
    const c = computeInvoice(SAMPLES["unregistered-buyer"].invoice);
    // Karnataka → Maharashtra is inter-state, so both rates are IGST
    expect(c.taxableTotal).toBe(11561.5);
    expect(c.taxSummary).toEqual([
      { kind: "IGST", rate: 18, amount: 1439.82 },
      { kind: "IGST", rate: 12, amount: 427.5 },
    ]);
    expect(c.grandTotal).toBe(13429);
    expect(c.roundOff).toBe(0.18);
  });
});

describe("words & numbering", () => {
  it("uses lakh and crore", () => {
    expect(rupeesInWords(12_34_567)).toBe("Indian Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only");
    expect(rupeesInWords(3_00_00_001)).toBe("Indian Rupees Three Crore One Only");
  });
  it("financial year starts in April", () => {
    expect(financialYear("2026-03-31")).toBe("25-26");
    expect(financialYear("2026-04-01")).toBe("26-27");
  });
  it("invoice numbers satisfy Rule 46 format", () => {
    const n = invoiceNumber("2026-11-18", 7);
    expect(n).toBe("INV/26-27/0007");
    expect(validInvoiceNumber(n)).toBe(true);
    expect(validInvoiceNumber("INVOICE/2026-27/00001")).toBe(false);
  });
});
