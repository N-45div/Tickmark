# Contributing to Tickmark

Thanks for helping make invoices harder to get wrong. The most valuable contribution is a
**rulebook for your country or tax regime**: you know the rules, Kane CLI does the checking.

## Set up

```bash
git clone <this repo> && cd kanehack
npm install
npx playwright install chromium
npm run demo        # 15 s, no account: see a tax bug the unit tests miss, caught
npm test            # unit tests
```

For checks that use Kane CLI (`npm run gate`, `audit`, `prove`, `graduate`) you need a TestMu account
(new accounts get free credits): `npm install -g @testmuai/kane-cli && kane-cli login`.

## Add a rulebook for your country

A rulebook is a Markdown file of numbered, plain-English rules. Kane CLI checks each rule against
what the invoice actually shows, and rules tagged `[math]` are checked in code instead.

1. **Write the rules** in `kane/rules/<name>.md`, e.g. `kane/rules/uk-vat.md`:

   ```markdown
   # United Kingdom: VAT invoice rules

   1. The main heading of the document reads "VAT invoice" or "Tax invoice".
   2. The supplier's VAT registration number is shown.
   3. Every line item shows its VAT rate.
   4. The total VAT equals the sum of each line's VAT to within £0.01. [math]
   ```

   Good rules are **one checkable statement about visible text**:
   - Say exactly what must be on the page: "the heading reads …", "the … number is shown".
   - Prefer literal tests over conditions: "Either the words "Reverse charge" do not appear, or …"
     works better with Kane than "If the supply is reverse charged, …".
   - Tag arithmetic with `[math]`. Kane reads very well and adds up badly; code does the sums.
   - Cite the official source for each rule in your pull request description.

2. **Register it** in `tickmark.config.json` under `rulePacks`.

3. **Add sample invoices** that should pass: a fixture in `lib/fixtures.ts`, rendered at
   `/invoice/sample/<id>`, listed in `tickmark.config.json` under `invoices` with your rulebook.

4. **Check it:** `npm run gate` should pass for your samples. Then plant a realistic mistake (e.g. the
   wrong VAT rate) and make sure Kane catches it. A short note of what you tried helps reviewers.

5. **Optional: graduate a reader** for your invoice layout with `npm run graduate -- --pack <name>`, so
   the math check runs for free (`npm run math`).

Not sure about a rule? Open a "New country rulebook" issue first and discuss it.

## Ground rules

- **Checks, not advice.** Rules describe what an invoice must show; README and reports say "checks",
  never "compliant" or "certified". Link official sources.
- **Small, focused commits** with imperative subject lines ("Add UK VAT rulebook", "Test VAT rounding").
- **Never weaken a rule to get a pass.** If Kane misreads a rule, make it clearer without changing what
  it requires.
- **Security:** documents are shown to a recorded browser. Never add real customer invoices or personal
  data to the repo; use fictional parties like the existing samples.
- Run `npm test` before opening a pull request.
