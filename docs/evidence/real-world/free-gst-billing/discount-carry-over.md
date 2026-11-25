# A whole-bill discount on one client's invoice must not carry over to the next client's, even after reopening the app

Go to {{baseUrl}}/ .
Click "New Invoice" in the sidebar. Under "This invoice is for", click "Services".
Type "First Client" in the client name field and press Escape. Click "More client details", type "1 Test Road" in the street address field, "Mumbai" in the city field, choose "Maharashtra" as the state and type "400013" as the PIN code.
In the first line item, type "Consulting" as the item, "998311" as the SAC, and 10000 as the rate.
Click "+ Discount on the whole bill" and type 500 in the discount amount box.
Click "Save" and wait until the invoice is saved.
Now close and reopen the app, as a user would the next morning: go to {{baseUrl}}/ again and wait for the dashboard to load.
Start a second, separate invoice for a different client: click "New Invoice" in the sidebar and click "Services".
Type "Second Client" in the client name field and press Escape. Click "More client details", type "2 Test Road" in the street address field, "Pune" in the city field, choose "Maharashtra" as the state and type "411001" as the PIN code.
In the first line item, type "Consulting" as the item, "998311" as the SAC, and 10000 as the rate. Do not type any discount on this second invoice.
Read the live invoice preview of this second invoice: store every row label of its totals section (between "Subtotal" and "Total Due") as 'total_rows', and store its "Total Due" amount as 'total_due'.
Assert that total_rows contains no row that mentions a discount.
Assert that total_due is ₹11,800.00 (₹10,000 plus 18% IGST, with no discount, because no discount was given to the second client).
