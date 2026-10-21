# Scoped project reads: source checkpoint

The approved design preserves the original BOM screens and current permissions.
`nativeProjectReads` is a new callable with `get`, `list`, `documents` and
`gallery_invoice` operations. `BOM_SCOPED_READS_ENABLED` must be exactly `true`;
it defaults off independently of every mutation switch. No client uses this
callable yet, and this checkpoint does not restrict legacy SDK reads.

Before deploying the new callable export, provision the server-only secret
`BOM_PROJECT_READ_CURSOR_KEY` as an unpadded base64url encoding of 32 random bytes.
Do not put it in browser configuration, source control or logs. Missing/invalid
keys fail closed. Pagination uses AES-256-GCM with a five-minute lifetime and
binds the current UID, email, role, operation and project. Rotation invalidates
outstanding cursors; clients must restart discovery rather than interpret them.
Pages are navigation through current data, not an immutable snapshot. Documents
can return an empty filtered page with a non-null next cursor.

Every response requires a fresh approved/verified UserRecord, with another check
before publishing. Non-admin discovery queries explicit array membership. For
single-project reads, absent/malformed membership denies, while explicit null
retains the existing legacy access rule. Internal email domains do not bypass
project access. Documents retain the any-visible-link rule; both Documents and
Gallery invoice metadata trim hidden item IDs. Customer POs remain admin-only.
Native download URLs are hydrated from private proofs after authorization.

`supportProfileCommands.cjs` now backs the versioned `support_profile` command in
`nativeProjectOperations`. Its `support_get` opening returns only the safe
profile, actor binding, revision and permissions. The original Support form in
both clients submits explicit scalar/machine deltas. Unknown raw values,
deprecated contacts and historical snapshots remain stored unchanged. Legacy
machine fallback is materialized only by an explicit migration operation.

The paired writer additionally requires `BOM_NATIVE_SUPPORT_PROFILE_ENABLED=true`
plus all three existing project/material write gates. The form uses exact-true
`VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED`, independently of scoped reads. All
defaults remain off. Read-on/edit-off and denied openings cannot reach the legacy
profile replacement helper. That helper also refuses profile replacements when
the paired Support flag is active. Broader root/member/recipient legacy fences
remain a separate migration task.

Failed requests retain their opening revision, nonce and original payload in
UID/project-scoped session storage. Reopening previews those frozen changes;
retry sends that exact command. The confirm-or-cancel action returns an existing
receipt or atomically fences an unsaved nonce. It remains available after write
flags close, without silently rebasing a stale draft. Blocked/corrupt storage and
account/project changes fail visibly, and failed drafts remain available.

`materialReadView` now safely serializes scoped material GET data after scope
selection. It retains safe unknown JSON and converts Date/Timestamp values;
unsupported SDK objects fail with a sanitized integrity error. The older native
project opening also uses the approved safe project view and rechecks identity.
Actual raw-type census and compatible handling of any in-use unsupported values
remain deployment gates; source rejection is not live compatibility acceptance.

Remaining gates include real raw-type and index checks, a review of material
mutation/old-receipt response serialization, all original reader migrations, content-free change notices,
rules and competing-writer fences, real-user/data/history acceptance,
backup/restore and rollback. No runtime switch, deployment, production data or
Firebase policy was changed for this checkpoint.
