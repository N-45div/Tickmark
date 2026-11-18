// GST invoice logic for India. Pure functions, no I/O — easy to unit test,
// and the single source of truth for what the invoice page renders.

export type StateInfo = { code: string; name: string; ut: boolean };

// GST state codes. `ut` = Union Territory *without* its own legislature,
// where the state-level tax is called UTGST instead of SGST.
export const STATES: StateInfo[] = [
  { code: "01", name: "Jammu and Kashmir", ut: false },
  { code: "02", name: "Himachal Pradesh", ut: false },
  { code: "03", name: "Punjab", ut: false },
  { code: "04", name: "Chandigarh", ut: true },
  { code: "05", name: "Uttarakhand", ut: false },
  { code: "06", name: "Haryana", ut: false },
  { code: "07", name: "Delhi", ut: false },
  { code: "08", name: "Rajasthan", ut: false },
  { code: "09", name: "Uttar Pradesh", ut: false },
  { code: "10", name: "Bihar", ut: false },
  { code: "11", name: "Sikkim", ut: false },
  { code: "12", name: "Arunachal Pradesh", ut: false },
  { code: "13", name: "Nagaland", ut: false },
  { code: "14", name: "Manipur", ut: false },
  { code: "15", name: "Mizoram", ut: false },
  { code: "16", name: "Tripura", ut: false },
  { code: "17", name: "Meghalaya", ut: false },
  { code: "18", name: "Assam", ut: false },
  { code: "19", name: "West Bengal", ut: false },
  { code: "20", name: "Jharkhand", ut: false },
  { code: "21", name: "Odisha", ut: false },
  { code: "22", name: "Chhattisgarh", ut: false },
  { code: "23", name: "Madhya Pradesh", ut: false },
  { code: "24", name: "Gujarat", ut: false },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", ut: true },
  { code: "27", name: "Maharashtra", ut: false },
  { code: "29", name: "Karnataka", ut: false },
  { code: "30", name: "Goa", ut: false },
  { code: "31", name: "Lakshadweep", ut: true },
  { code: "32", name: "Kerala", ut: false },
  { code: "33", name: "Tamil Nadu", ut: false },
  { code: "34", name: "Puducherry", ut: false },
  { code: "35", name: "Andaman and Nicobar Islands", ut: true },
  { code: "36", name: "Telangana", ut: false },
  { code: "37", name: "Andhra Pradesh", ut: false },
  { code: "38", name: "Ladakh", ut: true },
];

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export function stateByCode(code: string): StateInfo | undefined {
  return STATES.find((s) => s.code === code);
}

// ---------------------------------------------------------------- GSTIN

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Check character for the first 14 characters of a GSTIN (mod-36 Luhn variant). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export type GstinCheck = { ok: true; stateCode: string } | { ok: false; reason: string };

export function validateGstin(raw: string, expectedStateCode?: string): GstinCheck {
  const gstin = raw.trim().toUpperCase();
  if (gstin.length !== 15) return { ok: false, reason: "GSTIN must be 15 characters" };
  if (!GSTIN_SHAPE.test(gstin)) return { ok: false, reason: "GSTIN format is invalid" };
  const stateCode = gstin.slice(0, 2);
  if (!stateByCode(stateCode)) return { ok: false, reason: `Unknown state code ${stateCode}` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14])
    return { ok: false, reason: "GSTIN checksum does not match" };
  if (expectedStateCode && stateCode !== expectedStateCode) {
    const st = stateByCode(expectedStateCode)?.name ?? expectedStateCode;
    return { ok: false, reason: `GSTIN state code ${stateCode} does not match ${st} (${expectedStateCode})` };
  }
  return { ok: true, stateCode };
}

// ---------------------------------------------------------------- Invoice

export type Party = {
  name: string;
  address: string;
  stateCode: string;
  gstin?: string; // optional for unregistered (B2C) recipients
};

export type LineItem = {
  description: string;
  hsnSac: string;
  qty: number;
  unit: string;
  rate: number; // per unit, excluding GST
  gstRate: number; // percent
};

