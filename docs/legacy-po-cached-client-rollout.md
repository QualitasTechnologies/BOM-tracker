# Cached-client purchasing rollout

## Verified boundary (27 October 2026)

`tests/security/legacyProjectWildcard.rules.test.mjs` loads the actual September
Rules from Git revision `e36b18b`, and the actual current source Rules. Both cases
passed against the local Firestore emulator using synthetic records. The old
recursive wildcard grants approved project members parent-project deletion and
membership changes. The current source denies both while allowing ordinary
project renaming and email-subcollection writes. A PO-only patch that narrows the
wildcard therefore changes parent deletion behavior too; do not describe it as
having no effect outside purchase orders. The current explicit admin deletion
rule matches the existing UI intent.

## Sender activation remains gated

The five additive compatibility callables are deployed. The sender and Rules
have not been replaced. Publishing a fresh UI does not invalidate cached tabs.
The old successful-send callback writes the entire locally held BOM categories
array after the new server finalizer updates material dates/statuses. That can
overwrite concurrent edits and server-generated dates. A quiet window or a
request to reload is insufficient proof that this writer has gone away.

Before sender activation, add and test a versioned send-client contract that
rejects old clients before reservation, PDF generation or provider calls. Ship
the contract in both the reused Pulse BOM client and standalone client before
enforcing it on the new sender. Legacy requests should fail with an actionable
reload message and no side effects. This protects against the old post-send
callback; ordinary simultaneous whole-BOM edits still require the separate
versioned material-write cutover before retirement is complete.

Protect PO reservations with Rules before activating the sender. Drain existing
old-sender requests, preserve runtime environment and secret bindings, and
inspect attempt state before/after deployment. Cached direct Mark-as-Sent writes
may fail closed and require a reload. Never roll back to an old sender that
ignores reservations while an active or uncertain send attempt exists.

No vendor emails, production writes, Rules deployment or sender deployment were
performed for this characterization. Emulator results prove these permission
cases only, not live-user acceptance or full writer safety.
