import { notFound } from "next/navigation";
import { InvoiceView } from "@/components/InvoiceView";
import { SAMPLES } from "@/lib/fixtures";
import { computeInvoice } from "@/lib/gst";

export function generateStaticParams() {
  return Object.keys(SAMPLES).map((id) => ({ id }));
}

export default async function SampleInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sample = SAMPLES[id];
  if (!sample) notFound();
  return <InvoiceView inv={computeInvoice(sample.invoice)} />;
}
