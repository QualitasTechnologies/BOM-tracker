# Staged BOM Material Client-Write Fence

## Purpose

Add a reversible, opt-in Firestore Rules fence for direct browser writes to the
legacy BOM material document while Pulse's native material callable is used in
parallel. The default remains the current BOM behavior so a Rules deployment
alone does not interrupt coexistence.

## Contract

- The only fenced document is `projects/{projectId}/bom/data`.
- Its control record is `pulseMaterialCutovers/{projectId}`, following the
  Pulse per-project cutover contract.
- The fence is active only when that project's record contains the exact pair
  `{ fence: 'legacy_bom_data_writes', version: 1 }`.
- A missing record, marker on another project, missing fields, wrong field
  types, wrong fence name, or unsupported version preserves existing
  approved-member/admin access behavior. Malformed or unrecognized markers fail
  open for coexistence; they do not partially fence a project.
- When the exact marker is present, Firestore client SDK create, update, and
  delete operations on that project's material document are denied for members
  and admins.
- Reads and writes to other project subcollections keep their existing access
  behavior.
- Cloud Functions using the Admin SDK bypass Firestore Rules as usual. That
  bypass does not grant business access by itself: the native material callable
  must continue to enforce approved identity, current project membership,
  category scope, mutation-enable configuration, version checks, and audit
  recording in its own authorization path.

## Rollout and rollback

This change adds the Rules capability and tests it against the emulator; it does
not deploy Rules or create/change any per-project cutover record. Keep project
records absent during coexistence. Enable a project's fence only after the Pulse
material workflow and all required users are accepted. To restore legacy BOM
edits, remove that project's cutover record or change its fence/version; that
returns the existing browser write grant. The operator procedure itself remains
to be verified before rollout. This Rules change does not make BOM read-only as a
whole and is not authorization to retire BOM.

## Verification

`tests/security/nativeMaterial.rules.test.mjs` proves missing, wrong-project,
incomplete, malformed, and mismatched markers leave coexistence writes open;
the exact marker denies client create/update/delete. It also checks unaffected
project subcollections and Admin SDK Rules bypass. The existing
`functions/nativeMaterialOperations.test.cjs` suite separately covers callable
authorization and mutation behavior. Neither suite proves deployed Rules,
production Firebase configuration, live user acceptance, or the operational
rollback procedure; those remain later release gates.
