# Gmail Message-ID path repair

Production read-only verification on 17 November found the repaired backfill healthy and all three historical jobs completed. Incremental sync now encounters a different blocker: an RFC Message-ID with a slash is passed directly to Firestore CollectionReference.doc, producing an invalid document path. The last 18 runs each logged that error despite HTTP 200 responses.

The original Development checkout is intentionally untouched. Prior billing repairs are merged in PRs 64 and 65 and deployed; this repair preserves their budgets, leases, checkpoints and fairness.

## Design and preservation

Keep all existing safe root deduplication IDs byte-for-byte. Hash only unsafe IDs into a dedicated subcollection under gmailIngestedMessageIds/encoded-message-ids/entries, so a literal safe root ID cannot collide. Preserve the exact original RFC header on captured correspondence. Continue checking valid old nested markers created when an odd number of slash-separated components was accepted by the old SDK. An empty or whitespace-only header falls back to the Gmail ID.

Do not skip the offending message, clear a queue, change history cursors manually, send mail, change Rules, activate migration controls or change schedules. The common message ingestion code serves both Gmail workers, so release only those two workers. No Pulse application release is needed.

## Checks and release

- [x] Reproduce invalid slash path and blank header with the real Firestore SDK path validator and the production ingestion function; original test double had accepted invalid paths.
- [x] Verify capture, original identity preservation, cross-mailbox deduplication, safe legacy marker compatibility and legacy nested marker recovery with synthetic HTTP/storage only.
- [ ] Complete backend suite, build and exact-head hosted checks.
- [ ] Protect fresh cloud/source recovery capture; deploy only the two Gmail workers.
- [ ] Verify actual deployed source, unchanged settings/other functions/Rules/data/schedules, and ordinary scheduled sync progress without errors.

PO evidence reconciliation PRs 69 and Pulse 94 have passed their hosted checks and remain open; their tested branches and separate recovery captures are retained. They are not included in this Gmail repair.
