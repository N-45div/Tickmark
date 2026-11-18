import Link from "next/link";
import { SAMPLES } from "@/lib/fixtures";

export default function Samples() {
  return (
    <section className="panel">
      <h2>Sample invoices</h2>
      <p className="muted">
        Each sample covers one GST case. Kane CLI opens every one of these in a real browser and checks it
        against the plain-English rules in <code>kane/rules.md</code> before any change ships.
      </p>
      <ul className="sample-list">
        {Object.entries(SAMPLES).map(([id, s]) => (
          <li key={id}>
            <Link href={`/invoice/sample/${id}`}>{s.invoice.number}</Link> — {s.title}
          </li>
        ))}
      </ul>
    </section>
  );
}
