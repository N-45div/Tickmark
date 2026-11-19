# United States: sales tax invoice rules

Plain-English rules every US invoice must pass before it can be issued. Kane CLI
reads the invoice in a real browser and checks each one. US sales tax is set per
state and is only collected where the seller has nexus, and many services are not
taxable. These rules cover the decisions a small business has to get right.
Edit, add or remove rules freely. Each numbered line is checked.

1. The main heading of the document reads "Invoice", and the document states that amounts are in US dollars (USD).
2. The seller ("From") name and address are shown, and the customer ("Bill to") name, address and state are shown.
3. An invoice number, an issue date and a due date are shown, and the due date is not earlier than the issue date.
4. Every line item shows a description, quantity, rate and amount, and each amount equals quantity times rate to within $0.01.
5. The subtotal equals the sum of all line item amounts to within $0.01.
6. When sales tax is charged, only line items marked taxable are taxed: the tax equals the total of the taxable items times the stated rate, to within $0.01, and non-taxable items are never taxed. This rule is satisfied when no sales tax is charged.
7. When the customer's state is Oregon, Montana, New Hampshire, Delaware or Alaska, the sales tax is $0.00. This rule is satisfied for customers in any other state.
8. Tax exemption: when the invoice explicitly says the customer is tax exempt (for example the words "Tax exempt" or an exemption or resale certificate), it shows the certificate number and the sales tax is $0.00. Zero tax for any other stated reason, such as no nexus or a state with no sales tax, is not a tax exemption, and this rule is then satisfied.
9. When the invoice says the seller does not collect sales tax in the customer's state (no nexus), the sales tax is $0.00. This rule is satisfied when the invoice says no such thing.
10. The total due equals the subtotal plus the sales tax to within $0.01.
