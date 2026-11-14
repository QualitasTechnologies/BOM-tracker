# Material ownership cutover repair

Goal: stop cached SDK and privileged legacy writers from overwriting native material edits while preserving original screens, permissions, new-project template continuation and recovery. No activation or new UI.

Evidence: material-coexistence-audit-20261114 reproduced native writes without a marker and SDK overwrite despite the canonical marker under the published policy. Inspect the shared HTTP/MCP/native engine, native procurement finalization and existing legacy PO guards before implementation. Legacy PO guards already refuse any material cutover document; do not weaken that drain boundary.

Architecture: server-selected materialChannel defaults to legacy; native factory sets native. Native existing-record writes require the exact per-project marker {fence:'legacy_bom_data_writes',version:1}. Privileged legacy writes require no marker; unknown/malformed markers fail closed for both server channels. Reads remain authorized normally; edit/command permissions reflect ownership. Request data cannot select the channel. Existing receipt replay/cancellation remains before ownership checks.

New native project creation creates the canonical marker atomically with the conditional project, audit and receipt, so template continuation can use the native owner immediately. Never overwrite an existing marker or project. Legacy project creation does not claim native ownership. Existing material data and operation identities remain preserved. Replays/cancellation do not create or delete ownership markers.

Native procurement must recheck the canonical marker before new reservation, lease, dispatch, cancellation affecting PO metadata and business finalization. Already-complete/cancelled outcome reads and internal outcome journals remain recoverable after pause; never lose accepted provider outcomes or resend them. No real provider calls in tests or production verification.

Rules: generate an additive material marker guard from exact current schedule policy SHA906c0e9794058b531b14564b2e6f0dce48193bc021261ec61af0acaf8419931b. Reuse the existing candidate's canonical marker semantics, guard only root bom/data SDK writes, retain reads and all other permissions. Prove removing the addition reproduces the baseline exactly; do not publish the whole candidate or create live markers.

- [x] Add failing ownership/channel/create/recovery/procurement tests.
- [x] Implement the shared marker contract and guards, update only accepted positive fixtures and mirrored Pulse deltas.
- [x] Verify actual SDK/native overwrite inversions, owner changes during transactions, new-project template continuation and provider-accepted recovery with synthetic provider only.
- [ ] Full relevant source/security/build checks and personal review; merge exact tested heads after hosted checks pass.
- [ ] Capture protected before state and source; selectively update affected handlers, retain all disabled gates and compare unchanged business data/settings/other services.
- [ ] Publish only the default-off marker policy addition after exact-baseline compilation/reversibility checks. No production markers, activation or shutdown.
- [ ] Save evidence and handoff; preserve individual acceptance and all remaining retirement requirements.


Scope review: the legacy triggerSpecSearch callback is another privileged BOM writer. Extract it into a testable factory; check legacy ownership/global coexist mode before provider dispatch and again inside a transaction applying only its result to the latest document. Reject changed/duplicate target identity and never claim a failed callback was saved. Tests use synthetic providers only. Include this fourth existing handler in selective deployment. The versioned direct MCP add-item writer remains an authorized peer, protected by exact revision plus atomic audit/receipt; prove concurrency rather than disable it.

Separately discovered existing Pulse nativeSpecSearchOperation callable is absent from deployed source. Recover the historically reviewed backend in a later bounded stage, correcting current membership parity and ownership/recovery gates before deployment; current material ownership repair does not claim that workflow works end to end. No restoration/source from historical modules is included in this stage.
