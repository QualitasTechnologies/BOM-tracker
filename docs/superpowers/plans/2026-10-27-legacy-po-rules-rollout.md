# Legacy PO Rules rollout (interim stage)

Status: candidate prepared and emulator-tested; NOT deployed.
This is one interim stage toward full writer fencing, not full retirement of
legacy writers.

## Artifacts

- `firestore.legacy-po.rules` - candidate, built from `git show e36b18b:firestore.rules`.
- `firebase.legacy-po-security-test.json` - Firestore-only loopback emulator config
  (127.0.0.1: 18080, ws 18150, hub 14400, logging 14500; demo project).
- `tests/security/purchaseOrderSentStatus.rules.test.mjs` - unchanged tests; the
  rules path now honours `FIRESTORE_RULES_PATH` (default: actual `firestore.rules`).

## Candidate vs e36b18b

Added verbatim from current source: `projectSubcollectionAccess` and the seven
`purchaseOrder*` helpers (PostSendStatus, CreateIsNotSent, HasBeenSent,
HasActiveSendAttempt, PostSendTransitionIsAllowed, PostSendFieldsAreLimited,
UpdateDoesNotChangeSentState). Replaced the recursive `/{subcollection=**}` grant
with `/{projectCollection}/{document=**}` excluding only `purchaseOrders`; added
explicit `purchaseOrders/{poId}` (read/create/update/delete) and nested
descendant grants copied from current. Nothing else differs from e36b18b.

## Known behavior difference (do not describe as PO-only)

Emulator characterization (`legacyProjectWildcard.rules.test.mjs`) proves the
e36b18b recursive wildcard also matched the project document, so approved
members could delete the parent project. The collection-prefixed grant does not
match the parent path, so the candidate closes that: parent delete becomes
admin-only (the explicit delete rule). Ordinary member parent updates are
unchanged from baseline; no membership restriction (`memberIds`/`members`) was
added. Support tickets and BOM paths keep baseline membership behavior (no
Support/material fences in this candidate).

## Run

```
FIREBASE_CLI_DISABLE_MOTD=1 FIRESTORE_RULES_PATH=<abs path>/firestore.legacy-po.rules \
firebase emulators:exec --only firestore --project demo-bom-native-security \
  --config firebase.legacy-po-security-test.json \
  "node --test tests/security/purchaseOrderSentStatus.rules.test.mjs"
```

Result (27 Oct 2026): candidate 10/10 pass; default current rules 10/10 pass.

## Gates before any activation (all still open)

1. Source client marker PR35 merged as `22dbb54` after all five CI checks passed;
   it must ship in BOTH the reused
   Pulse BOM client and the standalone client BEFORE the sender enforces it.
2. Rules deploy BEFORE sender activation (reservations protected first).
3. Drain old-sender requests; inspect attempt state before and after.
4. Verify live runtime environment and secret bindings are preserved.
5. Rollback gate: never roll back to an old sender while an active or uncertain
   send attempt exists.
6. Cached direct Mark-as-Sent writes may fail closed and need a reload.
7. Remaining: versioned material-write cutover for whole-BOM writers.
