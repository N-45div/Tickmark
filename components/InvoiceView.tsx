import { formatDate, formatINR, stateByCode, type ComputedInvoice, type Party } from "@/lib/gst";

function stateLabel(code: string) {
  const s = stateByCode(code);
  return s ? `${s.name} (${s.code})` : code;
}

function PartyBlock({ title, party, testid }: { title: string; party: Party; testid: string }) {
  return (
    <div className="party" data-testid={testid}>
      <div className="label">{title}</div>
      <div className="party-name">{party.name}</div>
      <div>{party.address}</div>
      <div>State: {stateLabel(party.stateCode)}</div>
      <div>GSTIN: {party.gstin ? <span className="mono">{party.gstin}</span> : "Unregistered"}</div>
    </div>
  );
}

export function InvoiceView({ inv }: { inv: ComputedInvoice }) {
  const { input } = inv;
  return (
    <article className="invoice" data-testid="invoice">
      <header className="inv-head">
        <div>
          <h1>Tax Invoice</h1>
          <div className="muted">Original for recipient</div>
        </div>
        <dl className="meta">
          <dt>Invoice No.</dt><dd data-testid="invoice-number">{input.number}</dd>
          <dt>Invoice date</dt><dd data-testid="invoice-date">{formatDate(input.date)}</dd>
          <dt>Due date</dt><dd><span data-testid="due-date">{formatDate(inv.dueDate)}</span><span data-testid="payment-terms">{input.paymentTermsDays ? ` (Net ${input.paymentTermsDays})` : " (Due on receipt)"}</span></dd>
          <dt>Place of supply</dt><dd data-testid="place-of-supply">{stateLabel(input.placeOfSupplyCode)}</dd>
          <dt>Reverse charge</dt><dd>{input.reverseCharge ? "Yes" : "No"}</dd>
        </dl>
      </header>

      <section className="parties">
        <PartyBlock title="Supplier" party={input.supplier} testid="supplier" />
        <PartyBlock title="Bill to" party={input.recipient} testid="recipient" />
      </section>

      <table className="items" data-testid="items">
        <thead>
          <tr>
            <th>#</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th>
            <th className="num">Rate</th><th className="num">Taxable value</th><th className="num">GST</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{it.description}</td>
              <td className="mono">{it.hsnSac}</td>
              <td className="num">{it.qty} {it.unit}</td>
              <td className="num">{formatINR(it.rate)}</td>
              <td className="num">{formatINR(it.taxable)}</td>
              <td className="num">{it.gstRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="totals" data-testid="totals">
        <div className="words">
          <div className="label">Amount in words</div>
          <div data-testid="amount-in-words">{inv.amountInWords}</div>
          <div className="label supply">
            {inv.interState ? "Inter-state supply" : "Intra-state supply"}
          </div>
        </div>
        <table>
          <tbody>
            <tr><td>Taxable value</td><td className="num" data-testid="taxable-total">{formatINR(inv.taxableTotal)}</td></tr>
            {inv.taxSummary.map((t) => (
              <tr key={`${t.kind}${t.rate}`} data-testid="tax-line">
                <td>{t.kind} @ {t.rate}%</td><td className="num">{formatINR(t.amount)}</td>
              </tr>
            ))}
            <tr><td>Round off</td><td className="num" data-testid="round-off">{formatINR(inv.roundOff)}</td></tr>
            <tr className="grand"><td>Grand total</td><td className="num" data-testid="grand-total">{formatINR(inv.grandTotal)}</td></tr>
          </tbody>
        </table>
      </section>

      {input.notes ? <p className="notes">{input.notes}</p> : null}

      <footer className="sign">
        <div>For {input.supplier.name}</div>
        <div className="sig-line">Authorised Signatory</div>
      </footer>
    </article>
  );
}
