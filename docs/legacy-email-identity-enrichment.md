# Legacy email identity enrichment

This operator tool prepares a bounded, fill-only addition of `rfcMessageId` to at
most 24 existing project email documents. It does not move messages, change project
links, merge projects, write mailbox identities or replace message content.

`scripts/enrichLegacyEmailIdentity.cjs` defaults to dry-run when supplied its
required inputs. No arguments returns usage without accessing Firebase. Private
candidate data and the sealed manifest stay outside the repository.

## Before applying

- Pin the reviewed script commit and original manifest SHA. Retain the exact
  manifest and candidate file; do not regenerate them to resume a partial run.
- Confirm the intended Firebase project, numeric Pulse project link and operator's
  proven ADC principal. The apply path refuses an unproven or different principal.
- Ensure `FIRESTORE_EMULATOR_HOST` is unset for a deliberate production run.
- Run the default read-only mode against the real sealed manifest and inspect all
  blockers. Missing/changed identity, contents, update time or existing conflicting
  field values stop the run; do not weaken those checks.
- Use an absolute durable recovery directory outside repositories and temporary
  cleanup locations. Retain the script commit, manifest, candidates, field preimages
  and captured run summary there with restricted local access.

The CLI requires explicit `--apply`, `--operator` and `--preimage-dir` in addition
to the pinned manifest/candidates/project arguments. A successful dry-run does not
prove the apply principal; apply independently checks the credential principal.
Never print access tokens or read credential files to establish that identity.

## Recovery and verification

Each field addition and its create-only receipt are one Firestore transaction.
The local field preimage is written before the transaction commits. A preimage
without a matching Firestore receipt does not prove a write occurred. The run is
sequential across documents: a failure can leave a partial apply. Rerunning the
same pinned manifest resumes with already-applied operations as no-ops.

Retain all original inputs. A regenerated manifest may conflict with existing
receipts and cannot be substituted silently. A truncated or unreadable preimage
fails closed; inspect it and its receipt before any operator repair.

After apply, run read-only verification with the same inputs and compare the
receipt count, RFC values, message content and existing project links. Expected
replay consists only of no-ops, with no additional writes.

Automated rollback is not implemented. A manual rollback must verify the original
manifest, matching receipt and absent-field preimage, then transactionally remove
only the added field if its current value still matches this operation. Preserve
all other fields and retain an attributable rollback record. If the field or
relevant identity changed, leave it untouched and report the conflict. Do not
restore whole documents over subsequent user edits.

Unit tests use an in-memory transactional double. They cover contention, partial
resume, audit atomicity, backup failures and runtime read-only controls; they do
not establish real Firestore write acceptance or all-user communications parity.
