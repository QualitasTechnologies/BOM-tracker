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

`supportProfileCommands.cjs` is a separate pure merge helper, not an enabled
writer. It retains unknown raw values, uses explicit scalar/machine changes and
preserves deprecated contacts. Transactional authorization/revisions/audit,
receipt recovery, legacy-machine migration and the original form pairing still
need integration before projected Support reads can replace existing reads.

Remaining gates include safe material/category serialization, real raw-type and
index checks, all original reader migrations, content-free change notices,
rules and competing-writer fences, real-user/data/history acceptance,
backup/restore and rollback. No runtime switch, deployment, production data or
Firebase policy was changed for this checkpoint.
