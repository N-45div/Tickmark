# Invoice matches its contract

Checks that an invoice bills exactly what was agreed in the contract it is issued under.
Kane CLI reads the contract first, then the invoice, in a real browser. Each numbered
line is checked.

1. The invoice is addressed to the contract's client, using the client's legal name as written in the contract.
2. Every rate or fee billed on the invoice equals the rate or fee agreed in the contract (same amount, same currency, same unit such as per hour or per month).
3. The invoice's payment terms are the same as the contract's payment terms, and the due date equals the invoice date plus those terms.
4. The invoice date falls within the contract's term (on or after its effective date, and before it ends if an end date is given).
5. The invoice is in the same currency as the contract.
