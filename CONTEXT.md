# Capture domain language

- **Profile identity:** The display name and photo that the person adds. Capture never infers either value.
- **Profile reading:** Capture derives the current recurring threads from the record. It can regenerate this reading.
- **Landed point:** This mark states that Capture formed the profile reading from a record. It does not verify identity.
- **Cloud access:** Current permission to use Capture Cloud, supplied by either a current paid entitlement or a current complimentary grant.
- **Complimentary grant:** Service-managed Cloud access for one authenticated owner UUID. It is independent of billing and is not a subscription.
- **Capture identity:** The stable `captureId` shared by every ledger row produced from one intake. Exactly one new row is explicitly primary; Undo, recent context, and series continuity use that row rather than array order.
- **Semantic share:** One complete, non-overlapping span of a capture owned by a thinking destination or action. Unsafe decompositions are kept pending rather than partially filed.
- **Correction example:** A bounded, explicit user choice stored under a stable correction-ledger key. It is advisory model context, visible and individually disableable; it is never an executable keyword rule.
