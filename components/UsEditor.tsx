"use client";

import { useEffect, useMemo, useState } from "react";
import { UsInvoiceView } from "@/components/UsInvoiceView";
import { US_SELLER } from "@/lib/fixtures";
import {
  NO_SALES_TAX, US_STATES, computeUsInvoice, usInvoiceNumber, usState,
  type UsInvoiceInput, type UsLineItem, type UsParty,
} from "@/lib/us";

const STORE_KEY = "invoiceguard:us:v1";
type Store = { seq: number; issued: UsInvoiceInput[]; seller: UsParty; nexus: string[] };

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {}
  return { seq: 0, issued: [], seller: US_SELLER, nexus: ["CA"] };
}
function saveStore(s: Store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = (): UsLineItem => ({ description: "", qty: 1, unit: "ea", rate: 0, taxable: false });
const blankCustomer = (): UsParty => ({ name: "", address: "", state: "CA" });

export function UsEditor({ switcher }: { switcher?: React.ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [date, setDate] = useState(today());
  const [terms, setTerms] = useState(30);
  const [customer, setCustomer] = useState<UsParty>(blankCustomer());
  const [exempt, setExempt] = useState("");
  const [rate, setRate] = useState<number>(usState("CA")!.baseRate);
  const [items, setItems] = useState<UsLineItem[]>([blankItem()]);
  const [notes, setNotes] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => setStore(loadStore()), []);

  const nexus = store?.nexus ?? ["CA"];
  const input: UsInvoiceInput = {
    number: usInvoiceNumber(date, (store?.seq ?? 0) + 1),
    date, paymentTermsDays: terms, seller: store?.seller ?? US_SELLER, nexusStates: nexus,
    customer, exemptCertificate: exempt.trim() || undefined, taxRate: rate,
    items: items.filter((i) => i.description.trim()), notes: notes.trim() || undefined,
  };
  const computed = useMemo(() => computeUsInvoice(input), [JSON.stringify(input)]); // eslint-disable-line

  const problems: string[] = [];
  if (!customer.name.trim()) problems.push("Add the customer's name.");
  if (!customer.address.trim()) problems.push("Add the customer's address.");
  if (input.items.length === 0) problems.push("Add at least one line item.");
  input.items.forEach((it, i) => {
    if (!(it.qty > 0) || !(it.rate >= 0)) problems.push(`Item ${i + 1}: quantity and rate must be positive.`);
  });
  if (!(rate >= 0 && rate < 20)) problems.push("Sales tax rate looks wrong (expected 0–20%).");

  function setCustomerState(code: string) {
    setCustomer({ ...customer, state: code });
    setRate(usState(code)?.baseRate ?? 0); // start from the state base rate; user adds local
  }
  function toggleNexus(code: string) {
    if (!store) return;
    const next = { ...store, nexus: store.nexus.includes(code) ? store.nexus.filter((c) => c !== code) : [...store.nexus, code].sort() };
    saveStore(next);
    setStore(next);
  }
  function updateItem(i: number, patch: Partial<UsLineItem>) {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function issue() {
    if (!store || problems.length) return;
    const next: Store = { ...store, seq: store.seq + 1, issued: [input, ...store.issued] };
    saveStore(next);
    setStore(next);
    setFlash(`Issued ${input.number}`);
    setCustomer(blankCustomer());
    setExempt("");
    setRate(usState("CA")!.baseRate);
    setItems([blankItem()]);
    setNotes("");
  }

  const customerStateName = usState(customer.state)?.name ?? customer.state;

  return (
    <div className="editor">
      <form className="panel no-print" onSubmit={(e) => { e.preventDefault(); issue(); }}>
        {switcher}
        <h2>New invoice · United States</h2>
        <div className="row">
          <label>Issue date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Payment terms
            <select value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
              {[0, 7, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d ? `Net ${d}` : "Due on receipt"}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend>Customer</legend>
          <label>Name<input aria-label="Customer name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
          <label>Address<input aria-label="Customer address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} /></label>
          <div className="row">
            <label>State
              <select aria-label="Customer state" value={customer.state} onChange={(e) => setCustomerState(e.target.value)}>
                {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            <label>Sales tax rate %
              <input aria-label="Sales tax rate" type="number" min="0" step="0.001" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
            </label>
          </div>
          <p className="hint">
            {NO_SALES_TAX.includes(customer.state)
              ? `${customerStateName} has no statewide sales tax.`
              : `${customerStateName} base rate is ${usState(customer.state)?.baseRate}%. Add your customer's local rate.`}
          </p>
          <label>Exemption / resale certificate (blank if none)
            <input aria-label="Exemption certificate" value={exempt} onChange={(e) => setExempt(e.target.value)} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Where you collect sales tax (nexus)</legend>
          <div className="row">
            <label>Add a state
              <select aria-label="Add nexus state" value="" onChange={(e) => e.target.value && toggleNexus(e.target.value)}>
                <option value="">Choose…</option>
                {US_STATES.filter((s) => !nexus.includes(s.code)).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="actions" data-testid="nexus-states">
            {nexus.map((c) => (
              <button type="button" className="ghost" key={c} aria-label={`Remove nexus ${usState(c)?.name}`} onClick={() => toggleNexus(c)}>
                {usState(c)?.name} ✕
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Items</legend>
          {items.map((it, i) => (
            <div className="item-row us-row" key={i}>
              <input aria-label={`Item ${i + 1} description`} placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
              <input aria-label={`Item ${i + 1} quantity`} type="number" min="0" step="any" value={it.qty} onChange={(e) => updateItem(i, { qty: Number(e.target.value) })} />
              <input aria-label={`Item ${i + 1} unit`} value={it.unit} onChange={(e) => updateItem(i, { unit: e.target.value })} />
              <input aria-label={`Item ${i + 1} rate`} type="number" min="0" step="any" value={it.rate} onChange={(e) => updateItem(i, { rate: Number(e.target.value) })} />
              <label className="check"><input type="checkbox" aria-label={`Item ${i + 1} taxable`} checked={it.taxable} onChange={(e) => updateItem(i, { taxable: e.target.checked })} />Taxable</label>
              <button type="button" className="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => setItems((xs) => xs.length > 1 ? xs.filter((_, j) => j !== i) : xs)}>✕</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setItems((xs) => [...xs, blankItem()])}>+ Add item</button>
        </fieldset>

        <label>Notes (optional)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ACH / wire details, late fee terms…" /></label>

        {problems.length > 0 && (
          <ul className="problems" data-testid="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <div className="actions">
          <button type="submit" disabled={!store || problems.length > 0}>Issue invoice</button>
          <button type="button" className="ghost" onClick={() => window.print()}>Print / Save PDF</button>
          {flash && <span className="flash" role="status">{flash}</span>}
        </div>

        {store && store.issued.length > 0 && (
          <div className="history">
            <h3>Issued</h3>
            <ul>{store.issued.slice(0, 5).map((x) => <li key={x.number}><span className="mono">{x.number}</span> — {x.customer.name}</li>)}</ul>
          </div>
        )}
      </form>

      <div className="preview">
        <div className="label no-print">Live preview</div>
        <UsInvoiceView inv={computed} />
      </div>
    </div>
  );
}
