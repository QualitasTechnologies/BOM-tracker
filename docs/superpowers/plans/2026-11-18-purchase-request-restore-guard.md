# Reject saved sends whose receipts disappeared in an earlier backup

A regression after source-only PR74 sends a second fake email when a saved request is replayed after receipt/index loss and provider-key expiry. No repair from PR74 is live yet; Cloud account access remains unavailable and Pulse98 stays unmerged.

The initial request must carry fresh server project/BOM versions. The original dialog transport obtains them through the existing authenticated recover call before saving a new nonce. New reservations compare both raw server versions as well as semantic item data. Retained receipts still resolve using their original payload/hash across changed restore timestamps, while unknown resolve-only requests create cancellation fences. Provider calls remain outside transactions and existing key/window/identity/scope gates remain intact.

- [x] Reproduce duplicate after earlier receipt loss and expired fake provider cache.
- [x] Add first-reservation version guards and preserve confirmed recovery/cancellation.
- [x] Update client preflight and saved journal validation; no layout change.
- [x] Prove actual Firestore delete/recreate timestamps plus stale replay refusal and fresh reviewed intent.
- [ ] Full checks, solo review, exact hosted source; merge follow-up and update Pulse98 before any deployment.
- [ ] Restore authorized Cloud access, capture fresh runtime/Hosting baseline, coordinated function/standalone/Pulse release and verification.

This protects the tested typed-document restore path, not every possible managed Cloud import or whole-system rollback. Full provider/configuration/user/cutover recovery gates remain open. No production write, provider test, user impersonation, flag activation or IAM workaround.
