import { describe, expect, it } from "vitest";
import { computeUsInvoice, taxDecision, usInvoiceNumber } from "./us";
import { US_SAMPLES } from "./fixtures";

describe("US sales tax", () => {
  it("taxes only taxable lines in a nexus state", () => {
    const c = computeUsInvoice(US_SAMPLES["us-taxable-goods"].invoice);
    expect(c.subtotal).toBe(3325);
    expect(c.taxableAmount).toBe(925);
    expect(c.tax).toBe(76.31); // 925 × 8.25% = 76.3125
    expect(c.total).toBe(3401.31);
  });
  it("collects nothing without nexus", () => {
    const c = computeUsInvoice(US_SAMPLES["us-no-nexus"].invoice);
    expect(c.decision).toEqual({ collect: false, reason: "Sales tax not collected: seller has no nexus in Colorado" });
    expect(c.tax).toBe(0);
  });
  it("honours an exemption certificate", () => {
    const c = computeUsInvoice(US_SAMPLES["us-exempt-reseller"].invoice);
    expect(c.decision.collect).toBe(false);
    expect(c.tax).toBe(0);
    expect(c.total).toBe(2800);
  });
  it("never taxes in a no-sales-tax state, even with nexus", () => {
    const d = taxDecision(US_SAMPLES["us-no-sales-tax-state"].invoice);
    expect(d).toEqual({ collect: false, reason: "No sales tax: Oregon has no statewide sales tax" });
  });
  it("numbers invoices by year", () => {
    expect(usInvoiceNumber("2026-11-18", 12)).toBe("INV-2026-0012");
  });
});
