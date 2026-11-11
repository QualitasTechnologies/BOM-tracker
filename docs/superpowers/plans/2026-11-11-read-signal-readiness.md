# Publish the approved content-free update notices

Continue the user-approved scoped-read design using the original screens, solo. Do not activate business-write fences or email owners.

The live Firestore release uses ruleset `0ae08a30-af58-403e-9457-96988ed71774`, canonical SHA256 `58bd2d80afa51cf4a3f8849ae72ae2b50652b4855298b6162a02e69710dc9a50`. Its bytes equal the existing `firestore.legacy-po.rules` after newline normalization. It has none of the three notice matches. Deploying the complete latest Rules would introduce unrelated business-write changes; use an additive candidate against this exact live baseline.

- [x] Build a deterministic candidate from the pinned baseline plus only the three already-approved notice matches. Prove removing the marked addition restores the exact baseline; fail closed on drift.
- [x] Run the real SDK notice access/write-denial matrix against the candidate, plus existing business-rule preservation checks. Keep normal full-source and historical Rules tests separate.
- [ ] Merge exact passing source/config/test heads. Preserve the prior active ruleset and all existing runtime settings in protected recovery storage.
- [ ] Publish only the narrow Rules addition and the five exact notice services. Keep provider and business-write gates untouched. Verify the deployed artifact, trigger paths, no feedback loops, and before/after service census.
- [ ] Validate actual authorized notice-driven rereads without changing a business project, sending mail, uploading files or minting identities. Distinguish that from a naturally delivered production Firestore event, which remains unproven until observed.

This stage is automatic-read-update readiness. Full workflow/live-write and user acceptance, history/files/money reconciliation, measured coexistence, read-only and shutdown/restore are still required for BOM retirement.
