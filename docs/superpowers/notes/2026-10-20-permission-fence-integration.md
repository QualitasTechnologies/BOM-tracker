# Combined Materials, purchase-order and Support rules

This source integration combines existing stages. It does not activate native
writes, provision project markers, deploy rules, or retire BOM.

## Inputs

- Materials UI migration and direct-write fence: `1e0f8eb`.
- Support create, status, assignment and resolution commands, including verified
  initial assignee lookup: canonical backend branch at `c4f2613`.
- Support resolution browser-write fence and callable marker requirement:
  `9184943`.
- Pulse client integration remains on the separate retirement branch at
  `4c698d7`; no Pulse or CRM source changes belong to this integration.

## Security requirement

Firestore combines matching grants with OR. A textual merge of the input rules
can leave two recursive project grants and silently bypass all three protections.
Retain one recursive grant that excludes both `purchaseOrders` and
`supportTickets`. Its remaining BOM root-data write permission must still check
the existing exact Materials marker. Keep the explicit purchase-order and
Support matches, including their deeper legacy metadata access.

The marker contracts remain independent and scoped to one project:

- `pulseMaterialCutovers/{projectId}` with
  `{ fence: 'legacy_bom_data_writes', version: 1 }` protects root `bom/data` writes.
- `pulseSupportCutovers/{projectId}` with
  `{ fence: 'legacy_support_resolution_writes', version: 1 }` protects the four
  RCA fields and canonical resolution activities.
- The existing purchase-order sent-state rules apply with either or neither
  marker. No additional purchase-order marker is introduced.

An absent or unrecognized marker keeps the corresponding legacy coexistence
path available. Clients, including admins, cannot edit server-owned markers.
Existing project membership and approved-user checks continue to apply.

## Verification

The combined emulator regression exercises no markers, Materials only, Support
only and both markers against the same ruleset. Each case checks member/admin
writes, purchase-order forgery denial, project isolation, read access, unrelated
metadata, marker protection and outsider/pending-user denial. Run it together
with each existing subsystem rules suite, backend tests and writer inventory.

Verified locally on 20 October 2026 with Node 22.14.0, Firebase CLI 14.9.0 and
Java 17.0.20:

- Before integration, the material-line backend baseline passed 584/584 tests
  (`node --test functions/*.test.js functions/*.test.cjs`). An earlier run during
  installation lacked Vite; the settled baseline ran after installation.
- The new four-scenario regression on the material-only base passed two and
  failed two: writes incorrectly succeeded when the Support marker required
  denial. This established the expected missing-protection failure.
- After integration, the full Functions suite passed 631/631.
- The full demo Firestore/Storage security suite passed 73/73, including all four
  combined-fence cases. The emulator runner exited successfully and stopped its
  owned emulators.
- `npm run test:writer-inventory` passed all four scanner tests and matched the
  checked-in manifest: 92 Firestore and 11 Storage mutation call sites.
- Functions ESLint and `git diff --check` passed.
- Claude's independent read-only review found no blocking introduced defect.
  Direct source comparisons confirmed the copied Support modules match the
  canonical input commits, the material/PO handlers are untouched and there is
  exactly one project wildcard. That review did not run the test suites or
  establish live runtime behavior.

## Remaining gates

Direct Support create, status and assignment writes are not fenced by the RCA
marker. Keep all native Support mutation flags off. Material nested collections
and other BOM writer surfaces also retain their independently inventoried gaps.

Local emulator identities and fixture data do not establish deployed-rule parity,
current-user sign-in, live category scopes, historical-data reconciliation,
side-by-side acceptance or rollback. These remain retirement requirements.
