# Notification membership parity repair

Execute solo in the existing migration worktrees. No new UI, feature, provider send, Rules change or activation.

Goal: preserve the original project-subcollection permission policy in existing PO notification status and PO/expense notification recipient checks. Explicit `memberIds: null` permits approved non-admin accounts; an array permits only listed accounts; missing or malformed membership denies non-admin access. Admin access and admin-only retry controls remain unchanged.

Root cause: PO notification checks currently accept only membership arrays, while the expense adapter uses loose null equality that also accepts a missing field. Original Rules, native PO authoring and native overhead authorization distinguish explicit null from a missing field.

- [x] Reproduce explicit-null PO status/recipient rejection and missing-field expense recipient acceptance with the real handlers and existing isolated fixtures. Six expected failures observed before the repair.
- [x] Cover arrays, missing/malformed fields, external accounts, admin-only retries and membership revocation between preparation and dispatch. Provider calls are test doubles only.
- [x] Apply the exact existing membership predicate to the three affected checks; retain current actor, transaction, provider idempotency and retry gates.
- [x] Mirror changed code/tests into Pulse's existing review contracts. Preserve current main's PR86 changes and the intentional older recovery implementation in its reference module.
- [ ] Run focused tests, complete review contracts and appropriate backend checks; review diff personally, then exact-head hosted checks before merge.
- [ ] Record deployed/readiness limits. Missing notification services and real native-write/provider acceptance remain separate retirement gates; do not deploy send triggers merely to obtain a green result.
