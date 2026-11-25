import { formatUSD, formatUsDate, usState, type ComputedUsInvoice, type UsParty } from "@/lib/us";

function PartyBlock({ title, party, testid }: { title: string; party: UsParty; testid: string }) {
  return (
    <div className="party" data-testid={testid}>
      <div className="label">{title}</div>
      <div className="party-name">{party.name}</div>
      <div>{party.address}</div>
      <div>State: {usState(party.state)?.name ?? party.state} ({party.state})</div>
    </div>
  );
}

export function UsInvoiceView({ inv }: { inv: ComputedUsInvoice }) {
  const { input, decision } = inv;
  return (
    <article className="invoice" data-testid="invoice">
      <header className="inv-head">
        <div>
          <h1>Invoice</h1>
          <div className="muted">Amounts in US dollars (USD)</div>
        </div>
        <dl className="meta">
          <dt>Invoice No.</dt><dd data-testid="invoice-number">{input.number}</dd>
          <dt>Issue date</dt><dd data-testid="invoice-date">{formatUsDate(input.date)}</dd>
          <dt>Due date</dt><dd><span data-testid="due-date">{formatUsDate(inv.dueDate)}</span><span data-testid="payment-terms">{input.paymentTermsDays ? ` (Net ${input.paymentTermsDays})` : " (Due on receipt)"}</span></dd>
        </dl>
      </header>

      <section className="parties">
        <PartyBlock title="From" party={input.seller} testid="seller" />
        <div>
          <PartyBlock title="Bill to" party={input.customer} testid="customer" />
          {input.exemptCertificate ? (
            <div className="exempt" data-testid="exemption">Tax exempt — certificate {input.exemptCertificate}</div>
          ) : null}
        </div>
      </section>

      <table className="items" data-testid="items">
        <thead>
          <tr>
            <th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Rate</th>
            <th className="num">Amount</th><th className="num">Taxable</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{it.description}</td>
              <td className="num">{it.qty} {it.unit}</td>
              <td className="num">{formatUSD(it.rate)}</td>
              <td className="num">{formatUSD(it.amount)}</td>
              <td className="num">{it.taxable ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="totals" data-testid="totals">
        <div className="words">
          <div className="label">Sales tax</div>
          <div data-testid="tax-decision">
            {decision.collect
              ? `Collected on taxable items (${formatUSD(inv.taxableAmount)}) at ${input.taxRate}%.`
              : decision.reason + "."}
          </div>
        </div>
        <table>
          <tbody>
            <tr><td>Subtotal</td><td className="num" data-testid="subtotal">{formatUSD(inv.subtotal)}</td></tr>
            <tr data-testid="tax-line">
              <td>{decision.collect ? decision.label : "Sales tax"}</td>
              <td className="num">{formatUSD(inv.tax)}</td>
            </tr>
            <tr className="grand"><td>Total due</td><td className="num" data-testid="grand-total">{formatUSD(inv.total)}</td></tr>
          </tbody>
        </table>
      </section>

      {input.notes ? <p className="notes">{input.notes}</p> : null}

      <footer className="sign">
        <div>Thank you for your business — {input.seller.name}</div>
      </footer>
    </article>
  );
}
