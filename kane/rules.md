# GST invoice rules

Plain-English rules every invoice must pass before it can be issued. Kane CLI
reads the invoice in a real browser and checks each one. They follow the
mandatory contents of a tax invoice under India's CGST Rules, rule 46.
Edit, add or remove rules freely. Each numbered line is checked.

1. The document is titled "Tax Invoice" (capitalisation does not matter).
2. The supplier's name, address and GSTIN are shown.
3. An invoice number is shown. It is at most 16 characters long and uses only letters, digits, "/" and "-".
4. An invoice date and a due date are shown.
5. The recipient ("Bill to") name, address and state are shown, plus either a GSTIN or the word "Unregistered".
6. The place of supply is shown with a state name.
7. For every GSTIN shown, its first two digits equal the state code shown in brackets for that same party.
8. Tax type. First note the two-digit code in brackets after the supplier's "State", and the two-digit code in brackets after "Place of supply". If the two codes are DIFFERENT (inter-state), every tax line must be IGST and no CGST, SGST or UTGST line may appear.
9. If those two codes are the SAME (intra-state), tax must be split into CGST plus SGST (or UTGST for a Union Territory), each at half the item's GST rate, and no IGST line may appear.
10. Every line item shows an HSN/SAC code.
11. The grand total equals the taxable value plus every tax line plus the round off, to within ₹1.
12. The amount in words states the same number of rupees as the grand total.
13. "Reverse charge" is stated, and the invoice ends with an authorised signatory line.