export type InvoiceInput = {
  number: string;
  date: string; // YYYY-MM-DD
  paymentTermsDays: number;
  supplier: Party;
  recipient: Party;
  placeOfSupplyCode: string;
  reverseCharge: boolean;
  items: LineItem[];
  notes?: string;
};

export type TaxKind = "IGST" | "CGST" | "SGST" | "UTGST";
export type TaxLine = { kind: TaxKind; rate: number; amount: number };

export type ComputedItem = LineItem & { taxable: number; taxes: TaxLine[] };

export type ComputedInvoice = {
  input: InvoiceInput;
  interState: boolean;
  dueDate: string;
  items: ComputedItem[];
  taxableTotal: number;
  taxSummary: TaxLine[]; // aggregated by kind + rate
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Supply is inter-state when the supplier's state differs from the place of supply. */
export function isInterState(supplierStateCode: string, placeOfSupplyCode: string): boolean {
  return supplierStateCode !== placeOfSupplyCode;
}

export function taxesFor(taxable: number, gstRate: number, interState: boolean, posCode: string): TaxLine[] {
  if (interState) return [{ kind: "IGST", rate: gstRate, amount: round2((taxable * gstRate) / 100) }];
  const half = gstRate / 2;
  const each = round2((taxable * half) / 100);
  const stateKind: TaxKind = stateByCode(posCode)?.ut ? "UTGST" : "SGST";
  return [
    { kind: "CGST", rate: half, amount: each },
    { kind: stateKind, rate: half, amount: each },
  ];
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeInvoice(input: InvoiceInput): ComputedInvoice {
  const interState = isInterState(input.supplier.stateCode, input.placeOfSupplyCode);
  const items: ComputedItem[] = input.items.map((it) => {
    const taxable = round2(it.qty * it.rate);
    return { ...it, taxable, taxes: taxesFor(taxable, it.gstRate, interState, input.placeOfSupplyCode) };
  });

  const summary = new Map<string, TaxLine>();
  for (const it of items)
    for (const t of it.taxes) {
      const key = `${t.kind}@${t.rate}`;
      const prev = summary.get(key);
      summary.set(key, { ...t, amount: round2((prev?.amount ?? 0) + t.amount) });
    }

  const taxableTotal = round2(items.reduce((s, it) => s + it.taxable, 0));
  const taxSummary = [...summary.values()];
  const taxTotal = round2(taxSummary.reduce((s, t) => s + t.amount, 0));
  const exact = round2(taxableTotal + taxTotal);
  const grandTotal = Math.round(exact);
  const roundOff = round2(grandTotal - exact);

  return {
    input,
    interState,
    dueDate: addDays(input.date, input.paymentTermsDays),
    items,
    taxableTotal,
    taxSummary,
    taxTotal,
    roundOff,
    grandTotal,
    amountInWords: rupeesInWords(grandTotal),
  };
}

// ---------------------------------------------------------------- Formatting

export function formatINR(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** DD-MM-YYYY, the format most Indian invoices use. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? ONES[h] + " Hundred" : "", rest ? twoDigits(rest) : ""].filter(Boolean).join(" ");
}

/** Whole-rupee amount in words using the Indian system (lakh, crore). */
export function rupeesInWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return "Indian Rupees Zero Only";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts = [
    crore ? `${crore >= 100 ? rupeesInWords(crore).replace(/^Indian Rupees | Only$/g, "") : twoDigits(crore)} Crore` : "",
    lakh ? `${twoDigits(lakh)} Lakh` : "",
    thousand ? `${twoDigits(thousand)} Thousand` : "",
    n ? threeDigits(n) : "",
  ].filter(Boolean);
  return `Indian Rupees ${parts.join(" ")} Only`;
}

// ---------------------------------------------------------------- Numbering

/** Indian financial year label for a date, e.g. 2026-11-18 → "26-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** Rule 46(b): consecutive serial number, ≤16 chars, only letters, digits, '-' and '/'. */
export function invoiceNumber(isoDate: string, seq: number, prefix = "INV"): string {
  return `${prefix}/${financialYear(isoDate)}/${String(seq).padStart(4, "0")}`;
}

export function validInvoiceNumber(n: string): boolean {
  return n.length > 0 && n.length <= 16 && /^[A-Za-z0-9/-]+$/.test(n);
}
