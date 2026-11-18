"use client";

import { useEffect, useState } from "react";
import { IndiaEditor } from "@/components/IndiaEditor";
import { UsEditor } from "@/components/UsEditor";

type Country = "in" | "us";
const KEY = "invoiceguard:country";

export default function Home() {
  const [country, setCountry] = useState<Country>("in");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("country");
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    const c = fromUrl ?? saved;
    if (c === "us" || c === "in") setCountry(c);
  }, []);

  function choose(c: Country) {
    setCountry(c);
    try { localStorage.setItem(KEY, c); } catch {}
  }

  const switcher = (
    <div className="country-switch" role="group" aria-label="Country">
      <button type="button" aria-pressed={country === "in"} onClick={() => choose("in")}>🇮🇳 India · GST</button>
      <button type="button" aria-pressed={country === "us"} onClick={() => choose("us")}>🇺🇸 United States · Sales tax</button>
    </div>
  );

  return country === "us" ? <UsEditor switcher={switcher} /> : <IndiaEditor switcher={switcher} />;
}
