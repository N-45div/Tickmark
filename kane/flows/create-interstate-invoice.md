# Create an inter-state invoice from the editor

Go to {{baseUrl}}/ .
Type "Acme Retail Pvt Ltd" in the Client name field and "Lower Parel, Mumbai" in the Client address field.
Select "Maharashtra" in the Client state dropdown.
Do not touch the "Place of supply" dropdown in the form: leave it on "Same as client state", because the default is what is being tested.
Type "Web design" in the Item 1 description field, "998314" in the Item 1 HSN/SAC field, set Item 1 quantity to 10 and Item 1 rate to 2000.
Without changing anything else, read the invoice preview on the right: store the value shown next to its "Place of supply" label (not the client's "State:" line) as 'place_of_supply'.
In the totals table of the invoice preview, store the label of every tax row (the rows between "Taxable value" and "Round off") as 'tax_rows'.
Store the grand total shown in the invoice preview as 'grand_total'.
Assert that place_of_supply is exactly "Maharashtra (27)".
Assert that tax_rows contains exactly one row, "IGST @ 18%", and contains no row that mentions CGST or SGST.
Assert that grand_total is ₹23,600.00.
Click "Issue invoice" and assert the confirmation "Issued INV/26-27/0001" appears.
