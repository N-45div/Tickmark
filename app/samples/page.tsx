import Link from "next/link";
import { SAMPLES, US_SAMPLES } from "@/lib/fixtures";

export default function Samples() {
  return (
    <section className="panel">
      <h2>Sample invoices</h2>
      <p className="muted">
        Each sample covers one tax case. Kane CLI opens every one of them in a real browser and checks it
        against the plain-English rulebook for its country (<code>kane/rules/</code>) before any change ships.
      </p>
      <h3>India · GST</h3>
      <ul className="sample-list">
        {Object.entries(SAMPLES).map(([id, s]) => (
          <li key={id}><Link href={`/invoice/sample/${id}`}>{s.invoice.number}</Link> — {s.title}</li>
        ))}
      </ul>
      <h3>United States · sales tax</h3>
      <ul className="sample-list">
        {Object.entries(US_SAMPLES).map(([id, s]) => (
          <li key={id}><Link href={`/invoice/sample/${id}`}>{s.invoice.number}</Link> — {s.title}</li>
        ))}
      </ul>
    </section>
  );
}
