# Confirmed BOM to Pulse project links (operator maintenance)

`scripts/linkConfirmedPulseProjects.cjs` sets `pulseProjectId` on exactly four BOM projects the user explicitly confirmed:

| BOM project | Pulse project id |
| --- | --- |
| PRJ-015 | 1910 |
| PRJ-017 | 2069 |
| PRJ-016 | 1864 |
| PRJ-012 | 1823 |

PRJ-013 (Ferrari) has no identified counterpart and is excluded. The pairs are hardcoded; the CLI and the manifest cannot add,
change or reorder them. This is a one-off tool, not a product feature, and it is not the native project command path. That path
needs a real Firebase user session and its three global flags stay closed. Do not open them for these links.

## Provenance (read this before trusting an audit record)

The actor is the operator's Google credential, proven in memory by token info (`OAuth2Client.getTokenInfo` on the
Application Default Credentials access token). The token info must report `email_verified` as `true` (boolean or the string
`"true"`); a missing or false value is not proven. Receipts record `actorKind: "google-credential"`, the credential email and
subject, the operator label, and `firebaseUid: null`. They are **not** Firebase user actions. The token is never stored,
printed or logged. Failures are reported as short codes only.

## What a successful apply changes

One Firestore transaction, all or nothing:

- the four `projects/<id>.pulseProjectId` fields, and nothing else. Each update carries a `lastUpdateTime` precondition. `updatedAt`,
  members, status, costs, emails and time entries are untouched;
- one create-only run receipt, `pulseConfirmedProjectLinkRuns/<manifestSha256>`;
- four create-only audit records, `pulseConfirmedProjectLinkRuns/<manifestSha256>/audit/<bomId>`.

The receipt holds the before presence and value, the intended after value, the project version before, the manifest hash, the SQL
snapshot hash, the human-confirmation reference, the operator and credential identity, the pre-image hash, and
`appliedAt = serverTimestamp()`. **`appliedAt` is audit time only.** It is a request time with its own (millisecond) precision and is
not the document version; a real receipt showed different nanoseconds from its document `updateTime`. The **after-version** is the
receipt *document snapshot's* `updateTime` (server metadata, not receipt data). The four project documents are changed in the same
atomic commit, so their `updateTime` is expected to equal it right after the apply. Post-commit verification checks this, and
the emulator test exercises it. Anything that cannot read that metadata fails closed with `receipt_metadata_missing`.

## Procedure

1. **SQL existence input (operator, read-only, outside this tool).** Save a file that the tool pins by SHA-256:
   `{"schema":"bom-confirmed-pulse-sql-existence-v1","capturedAt":"<ISO UTC>","rows":[{"id":1910,"exists":true},{"id":2069,"exists":true},{"id":1864,"exists":true},{"id":1823,"exists":true}]}`.
   It must contain exactly those four ids and no other keys or names. It must be no older than 15 minutes (inclusive) when the manifest is planned, verified or applied. The tool only records
   it (`trust: operator-supplied-unverified`) and never queries SQL.
2. **Plan (read-only).**
   `node scripts/linkConfirmedPulseProjects.cjs --project=<firebase-project> --sql-snapshot=<file> --manifest-out=<absolute path outside Git>`.
   This needs ADC. It reads the four projects (path identity, `updateTime`, pulse field presence and value), the
   `pulseRuntimeControl/cutover` mode (must be `coexist`; an absent control doc or mode counts as `coexist`, as in the runtime),
   number and string collision queries for all four targets, and a masked scan of every project. It refuses on any blocker,
   including an archived or malformed project, any existing link that is not absent or `null`, or a link already equal to its
   target without a receipt. It emits a sealed manifest and writes nothing to Firebase.
3. **Review** the manifest. Keep the manifest and the SQL input; never regenerate them to resume a run.
4. **Verify (read-only).** `... --manifest=<file> --expected-manifest-sha=<sha>` re-checks live state against the manifest, or
   verifies a completed run.
5. **Apply.** Unset `FIRESTORE_EMULATOR_HOST`, then run
   `... --apply --manifest=<file> --expected-manifest-sha=<sha> --operator=<label> --preimage-dir=<absolute durable dir outside Git>`.
   The tool refuses unless the credential principal and subject equal the sealed manifest's, the token has at least 2 minutes of
   life, the manifest is no more than 15 minutes old, and every project's `updateTime` and identity still match. It writes the field
   pre-image file (create-exclusive, fsynced, hash-verified) **before** the transaction. If that file cannot be written, nothing is
   written to Firestore.
6. **Replay.** Re-running the same manifest after success writes nothing and no pre-image. It proves the receipt, the four audit
   records and all four links (later unrelated edits to a project do not invalidate a link that is still correct; they are listed as
   `modifiedSinceApply`), or reports `receipt_conflict` or `receipt_link_diverged`. If the commit acknowledgement is lost
   (`transaction_failed`), re-run the same command. The replay result is the truth.

## Fail-closed conditions

The run stops with no Firestore write on any of these:

- manifest hash, schema, age, or project mismatch;
- principal unproven, expired or different;
- operator label invalid;
- backup unavailable;
- a project missing, archived or malformed, or its identity or version changed;
- any number or string collision, including archived holders;
- the control mode not `coexist`;
- any existing receipt or audit record that does not exactly match the manifest.

A link set by an old client without our receipt is never reported as applied.

## Recovery (field-level only)

There is no rollback command. `evaluateRecovery({bomId, receipt, preimage, project})` is a pure decision helper. It returns
`allowed` only if the receipt and the pre-image file hash match, the project's current value still equals the value this run wrote,
**and** the project's current `updateTime` equals the receipt snapshot's `updateTime` (passed in as `receiptSnapshot`; there is no
version field in receipt data to forge, and a missing snapshot or `updateTime` gives `receipt_metadata_missing`). Then it names the single action: `delete_field` if the
field was absent before, `set_null` if it was an explicit `null`. Restoring means a reviewed manual transaction that changes only
`pulseProjectId` on that one project, guarded by the same value and version, and records its own attributable record.

If a later user edit moved the version or changed the value, leave the project untouched and report it. Do not restore whole
documents or databases. The pre-image is deliberately field-level, and a pre-image without a receipt proves no write happened.

## Limits

- **No global uniqueness lock.** The collision queries and scan run inside the transaction, but this tool does not claim that
  Firestore blocks a concurrent writer from adding a NEW matching value (the in-memory test double does model this; real Firestore
  behaviour was not exercised). A legacy client, or any other writer unaware of this tool, can assign a target id to a different
  project during or after the run. The tool re-scans after the commit and reports `post_verification_failed` with `committed: true`. It cannot
  prevent that.
- **SQL existence is an unverified, point-in-time input** and is outside the Firestore transaction. A Pulse row could change after
  the snapshot. Nothing here reserves or verifies the row, and no SQL or time-entry history is changed or copied.
- **The old `EditProjectDialog` can clear the link** from a stale form. This tool does not change that; re-verify after other users
  have edited the projects.
- Linking changes what Pulse reads for those projects. For example, `getProjectCosts` calls Pulse hours for linked projects.
- `tests/security/confirmedProjectLinks.transaction.test.mjs` runs the engine against the Admin SDK Firestore **emulator** (demo project,
  synthetic data, stub principal). It is wired into the security job; it has not been run by the author of this change.
- The real credential path (ADC, `OAuth2Client.getTokenInfo`, Firestore write IAM) is not exercised by the unit tests. They use
  injected doubles and make no network, Google, SQL or Firebase calls.
