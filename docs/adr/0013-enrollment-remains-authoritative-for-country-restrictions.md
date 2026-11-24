# Enrollment remains authoritative when evaluating country restrictions

An Enrollment is not tied to the Purchase that granted it, and a Student can have overlapping Individual Purchases and Claimed Seats. For a Student with an Enrollment, evaluate every surviving Individual Purchase and Claimed Seat independently: any one that passes the country restriction permits lesson use, and a Claimed Seat inherits the country restriction of its Team Licence. If no surviving evidence exists, retain Enrollment-only permission for compatibility; if evidence exists and every record fails the country check, deny permission.

## Considered Options

- **Use the first or newest Purchase:** rejected because it can ignore another qualifying Individual Purchase or Claimed Seat, or use a Purchase whose Refund Request was approved.
- **Attach a Purchase to Enrollment:** rejected because it reintroduces provenance that ADR-0004 deliberately excludes and does not represent overlapping ways to qualify.
- **Require surviving Purchase or Seat evidence for every Enrollment:** rejected to preserve existing Enrollment-only states supported by the enrollment behavior and its tests. This is a compatibility decision, not a new manual-grant feature.

## Consequences

- A Purchase whose Refund Request has been approved no longer qualifies, regardless of whether its Refund is Pending, Issued, or Failed. Open and Declined Refund Requests do not remove qualification. A Team Licence bought for others is not an Individual Purchase for its buyer.
- Enrollment remains required for Student activity. Missing evidence never creates an Enrollment or restores one removed at approval. Existing evidence that all fails the country check must never fall through to the compatibility rule.
- Preserve the existing country calculation for this change: current course price and purchasing-power-pricing setting, current country tiers, and permissive handling of unknown purchase or current country. Do not infer a sale-time discount from incomplete history or add a pricing snapshot.
- These rules govern Student permission to read and use lessons, including recording Watched time, completion, and quiz attempts. Current owning Instructors and Platform Admins retain their separate reading exemption, but their own Student activity requires Enrollment and the same country check. A person who no longer has the Instructor role loses the ownership-based reading exemption.
- Seat-claim rules, Refund Request decisions, and retained Student history remain unchanged. This decision refines ongoing lesson permission without changing the Enrollment model in ADR-0004.
