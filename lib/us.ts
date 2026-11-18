// US sales tax invoice logic. Pure functions, mirrors lib/gst.ts.
//
// The US has no federal VAT. Sales tax is set by each state (plus local add-ons),
// and a seller only collects it where they have "nexus". Many services are not
// taxable while physical goods usually are. We model the decisions a small
// business actually has to get right on each invoice:
//   1. Do I collect in the customer's state at all? (nexus, no-sales-tax states)
//   2. Is the customer exempt? (resale / exemption certificate)
//   3. Which lines are taxable? Tax only those.

export type UsState = { code: string; name: string; baseRate: number };

// Statewide base sales tax rates (percent). Local rates often add more, so the
// editor lets the user enter their combined rate. Five states levy none.
export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama", baseRate: 4 }, { code: "AK", name: "Alaska", baseRate: 0 },
  { code: "AZ", name: "Arizona", baseRate: 5.6 }, { code: "AR", name: "Arkansas", baseRate: 6.5 },
  { code: "CA", name: "California", baseRate: 7.25 }, { code: "CO", name: "Colorado", baseRate: 2.9 },
  { code: "CT", name: "Connecticut", baseRate: 6.35 }, { code: "DE", name: "Delaware", baseRate: 0 },
  { code: "DC", name: "District of Columbia", baseRate: 6 }, { code: "FL", name: "Florida", baseRate: 6 },
  { code: "GA", name: "Georgia", baseRate: 4 }, { code: "HI", name: "Hawaii", baseRate: 4 },
  { code: "ID", name: "Idaho", baseRate: 6 }, { code: "IL", name: "Illinois", baseRate: 6.25 },
  { code: "IN", name: "Indiana", baseRate: 7 }, { code: "IA", name: "Iowa", baseRate: 6 },
  { code: "KS", name: "Kansas", baseRate: 6.5 }, { code: "KY", name: "Kentucky", baseRate: 6 },
  { code: "LA", name: "Louisiana", baseRate: 5 }, { code: "ME", name: "Maine", baseRate: 5.5 },
  { code: "MD", name: "Maryland", baseRate: 6 }, { code: "MA", name: "Massachusetts", baseRate: 6.25 },
  { code: "MI", name: "Michigan", baseRate: 6 }, { code: "MN", name: "Minnesota", baseRate: 6.875 },
  { code: "MS", name: "Mississippi", baseRate: 7 }, { code: "MO", name: "Missouri", baseRate: 4.225 },
  { code: "MT", name: "Montana", baseRate: 0 }, { code: "NE", name: "Nebraska", baseRate: 5.5 },
  { code: "NV", name: "Nevada", baseRate: 6.85 }, { code: "NH", name: "New Hampshire", baseRate: 0 },
  { code: "NJ", name: "New Jersey", baseRate: 6.625 }, { code: "NM", name: "New Mexico", baseRate: 4.875 },
  { code: "NY", name: "New York", baseRate: 4 }, { code: "NC", name: "North Carolina", baseRate: 4.75 },
  { code: "ND", name: "North Dakota", baseRate: 5 }, { code: "OH", name: "Ohio", baseRate: 5.75 },
  { code: "OK", name: "Oklahoma", baseRate: 4.5 }, { code: "OR", name: "Oregon", baseRate: 0 },
  { code: "PA", name: "Pennsylvania", baseRate: 6 }, { code: "RI", name: "Rhode Island", baseRate: 7 },
  { code: "SC", name: "South Carolina", baseRate: 6 }, { code: "SD", name: "South Dakota", baseRate: 4.2 },
  { code: "TN", name: "Tennessee", baseRate: 7 }, { code: "TX", name: "Texas", baseRate: 6.25 },
  { code: "UT", name: "Utah", baseRate: 4.85 }, { code: "VT", name: "Vermont", baseRate: 6 },
  { code: "VA", name: "Virginia", baseRate: 5.3 }, { code: "WA", name: "Washington", baseRate: 6.5 },
  { code: "WV", name: "West Virginia", baseRate: 6 }, { code: "WI", name: "Wisconsin", baseRate: 5 },
  { code: "WY", name: "Wyoming", baseRate: 4 },
];

/** States with no statewide sales tax. */
export const NO_SALES_TAX = ["AK", "DE", "MT", "NH", "OR"];

export const usState = (code: string) => US_STATES.find((s) => s.code === code);

export type UsParty = { name: string; address: string; state: string };

export type UsLineItem = {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  taxable: boolean;
};

export type UsInvoiceInput = {
  number: string;
  date: string; // YYYY-MM-DD
  paymentTermsDays: number;
  seller: UsParty;
  nexusStates: string[]; // states where the seller collects sales tax
  customer: UsParty;
  exemptCertificate?: string; // resale / exemption certificate number
  taxRate: number; // combined rate for the customer's location, percent
  items: UsLineItem[];
  notes?: string;
};

export type UsTaxDecision =
  | { collect: true; label: string }
  | { collect: false; reason: string };

export type ComputedUsInvoice = {
  input: UsInvoiceInput;
  dueDate: string;
  items: (UsLineItem & { amount: number })[];
  subtotal: number;
  taxableAmount: number;
  decision: UsTaxDecision;
  tax: number;
  total: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Should this invoice carry sales tax, and why (not)? Destination-based. */
export function taxDecision(input: UsInvoiceInput): UsTaxDecision {
  const st = usState(input.customer.state);
  const name = st?.name ?? input.customer.state;
  if (NO_SALES_TAX.includes(input.customer.state))
    return { collect: false, reason: `No sales tax: ${name} has no statewide sales tax` };
  if (!input.nexusStates.includes(input.customer.state))
    return { collect: false, reason: `Sales tax not collected: seller has no nexus in ${name}` };
  if (input.exemptCertificate?.trim())
    return { collect: false, reason: `Tax exempt: exemption certificate ${input.exemptCertificate.trim()}` };
  return { collect: true, label: `Sales tax (${name}, ${input.taxRate}%) on taxable items` };
}

export function computeUsInvoice(input: UsInvoiceInput): ComputedUsInvoice {
  const items = input.items.map((it) => ({ ...it, amount: round2(it.qty * it.rate) }));
  const subtotal = round2(items.reduce((s, it) => s + it.amount, 0));
  const taxableAmount = round2(items.filter((it) => it.taxable).reduce((s, it) => s + it.amount, 0));
  const decision = taxDecision(input);
  const tax = decision.collect ? round2((taxableAmount * input.taxRate) / 100) : 0;
  return {
    input, items, subtotal, taxableAmount, decision, tax,
    dueDate: addDays(input.date, input.paymentTermsDays),
    total: round2(subtotal + tax),
  };
}

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** MM/DD/YYYY, the usual US format. */
export function formatUsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function usInvoiceNumber(isoDate: string, seq: number): string {
  return `INV-${isoDate.slice(0, 4)}-${String(seq).padStart(4, "0")}`;
}
