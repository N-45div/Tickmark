"use client";

import { useEffect, useMemo, useState } from "react";
import { InvoiceView } from "@/components/InvoiceView";
import { SUPPLIER } from "@/lib/fixtures";
import {
  GST_RATES, STATES, computeInvoice, invoiceNumber, validateGstin,
  type InvoiceInput, type LineItem, type Party,
} from "@/lib/gst";

const STORE_KEY = "invoiceguard:v1";
type Store = { seq: number; issued: InvoiceInput[]; supplier: Party };

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {}
  return { seq: 0, issued: [], supplier: SUPPLIER };
}
function saveStore(s: Store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = (): LineItem => ({ description: "", hsnSac: "", qty: 1, unit: "job", rate: 0, gstRate: 18 });
const blankRecipient = (): Party => ({ name: "", address: "", stateCode: "29", gstin: "" });

export default function Editor() {
  const [store, setStore] = useState<Store | null>(null);
  const [date, setDate] = useState(today());
  const [terms, setTerms] = useState(30);
  const [recipient, setRecipient] = useState<Party>(blankRecipient());
  const [posOverride, setPosOverride] = useState<string>("");
  const [items, setItems] = useState<LineItem[]>([blankItem()]);
  const [notes, setNotes] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => setStore(loadStore()), []);

  const supplier = store?.supplier ?? SUPPLIER;
  const placeOfSupplyCode = posOverride || recipient.stateCode;
  const draftNumber = invoiceNumber(date, (store?.seq ?? 0) + 1);

  const input: InvoiceInput = {
    number: draftNumber, date, paymentTermsDays: terms, supplier,
    recipient: { ...recipient, gstin: recipient.gstin?.trim().toUpperCase() || undefined },
    placeOfSupplyCode, reverseCharge: false,
    items: items.filter((i) => i.description.trim()), notes: notes.trim() || undefined,
  };
  const computed = useMemo(() => computeInvoice(input), [JSON.stringify(input)]); // eslint-disable-line

  const problems: string[] = [];
  if (!recipient.name.trim()) problems.push("Add the client's name.");
  if (!recipient.address.trim()) problems.push("Add the client's address.");
  if (recipient.gstin?.trim()) {
    const g = validateGstin(recipient.gstin, recipient.stateCode);
    if (!g.ok) problems.push(`Client GSTIN: ${g.reason}.`);
  }
  if (input.items.length === 0) problems.push("Add at least one line item.");
  input.items.forEach((it, i) => {
    if (!/^\d{4,8}$/.test(it.hsnSac)) problems.push(`Item ${i + 1}: HSN/SAC must be 4–8 digits.`);
    if (!(it.qty > 0) || !(it.rate >= 0)) problems.push(`Item ${i + 1}: quantity and rate must be positive.`);
  });

  function updateItem(i: number, patch: Partial<LineItem>) {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function issue() {
    if (!store || problems.length) return;
    const next: Store = { ...store, seq: store.seq + 1, issued: [input, ...store.issued] };
    saveStore(next);
    setStore(next);
    setFlash(`Issued ${input.number}`);
    setRecipient(blankRecipient());
    setItems([blankItem()]);
    setPosOverride("");
    setNotes("");
  }

  return (
    <div className="editor">
      <form className="panel no-print" onSubmit={(e) => { e.preventDefault(); issue(); }}>
        <h2>New invoice</h2>
        <div className="row">
          <label>Invoice date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Payment terms
            <select value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
              {[0, 7, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d ? `Net ${d}` : "Due on receipt"}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend>Client</legend>
          <label>Name<input aria-label="Client name" value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} /></label>
          <label>Address<input aria-label="Client address" value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} /></label>
          <div className="row">
            <label>State
              <select aria-label="Client state" value={recipient.stateCode} onChange={(e) => setRecipient({ ...recipient, stateCode: e.target.value })}>
                {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            <label>GSTIN (blank if unregistered)
              <input aria-label="Client GSTIN" className="mono" maxLength={15} value={recipient.gstin} onChange={(e) => setRecipient({ ...recipient, gstin: e.target.value.toUpperCase() })} />
            </label>
          </div>
          <label>Place of supply
            <select aria-label="Place of supply" value={posOverride} onChange={(e) => setPosOverride(e.target.value)}>
              <option value="">Same as client state</option>
              {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Items</legend>
          {items.map((it, i) => (
            <div className="item-row" key={i}>
              <input aria-label={`Item ${i + 1} description`} placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
              <input aria-label={`Item ${i + 1} HSN/SAC`} placeholder="HSN/SAC" className="mono" value={it.hsnSac} onChange={(e) => updateItem(i, { hsnSac: e.target.value.trim() })} />
              <input aria-label={`Item ${i + 1} quantity`} type="number" min="0" step="any" value={it.qty} onChange={(e) => updateItem(i, { qty: Number(e.target.value) })} />
              <input aria-label={`Item ${i + 1} unit`} value={it.unit} onChange={(e) => updateItem(i, { unit: e.target.value })} />
              <input aria-label={`Item ${i + 1} rate`} type="number" min="0" step="any" value={it.rate} onChange={(e) => updateItem(i, { rate: Number(e.target.value) })} />
              <select aria-label={`Item ${i + 1} GST rate`} value={it.gstRate} onChange={(e) => updateItem(i, { gstRate: Number(e.target.value) })}>
                {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
              <button type="button" className="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => setItems((xs) => xs.length > 1 ? xs.filter((_, j) => j !== i) : xs)}>✕</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setItems((xs) => [...xs, blankItem()])}>+ Add item</button>
        </fieldset>

        <label>Notes (optional)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bank details, UPI ID…" /></label>

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
            <ul>{store.issued.slice(0, 5).map((x) => <li key={x.number}><span className="mono">{x.number}</span> — {x.recipient.name}</li>)}</ul>
          </div>
        )}
      </form>

      <div className="preview">
        <div className="label no-print">Live preview</div>
        <InvoiceView inv={computed} />
      </div>
    </div>
  );
}
