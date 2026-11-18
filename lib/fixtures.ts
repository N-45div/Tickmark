// Sample invoices covering the GST cases Kane verifies on every change.
// Rendered at /invoice/sample/<id>. All names are fictional; GSTINs are
// generated with valid checksums so the "GSTIN is valid" rule is meaningful.
import { gstinCheckChar, type InvoiceInput, type Party } from "./gst";

const gstin = (first14: string) => first14 + gstinCheckChar(first14);

export const SUPPLIER: Party = {
  name: "Pixel & Paper Studio",
  address: "42, 3rd Cross, Indiranagar, Bengaluru 560038",
  stateCode: "29",
  gstin: gstin("29AAKFP4821L1Z"),
};

const acme: Party = {
  name: "Acme Retail Pvt Ltd",
  address: "Unit 7, Kamala Mills, Lower Parel, Mumbai 400013",
  stateCode: "27",
  gstin: gstin("27AABCA5532K1Z"),
};

const nimbus: Party = {
  name: "Nimbus Labs Pvt Ltd",
  address: "88, HSR Layout Sector 2, Bengaluru 560102",
  stateCode: "29",
  gstin: gstin("29AAHCN7710Q1Z"),
};

const sector17: Party = {
  name: "Sector 17 Cafe LLP",
  address: "SCO 12, Sector 17-C, Chandigarh 160017",
  stateCode: "04",
  gstin: gstin("04AADFS2290M1Z"),
};

const riya: Party = {
  name: "Riya Sharma",
  address: "Flat 302, Koregaon Park, Pune 411001",
  stateCode: "27",
};

const base = { date: "2026-11-18", paymentTermsDays: 30, supplier: SUPPLIER, reverseCharge: false };

export const SAMPLES: Record<string, { title: string; invoice: InvoiceInput }> = {
  "intra-state": {
    title: "Same state (Karnataka → Karnataka): CGST + SGST",
    invoice: {
      ...base,
      number: "INV/26-27/0001",
      recipient: nimbus,
      placeOfSupplyCode: "29",
      items: [
        { description: "Landing page design", hsnSac: "998314", qty: 1, unit: "job", rate: 45000, gstRate: 18 },
        { description: "Logo refresh", hsnSac: "998391", qty: 1, unit: "job", rate: 12500, gstRate: 18 },
      ],
    },
  },
  "inter-state": {
    title: "Different states (Karnataka → Maharashtra): IGST",
    invoice: {
      ...base,
      number: "INV/26-27/0002",
      recipient: acme,
      placeOfSupplyCode: "27",
      items: [
        { description: "Web design", hsnSac: "998314", qty: 10, unit: "hrs", rate: 2000, gstRate: 18 },
        { description: "Hosting setup", hsnSac: "998315", qty: 1, unit: "job", rate: 5000, gstRate: 18 },
      ],
    },
  },
  "union-territory": {
    title: "Recipient in a Union Territory (Chandigarh): IGST, inter-state",
    invoice: {
      ...base,
      number: "INV/26-27/0003",
      paymentTermsDays: 15,
      recipient: sector17,
      placeOfSupplyCode: "04",
      items: [
        { description: "Menu & signage design", hsnSac: "998391", qty: 1, unit: "job", rate: 18000, gstRate: 18 },
        { description: "Printed menus", hsnSac: "4911", qty: 40, unit: "pcs", rate: 85.5, gstRate: 12 },
      ],
    },
  },
  "unregistered-buyer": {
    title: "Unregistered consumer (B2C) in Maharashtra, mixed rates",
    invoice: {
      ...base,
      number: "INV/26-27/0004",
      paymentTermsDays: 0,
      recipient: riya,
      placeOfSupplyCode: "27",
      items: [
        { description: "Wedding invitation design", hsnSac: "998391", qty: 1, unit: "job", rate: 7999, gstRate: 18 },
        { description: "Printed invitation cards", hsnSac: "4909", qty: 150, unit: "pcs", rate: 23.75, gstRate: 12 },
      ],
    },
  },
};
