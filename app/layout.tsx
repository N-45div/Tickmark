import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "InvoiceGuard",
  description: "GST invoices that can't go out wrong, verified in a real browser by Kane CLI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <nav className="topnav no-print">
          <Link href="/" className="brand">InvoiceGuard</Link>
          <Link href="/">New invoice</Link>
          <Link href="/samples">Samples</Link>
          <span className="badge">Verified with Kane CLI</span>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
