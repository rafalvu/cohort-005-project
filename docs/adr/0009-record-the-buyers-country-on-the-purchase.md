# Record the buyer's country on the purchase, at the moment of sale

Record the buyer's resolved country on the Purchase at the moment of sale. Purchasing-power access checks compare that historical country with the Student's current country, so a discounted Purchase can be blocked when the Student travels. Keeping this restriction means accepting that travel can interrupt access in exchange for limiting use of country-specific discounts outside the country of purchase.

Using only the current country would lose the sale-time reference needed for that comparison. The snapshot adds historical data we must preserve, but a country we did not record at purchase time cannot reliably be reconstructed later.

## Consequences

- Country resolution can fail, so the snapshot may be missing. Access is not blocked when either the purchase country or the current country is unknown.
- Platform Admins and the course's Instructor bypass the check. Free courses, courses with purchasing-power pricing disabled, and Purchases whose recorded country is currently in the full-price tier also bypass it.
- The country is a snapshot; the pricing configuration is not. Access checks use the current course settings and country-to-tier mapping.
- The amount paid is recorded separately. Refunds return that amount; they do not recalculate it from either country.
