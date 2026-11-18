import { notFound } from "next/navigation";
import { InvoiceView } from "@/components/InvoiceView";
import { UsInvoiceView } from "@/components/UsInvoiceView";
import { SAMPLES, US_SAMPLES } from "@/lib/fixtures";
import { computeInvoice } from "@/lib/gst";
import { computeUsInvoice } from "@/lib/us";

export function generateStaticParams() {
  return [...Object.keys(SAMPLES), ...Object.keys(US_SAMPLES)].map((id) => ({ id }));
}

export default async function SampleInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (SAMPLES[id]) return <InvoiceView inv={computeInvoice(SAMPLES[id].invoice)} />;
  if (US_SAMPLES[id]) return <UsInvoiceView inv={computeUsInvoice(US_SAMPLES[id].invoice)} />;
  notFound();
}
