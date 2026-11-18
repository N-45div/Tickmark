# US invoice: sales tax only on taxable items

Go to {{baseUrl}}/?country=us .
Type "Lone Star Coffee Co." in the Customer name field and "1100 Congress Ave, Austin, TX 78701" in the Customer address field.
Select "Texas" in the Customer state dropdown.
Select "Texas" in the "Add nexus state" dropdown, so the seller collects sales tax in Texas.
Set the Sales tax rate field to 8.25.
Type "Brand workshop" in the Item 1 description field and set Item 1 rate to 2400. Leave Item 1 taxable unchecked.
Click "+ Add item". Type "Printed brochures" in the Item 2 description field, set Item 2 quantity to 500, set Item 2 rate to 1.85, and check Item 2 taxable.
Without changing anything else, read the invoice preview on the right: store the subtotal as 'subtotal', the sales tax amount as 'sales_tax' and the total due as 'total_due'.
Assert that subtotal is $3,325.00.
Assert that sales_tax is $76.31 (8.25% of the $925.00 taxable brochures only, not of the whole subtotal).
Assert that total_due is $3,401.31.
Click "Issue invoice" and assert the confirmation "Issued INV-2026-0001" appears.
