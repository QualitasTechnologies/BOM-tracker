# Staged BOM Material Client-Write Fence

## Purpose

Add a reversible, opt-in Firestore Rules fence for direct browser writes to the
legacy BOM material document while Pulse's native material callable is used in
parallel. The default remains the current BOM behavior so a Rules deployment
alone does not interrupt coexistence.

## Contract

- The only fenced document is `projects/{projectId}/bom/data`.
- Its control bit is `pulseRuntimeControl/cutover.blockLegacyMaterialClientWrites`.
- An absent control document, absent field, or any value other than boolean
  `true` preserves existing approved-member/admin access behavior.
- When the field is exactly `true`, Firestore client SDK create, update, and
  delete operations on that document are denied for members and admins.
- Reads and writes to other project subcollections keep their existing access
  behavior.
- Cloud Functions using the Admin SDK bypass Firestore Rules as usual. That
  bypass does not grant business access by itself: the native material callable
  must continue to enforce approved identity, current project membership,
  category scope, mutation-enable configuration, version checks, and audit
  recording in its own authorization path.

## Rollout and rollback

This stage only deploys the Rules capability and tests it against the emulator;
it does not create or change the live control marker. Keep the field unset during
coexistence. Enable it only after the Pulse material workflow and all required
users are accepted, with a tested operator path to remove or set it false. If
legacy BOM edits need to resume, clearing the field immediately restores the
existing browser write grant. This Rules change does not make BOM read-only as a
whole and is not authorization to retire BOM.

## Verification

`tests/security/nativeMaterial.rules.test.mjs` proves the absent/false default,
enabled denial for client create/update/delete, unaffected project
subcollections, and Admin SDK Rules bypass. The existing
`functions/nativeMaterialOperations.test.cjs` suite separately covers callable
authorization and mutation behavior. Neither suite proves deployed Rules,
production Firebase configuration, live user acceptance, or the operational
rollback procedure; those remain later release gates.
