# India: GST invoice rules

Plain-English rules every invoice must pass before it can be issued. Kane CLI
reads the invoice in a real browser and checks each one. They follow the
mandatory contents of a tax invoice under India's CGST Rules, rule 46.
Edit, add or remove rules freely. Each numbered line is checked. Rules tagged [math] are
arithmetic: Tickmark counts them in code (from what Kane reads) instead of asking Kane to.

1. The main heading of the document reads "Tax Invoice".
2. The supplier's name, address and GSTIN are shown.
3. An invoice number is shown. It is at most 16 characters long and uses only letters, digits, "/" and "-".
4. An invoice date and a due date are shown.
5. The recipient ("Bill to") name, address and state are shown, plus either a GSTIN or the word "Unregistered".
6. The place of supply is shown with a state name.
7. For every GSTIN shown, its first two digits are the GST state code of that same party's state (for example 29 for Karnataka, 27 for Maharashtra, 04 for Chandigarh).
8. Tax type. First note the supplier's state and the place of supply state, by name or by the two-digit code in brackets when one is shown. If they are DIFFERENT states (inter-state), every tax line must be IGST and no CGST, SGST or UTGST line may appear. This rule is satisfied when the two states are the same.
9. If those two states are the SAME (intra-state), tax must be split into CGST plus SGST (or UTGST for a Union Territory), each at half the item's GST rate, and no IGST line may appear. This rule is satisfied when the two states are different.
10. Every line item shows an HSN/SAC code.
11. The grand total equals the taxable value plus every tax line plus the round off, to within ₹1.
12. The amount in words states the same number of rupees as the grand total.
13. "Reverse charge" is stated, and the invoice ends with an authorised signatory line.
14. If the invoice gives a payment period in days (for example "Net 30" beside the due date, or "payment due within 7 days" in the terms or notes), the due date shown is exactly that many days after the invoice date. This rule is satisfied when no payment period in days is stated. [math]
