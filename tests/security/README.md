# Native receipt security tests

These tests use the official Firebase Firestore and Storage emulators with only
synthetic records. They load the repository's actual rules, rather than copies.
They never start Functions, connect to a real Firebase project, or need service
credentials. The test module refuses hosts other than the configured loopback
addresses. Its project ID is fixed to `demo-bom-native-security`.

Install the isolated test dependencies once:

```sh
npm --prefix tests/security ci --ignore-scripts
```

With a supported Java runtime on PATH and Firebase CLI installed, run from the
repository root:

```sh
firebase emulators:exec --project demo-bom-native-security --config firebase.security-test.json --only "firestore,storage" "npm --prefix tests/security test"
```

Quote the comma-separated emulator list in PowerShell. The configuration binds
Firestore to `127.0.0.1:18080`, Storage to `127.0.0.1:19199`, and the emulator hub
to `127.0.0.1:14400` (Firestore websocket `18150`, logging `14500`). Use free
ports; do not reuse a running application's ports.
The runner starts and stops its own emulator processes.

Coverage includes current internal viewer/admin/partner grants, missing/expired
or mismatched capabilities, identity approval, current membership/category scope,
read-only controls, immutable native objects, confirmation-before-read, and
client denial on protected intent/audit/receipt/control collections.

Passing this suite proves those isolated rule scenarios. It does not prove live
IAM/service bindings, revoked-token handling (covered by the callable's separate
tests), artifact lifecycle cleanup, all legacy writers, or all-user acceptance.
Deployment and retirement still require the full Pulse acceptance gates.

Reference: [Firebase Security Rules testing](https://firebase.google.com/docs/rules/unit-tests).

Verified October 14, 2026 with Firebase CLI 14.9.0, existing Zulu Java 11.0.17,
rules-unit-testing 5.0.0 and Firebase SDK 12.0.0: 10 tests passed. The first run
exposed a successful second upload to a reserved existing object. Adding the
explicit `resource == null` condition made the overwrite regression pass. The
emulator tests are evidence for these isolated scenarios, not a live IAM claim.

## Atomic PO resolution transaction checks

The runner also executes nativePOResolution.transaction.test.mjs against the same
isolated demo Firestore. It uses the Firestore transaction implementation installed
with the functions package (install its locked dependencies first), explicit
localhost host/SSL-disabled settings and the fixed demo project, without application
credentials. Synthetic user assertions are local stubs, not a live Auth acceptance test.
The tests race create against cancellation eight times and check the actual receipt,
audit, PO existence and billing counter. A second case verifies a cancelled nonce
stays fenced while a new nonce can proceed. The callable's fake-transaction tests
also force both specific commit interleavings and simulate lost replies/audit failure.

October 14 resolution-stage run: 12/12 tests passed (10 rules + 2 real transaction
cases). Initial setup used a dummy credential unsupported by Admin; replacing that
wrapper with an explicit emulator Firestore connection resolved the setup failure.
No production project/credential/provider is used by this suite.

October 15 audited-deletion stage: 13/13 tests passed. The transaction suite now
also races deletion against cancellation four times, including completed-send
pointers, and compares the entire archived record (including Firestore timestamps)
with the pre-delete document. A matching terminal protected send record permits
delete; arbitrary PO flags or unknown/pending send state do not. The rules tests
include denial of direct access to the deleted-PO archive, even for client admins.
No files, BOM ordering data or billing counters are removed/recycled by PO deletion.
