import { describe, expect, it } from "vitest";
import { renderReport } from "./report-html.mjs";

describe("renderReport", () => {
  const html = renderReport({
    heading: "InvoiceGuard audit",
    subtitle: "vendor-invoice.html",
    rows: [
      { title: "Invoice A", url: "http://localhost:3000/a", result: { status: "passed", math: { checked: ["line 1 amount", "total"], findings: [] } } },
      {
        title: "Invoice <b>B</b>", url: "javascript:alert(1)",
        result: {
          status: "failed", bugTitle: "<script>alert('x')</script>", testUrl: "https://example.test/rec",
          math: { checked: ["tax"], findings: ["Sales tax $274.31 but 8.25% of the taxable lines ($925.00) is $76.31"] },
        },
      },
    ],
  });

  it("escapes everything that came from a document or Kane", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("Invoice &lt;b&gt;B&lt;/b&gt;");
  });
  it("only links http(s) URLs", () => {
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain('href="https://example.test/rec"');
  });
  it("shows the verdict, math findings and math passes", () => {
    expect(html).toContain("1 of 2 failed");
    expect(html).toContain("is $76.31");
    expect(html).toContain("math ✓ 2 sums");
  });
});
